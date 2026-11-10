"""Classify network failures without exposing keys, prompts or raw provider bodies."""
import errno
import socket
import ssl

import httpx


def exception_chain(error):
    """Include wrapped causes and anyio's exception groups, without looping."""
    pending, seen = [error], set()
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        yield current
        for nested in (current.__cause__, current.__context__, *getattr(current, "exceptions", ())):
            if isinstance(nested, BaseException):
                pending.append(nested)


def transport_diagnostic(error):
    errors = list(exception_chain(error))
    codes = sorted({getattr(item, "winerror", None) for item in errors} - {None})
    # Report only exception types and OS codes, never str(error) or request headers.
    summary = ", ".join(dict.fromkeys(type(item).__name__ for item in errors))
    if codes:
        summary += "; WinError=" + ",".join(map(str, codes))
    if any(isinstance(item, PermissionError) or getattr(item, "winerror", None) in (5, 10013)
           or isinstance(item, OSError) and item.errno in (errno.EACCES, errno.EPERM) for item in errors):
        code = "network_permission_denied"
        message = "Python 的网络访问被系统拒绝。若服务由受限工具启动，请先停止旧服务，再在本机双击 start.bat 启动；也可运行 diagnose.bat 查看连接诊断。"
    elif any(isinstance(item, ssl.SSLError) for item in errors):
        code, message = "tls_error", "连接 DeepSeek 时 TLS 证书校验失败，请检查系统时间、证书及 HTTPS 代理配置。"
    elif any(isinstance(item, socket.gaierror) for item in errors):
        code, message = "dns_error", "无法解析 DeepSeek 域名，请检查本机 DNS 或网络代理配置。"
    elif any(isinstance(item, httpx.ProxyError) for item in errors):
        code, message = "proxy_error", "后端代理连接失败，请检查 HTTP_PROXY / HTTPS_PROXY 配置及代理是否运行。"
    elif isinstance(error, httpx.TimeoutException):
        code, message = "upstream_timeout", "模型连接或响应超时，请稍后重试，或关闭深度思考以加快回复。"
    else:
        code, message = "upstream_connection_error", "无法连接 DeepSeek，请检查网络和后端接口地址，或运行 diagnose.bat 查看具体原因。"
    return {"code": code, "message": message, "summary": summary}
