"""Luma: same-origin HTML frontend and a streaming DeepSeek proxy."""
import asyncio
import json
import logging
import os
import secrets
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBasic
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

from connection import transport_diagnostic

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", encoding="utf-8-sig")
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-pro").strip()
BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/")
logger = logging.getLogger("uvicorn.error")
SYSTEM_PROMPT = "你是 Luma，一位友好、严谨的 AI 助手。默认用中文回复，除非用户希望使用其他语言。回答清晰实用，适当使用 Markdown。不要声称自己可以联网或执行未提供的工具。"


@asynccontextmanager
async def lifespan(application: FastAPI):
    # One client shares connection pooling; credentials never reach the frontend.
    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=15), follow_redirects=False) as client:
        application.state.client = client
        yield


def deployment_hosts():
    hosts = ["127.0.0.1", "localhost", "[::1]", "testserver"]
    for name in ("RENDER_EXTERNAL_HOSTNAME", "SPACE_HOST", "ALLOWED_HOSTS"):
        hosts.extend(host.strip() for host in os.getenv(name, "").split(",") if host.strip())
    return hosts


app = FastAPI(title="Luma Chat", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=deployment_hosts())
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")
basic_auth = HTTPBasic(auto_error=False)


@app.middleware("http")
async def response_headers(request: Request, call_next):
    password = os.getenv("ACCESS_PASSWORD", "")
    cloud = bool(os.getenv("RENDER") or os.getenv("SPACE_ID") or os.getenv("SPACE_HOST"))
    # Health checks stay public and never call the paid model API.
    if request.url.path != "/api/health" and (password or cloud):
        if not password.strip():
            return JSONResponse(status_code=503, content={"detail": "请在云平台设置 ACCESS_PASSWORD 后重新部署。"})
        try:
            credentials = await basic_auth(request)
        except HTTPException:
            credentials = None
        username = os.getenv("ACCESS_USERNAME", "admin")
        valid_user = secrets.compare_digest((credentials.username if credentials else "").encode(), username.encode())
        valid_password = secrets.compare_digest((credentials.password if credentials else "").encode(), password.encode())
        if not (valid_user and valid_password):
            return JSONResponse(status_code=401, content={"detail": "请输入网站访问账号和密码。"},
                                headers={"WWW-Authenticate": 'Basic realm="Luma", charset="UTF-8"', "Cache-Control": "no-store"})
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self' https://cdn.bootcdn.net; "
        "style-src 'self'; img-src 'self' data:; connect-src 'self'; "
        "base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    )
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(RequestValidationError)
async def invalid_request(_request, _error):
    # Avoid reflecting complete user prompts in validation errors.
    return JSONResponse(status_code=422, content={"detail": "消息格式不正确：最多 100 条消息，总长度不超过 100,000 字，最后一条须为用户消息。"})


class Message(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=32000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    messages: list[Message] = Field(min_length=1, max_length=100)
    thinking: bool = False

    @model_validator(mode="after")
    def validate_history(self):
        if self.messages[-1].role != "user":
            raise ValueError("Last message must be from user")
        if sum(len(message.content) for message in self.messages) > 100000:
            raise ValueError("Conversation too long")
        if any(not message.content.strip() for message in self.messages):
            raise ValueError("Messages cannot be blank")
        return self


ERRORS = {
    400: "模型请求被拒绝，请检查后端的模型名称与参数配置。",
    401: "API Key 无效，请检查后端环境变量或 .env 中的 DEEPSEEK_API_KEY。",
    402: "DeepSeek 账户余额不足，请在官方平台充值后重试。",
    403: "此 API Key 暂无调用权限，请检查 DeepSeek 账户设置。",
    404: "未找到配置的模型或接口，请检查后端环境变量或 .env 中的地址和模型名称。",
    429: "请求过于频繁，请稍等片刻再试。",
}


def event(kind, **data):
    payload = json.dumps({"type": kind, **data}, ensure_ascii=False)
    return f"event: {kind}\ndata: {payload}\n\n"


async def with_heartbeats(iterator, interval=15):
    """Keep the SSE connection active while the upstream model is thinking."""
    pending = asyncio.create_task(anext(iterator))
    try:
        while True:
            ready, _ = await asyncio.wait({pending}, timeout=interval)
            if not ready:
                yield ": keep-alive\n\n"
                continue
            try:
                chunk = pending.result()
            except StopAsyncIteration:
                return
            yield chunk
            pending = asyncio.create_task(anext(iterator))
    finally:
        pending.cancel()
        with suppress(asyncio.CancelledError, StopAsyncIteration):
            await pending
        await iterator.aclose()


@app.get("/")
async def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/health")
async def health():
    key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    return {"status": "ok", "configured": bool(key and key != "your-deepseek-api-key"), "model": MODEL}


@app.post("/api/chat")
async def chat(body: ChatRequest, request: Request):
    # Proxy headers let this compare the original HTTPS origin on cloud hosts.
    origin = request.headers.get("origin")
    if origin and origin != str(request.base_url).rstrip("/"):
        raise HTTPException(403, "请通过当前网站发起聊天请求。")
    key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    if not key or key == "your-deepseek-api-key":
        raise HTTPException(503, "请先在后端环境变量或 .env 中配置 DEEPSEEK_API_KEY，然后重启服务。")
    payload = {
        "model": MODEL,
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *[message.model_dump() for message in body.messages]],
        "stream": True,
        "max_tokens": 16384 if body.thinking else 8192,
        "thinking": {"type": "enabled" if body.thinking else "disabled"},
    }

    async def generate():
        try:
            yield event("start", model=MODEL)
            async with request.app.state.client.stream(
                "POST", BASE_URL + "/chat/completions",
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json=payload,
            ) as upstream:
                if upstream.status_code != 200:
                    # Provider error bodies may contain sensitive request details.
                    yield event("error", message=ERRORS.get(upstream.status_code, "DeepSeek 服务暂时不可用，请稍后重试。"))
                    return
                finished = False
                async for line in upstream.aiter_lines():
                    if await request.is_disconnected():
                        return
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        yield event("done")
                        return
                    if not data:
                        continue
                    try:
                        chunk = json.loads(data)
                    except json.JSONDecodeError:
                        yield event("error", message="模型返回了无法解析的数据，请重试。")
                        return
                    if chunk.get("error"):
                        yield event("error", message="模型生成中断，请重试。")
                        return
                    for choice in chunk.get("choices", []):
                        delta = choice.get("delta") or {}
                        if delta.get("reasoning_content"):
                            yield event("reasoning", content=delta["reasoning_content"])
                        if delta.get("content"):
                            yield event("content", content=delta["content"])
                        reason = choice.get("finish_reason")
                        if reason:
                            finished = True
                            if reason == "length":
                                yield event("notice", message="已达到本次回复的长度上限，可继续提问让助手接着回答。")
                if finished:
                    yield event("done")
                else:
                    yield event("error", message="连接提前结束，回复可能不完整，请重试。")
        except httpx.RequestError as error:
            diagnostic = transport_diagnostic(error)
            logger.warning("DeepSeek connection failed: %s (%s)", diagnostic["code"], diagnostic["summary"])
            yield event("error", code=diagnostic["code"], message=diagnostic["message"])
        except asyncio.CancelledError:
            raise
        except Exception:
            yield event("error", message="生成遇到异常，请稍后重试。")

    return StreamingResponse(with_heartbeats(generate()), media_type="text/event-stream", headers={
        "X-Accel-Buffering": "no", "Cache-Control": "no-cache, no-store, no-transform",
    })
