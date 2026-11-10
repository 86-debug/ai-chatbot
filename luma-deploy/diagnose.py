"""Check .env and authenticated connectivity; never print the API key."""
import asyncio
import os
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from dotenv import load_dotenv

from connection import transport_diagnostic


async def main():
    path = Path(__file__).resolve().with_name(".env")
    load_dotenv(path, encoding="utf-8-sig")
    key = os.getenv("DEEPSEEK_API_KEY", "").strip()
    base = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip().rstrip("/")
    model = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-pro").strip()
    print("=== Luma backend connection check ===")
    print(".env:", "found" if path.is_file() else "missing")
    print("API key:", "loaded (value hidden)" if key and key != "your-deepseek-api-key" else "missing")
    print("Model:", model)
    endpoint = urlsplit(base)
    # Diagnostics must never send credentials to an unintended destination.
    if endpoint.scheme != "https" or endpoint.hostname != "api.deepseek.com" or endpoint.username or endpoint.password or endpoint.query or endpoint.fragment or endpoint.port not in (None, 443) or endpoint.path not in ("", "/v1"):
        print("ERROR: expected DEEPSEEK_BASE_URL=https://api.deepseek.com (optional /v1).")
        return 1
    print("Chat endpoint:", base + "/chat/completions")
    if not key or key == "your-deepseek-api-key":
        print("ERROR: configure DEEPSEEK_API_KEY in .env, then restart the server.")
        return 1
    print("Checking GET /models (no chat generation)...")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=10), follow_redirects=False) as client:
            response = await client.get(base + "/models", headers={"Authorization": f"Bearer {key}"})
    except httpx.RequestError as error:
        diagnostic = transport_diagnostic(error)
        print("ERROR:", diagnostic["code"])
        print("Details:", diagnostic["summary"])
        if diagnostic["code"] == "network_permission_denied":
            print("Network access for this Python process was denied by the operating system.")
            print("Stop the old server and run start.bat from your own Windows terminal.")
        else:
            print("Check DNS, HTTPS connectivity and your backend proxy environment variables.")
        print("API key validity could not be checked because no HTTP response was received.")
        return 1
    print("DeepSeek HTTP status:", response.status_code)
    if response.status_code != 200:
        hints = {401: "API key rejected. Update .env and restart.", 402: "Insufficient account balance.", 403: "API access denied by provider.", 404: "Check the base URL.", 429: "Rate limit reached. Try later."}
        print("ERROR:", hints.get(response.status_code, "Provider returned an error; try later."))
        return 1
    try:
        available = [item["id"] for item in response.json()["data"]]
    except (ValueError, KeyError, TypeError):
        print("ERROR: provider returned an unexpected model-list response.")
        return 1
    print("Authentication and HTTPS connection: OK")
    print("Requested model:", "available" if model in available else "not listed by provider")
    print("This check does not verify account balance or generate a chat response.")
    return 0 if model in available else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
