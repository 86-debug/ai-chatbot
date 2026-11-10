---
title: Luma Chat
emoji: 💬
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
---

# Luma · AI 聊天机器人

云部署请看 [零基础部署指南](DEPLOY.md)：包含 Render 免费方案、启动命令、环境变量和 Hugging Face Docker 备选步骤。

一个可以本地运行的 AI 聊天应用。前端使用 **HTML、CSS、原生 JavaScript、Axios**，后端使用 **Python / FastAPI / HTTPX**，调用 DeepSeek Chat Completions 接口。

## 启动

需要 Python 3.10 或以上版本。Windows 下双击 `start.bat`，随后在浏览器打开 **http://127.0.0.1:8001**。

也可以在 PowerShell 中执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# 首次配置时：复制 .env.example 为 .env，填写密钥；已有 .env 时不用覆盖。
.\.venv\Scripts\python.exe run.py
```

本项目的 `.env` 已填入本次提供的密钥，且被 `.gitignore` 排除。交付或上传项目时不要包含 `.env`，共享配置请使用 `.env.example`。所有密钥均由 Python 读取，网页不接触密钥。

前端使用固定版本的 Axios、Marked、DOMPurify CDN 资源，需要能访问 `cdn.jsdelivr.net`；若 Markdown 组件无法加载，会回退为纯文本。Axios 加载失败会显示提示。连接 DeepSeek 需要后端能访问其官方 API。

## 配置

修改 `.env` 后重启 Python 服务：

```dotenv
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
HOST=127.0.0.1
PORT=8001
```

重启方式：在正在运行后端的终端按 **Ctrl + C**，然后双击 `start.bat`，或重新执行 `.\.venv\Scripts\python.exe run.py`。也可双击 `restart.bat`，它会核实端口占用者正在运行本项目的完整 `run.py` 路径后停止旧进程，并调用启动脚本；无法确认进程归属时不会结束它。最初由工具通过相对路径启动的进程可能无法自动识别，此时请使用 Ctrl + C 的方式。若 PowerShell 脚本执行策略不允许运行重启脚本，直接用上述手动方式即可。

## 连接失败排查

双击 `diagnose.bat`，或在 PowerShell 执行：

```powershell
.\.venv\Scripts\python.exe diagnose.py
```

诊断会检查项目目录下的 `.env`、密钥是否读入及目标模型，然后通过官方 `GET /models` 检查网络和鉴权，不生成聊天内容。它不会显示密钥或原始请求头。`/api/health` 的 `configured` 只表示本地存在密钥，不能用于证明鉴权成功。

如果显示 `network_permission_denied`、`PermissionError` 或 `WinError=5/10013`，表示操作系统拒绝了该 Python 进程的网络访问，请先退出旧服务，再从你自己的 Windows 终端或资源管理器启动 `start.bat`。受限工具内启动的 Python 可能继承该工具的联网限制。错误发生在收到 HTTP 响应之前，此时无法确认密钥是否有效。

其他诊断会区分 DNS 解析、TLS 证书、代理连接、超时及服务方 HTTP 错误。HTTP 401 表示密钥被拒绝，402 表示余额不足，429 表示限流。前端通过同源 `/api/chat` 调用 Python，Python 再连接 DeepSeek；浏览器跨域设置不会修复 Python 出站连接的权限错误。

后端兼容带 BOM 的 UTF-8 `.env`，读取配置时会去掉密钥、模型与地址两端空白。系统环境变量优先于 `.env`；若在系统环境中设置过同名 `DEEPSEEK_*` 变量，应检查其值。连接错误日志只记录异常类型和系统错误码，不记录密钥及消息正文。

接口地址为 `POST https://api.deepseek.com/chat/completions`，使用 Bearer Token 鉴权。后端显式传递 `thinking.type` 以切换深度思考与普通模式，解析 SSE 后以 NDJSON 逐步转发给网页。前端通过 Axios XHR 的 `onDownloadProgress` 展示流式结果。

已核实的官方文档：

- [Chat Completions 接口、流式协议与思考参数](https://api-docs.deepseek.com/api/create-chat-completion/)
- [官方模型列表](https://api-docs.deepseek.com/api/list-models/)，列有 `deepseek-v4-pro`
- [2026-09-10 官方公告](https://api-docs.deepseek.com/news/news260910/)说明：2026-09-14 起，`deepseek-v4-pro` 请求路由至 V4.1-Flash，直至 V4.1-Pro 发布。本项目保留用户要求的模型 ID；提供方实际服务版本以 DeepSeek 当前政策为准。

## 功能

- 浅色与深色主题，桌面侧栏、手机抽屉菜单。
- 实时流式回复、停止生成、深度思考、重新生成、错误重试。
- 多轮上下文、Markdown、代码块、表格、复制回复、导出 Markdown。
- 历史对话在当前浏览器保存，可搜索、切换、删除；最多保存 50 个会话。
- 输入框自动增高，Enter 发送、Shift + Enter 换行；中文输入法选词时不会误发送。
- Ctrl / Cmd + K 开启新对话，`/` 搜索历史。
- API Key、余额、限流、网络超时、模型错误等可读提示。

点击灵感卡片会将建议填入输入框，可编辑后发送。界面的“服务已就绪”表示本地后端启动且已配置密钥，不表示已验证 DeepSeek 账户余额或密钥有效性。

## 文件结构

```text
app.py               Python 接口、参数校验、流式转发、静态文件服务
run.py               启动入口
start.bat            Windows 启动脚本
requirements.txt     Python 依赖
.env                 本地配置与密钥（忽略提交）
.env.example         可共享的配置模板
static/
  index.html         页面结构
  style.css          响应式布局与主题
  app.js             会话管理、Axios 流式请求、Markdown 展示
  favicon.svg        应用图标
tests/test_app.py    不调用付费 API 的接口行为测试
```

## 测试

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
node --check static/app.js
```

测试通过模拟上游覆盖流式中文回复、思考内容、异常中断、超时/连接错误、常见 HTTP 错误、上下文校验、跨站请求限制和静态文件隔离，不消耗真实 API 额度。真实对话需在能够访问 DeepSeek 的网络环境下验证。

## 数据与部署范围

这是面向本机个人使用的应用，默认只监听 `127.0.0.1`。会话保存在 localStorage，清理浏览器数据会丢失历史，重要内容请导出。发送消息时，当前会话有效上下文会一并提交给 DeepSeek；错误回复不会作为上下文重复发送。单条消息最多 32,000 字，单次请求最多 100 条消息、总计 100,000 字，超出后会提示开启新会话。

云部署支持网站访问密码：设置 `ACCESS_PASSWORD`，浏览器会弹出登录框，默认用户名为 `admin`（可通过 `ACCESS_USERNAME` 修改）。Render / Hugging Face 环境未设置访问密码时，除健康检查外返回 503，避免公开消耗账户额度。本机未设置访问密码时保持直接打开。该机制适合个人或少量可信用户共享使用，未实现多用户账号或按用户额度管理。

默认云域名从 `RENDER_EXTERNAL_HOSTNAME` / `SPACE_HOST` 自动读取，自定义域名通过 `ALLOWED_HOSTS` 设置。云平台启动配置启用代理头以识别 HTTPS，供平台反向代理后的容器使用；本机仍使用 `python run.py`。
