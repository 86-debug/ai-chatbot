/* SSE transport and paced text output, shared by the browser and Node tests. */
(function (root) {
  "use strict";

  function createSSEParser(onEvent) {
    let buffer = "";
    let data = [];
    let event = "message";
    let skipLF = false;
    let first = true;
    function line(value) {
      if (!value) {
        if (data.length) onEvent({ event, data: data.join("\n") });
        data = []; event = "message";
      } else if (!value.startsWith(":")) {
        const colon = value.indexOf(":");
        const field = colon < 0 ? value : value.slice(0, colon);
        let content = colon < 0 ? "" : value.slice(colon + 1);
        if (content.startsWith(" ")) content = content.slice(1);
        if (field === "data") data.push(content);
        if (field === "event") event = content;
      }
    }
    return {
      push(chunk) {
        if (first && chunk.length) { chunk = chunk.replace(/^\uFEFF/, ""); first = false; }
        // Preserve CRLF even when its two bytes arrive in separate reads.
        for (const char of chunk) {
          if (skipLF) { skipLF = false; if (char === "\n") continue; }
          if (char === "\r" || char === "\n") {
            line(buffer); buffer = ""; skipLF = char === "\r";
          } else buffer += char;
        }
      },
    };
  }

  async function fetchSSE(url, options, onEvent) {
    const response = await fetch(url, options);
    if (!response.ok) {
      let detail;
      try { detail = (await response.json()).detail; } catch (_error) { /* Platform HTML error. */ }
      throw new Error(typeof detail === "string" ? detail : `请求失败（HTTP ${response.status}），请稍后重试。`);
    }
    if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("text/event-stream") || !response.body) {
      throw new Error("后端未返回 SSE 数据，请同步部署前后端并刷新页面。");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const parser = createSSEParser(({ event, data }) => {
      let payload;
      try { payload = JSON.parse(data); }
      catch (_error) { throw new Error("流式数据格式异常，请重试。"); }
      onEvent({ ...payload, type: event });
    });
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
    } finally {
      // Close the connection if decoding, parsing or rendering fails mid-stream.
      try { await reader.cancel(); } finally { reader.releaseLock(); }
    }
  }

  function createTypewriter(onText, { interval = 16 } = {}) {
    let queue = [];
    let offset = 0;
    let timer = null;
    let cancelled = false;
    let resolveDrain = null;
    function settle() { if (resolveDrain) { resolveDrain(); resolveDrain = null; } }
    function tick() {
      timer = null;
      if (cancelled) return;
      const remaining = queue.length - offset;
      // Normally one code point per tick; catch up gently after large network bursts.
      const count = remaining > 240 ? Math.min(32, Math.ceil(remaining / 120)) : 1;
      const text = queue.slice(offset, offset + count).join("");
      offset += count;
      if (text) onText(text);
      if (offset < queue.length) timer = setTimeout(tick, interval);
      else { queue = []; offset = 0; settle(); }
    }
    return {
      push(text) {
        if (cancelled || !text) return;
        queue.push(...Array.from(text));
        if (timer === null) tick();
      },
      finish() {
        if (cancelled || offset >= queue.length) return Promise.resolve();
        return new Promise((resolve) => { resolveDrain = resolve; });
      },
      cancel() {
        cancelled = true; clearTimeout(timer); timer = null;
        queue = []; offset = 0; settle();
      },
    };
  }

  const api = { createSSEParser, fetchSSE, createTypewriter };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LumaStream = api;
})(globalThis);
