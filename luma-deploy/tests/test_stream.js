"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { createSSEParser, fetchSSE, createTypewriter } = require("../static/chat-stream.js");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("SSE parses named events, split CRLF, comments, BOM and multiline data", () => {
  const events = [];
  const parser = createSSEParser((event) => events.push(event));
  const text = '\uFEFF: heartbeat\r\nevent: content\r\ndata: first\r\ndata: second\r\n\r\nevent: done\ndata: {}\n\n';
  for (const char of text) parser.push(char);
  assert.deepEqual(events, [{ event: "content", data: "first\nsecond" }, { event: "done", data: "{}" }]);
  parser.push("data: incomplete");
  assert.equal(events.length, 2);
});

test("fetch reads UTF-8 split at every byte before the server closes", async () => {
  const original = global.fetch;
  let controller;
  let release;
  const first = new Promise((resolve) => { release = resolve; });
  const events = [];
  global.fetch = async () => new Response(new ReadableStream({ start(value) { controller = value; } }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
  try {
    const task = fetchSSE("/mock", {}, (data) => { events.push(data); release(); });
    const bytes = new TextEncoder().encode('event: content\ndata: {"content":"中文🙂"}\n\n');
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    await first;
    assert.deepEqual(events, [{ type: "content", content: "中文🙂" }]);
    controller.enqueue(new TextEncoder().encode('event: done\ndata: {}\n\n'));
    controller.close();
    await task;
    assert.equal(events[1].type, "done");
  } finally { global.fetch = original; }
});

test("fetch surfaces HTTP errors and rejects old NDJSON responses", async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => Response.json({ detail: "请配置密钥" }, { status: 503 });
    await assert.rejects(fetchSSE("/mock", {}, () => {}), /请配置密钥/);
    global.fetch = async () => new Response("{}", { headers: { "Content-Type": "application/x-ndjson" } });
    await assert.rejects(fetchSSE("/mock", {}, () => {}), /SSE/);
  } finally { global.fetch = original; }
});

test("malformed SSE closes the reader and reports a readable error", async () => {
  const original = global.fetch;
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('event: content\ndata: invalid JSON\n\n')); },
    cancel() { cancelled = true; },
  });
  global.fetch = async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  try {
    await assert.rejects(fetchSSE("/mock", {}, () => {}), /流式数据格式异常/);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  } finally { global.fetch = original; }
});

test("typewriter reveals characters progressively without splitting emoji", async () => {
  const chunks = [];
  const writer = createTypewriter((text) => chunks.push(text), { interval: 2 });
  writer.push("你好🙂");
  assert.deepEqual(chunks, ["你"]);
  await writer.finish();
  assert.deepEqual(chunks, ["你", "好", "🙂"]);
});

test("stopping a typewriter drops queued text and resolves drain", async () => {
  let text = "";
  const writer = createTypewriter((part) => { text += part; }, { interval: 10 });
  writer.push("这段不应在清空后重新出现");
  const drain = writer.finish();
  writer.cancel(); writer.push("late data");
  await drain; await delay(25);
  assert.equal(text, "这");
});

// A small DOM stand-in exercises conversation state and cancellation using the
// actual app functions. Network transport is tested independently above.
function appFixture(transport) {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.style = {}; this.value = ""; this.textContent = ""; this.className = ""; this.scrollHeight = 0; this.nodes = new Map(); this.listeners = {}; this.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } }; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    querySelector(name) { if (!this.nodes.has(name)) this.nodes.set(name, new Element()); return this.nodes.get(name); }
    querySelectorAll() { return []; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    setAttribute() {} focus() {}
  }
  const elements = new Map();
  const document = {
    body: new Element(), querySelectorAll: () => [], addEventListener() {},
    querySelector(name) { if (!elements.has(name)) elements.set(name, new Element()); return elements.get(name); },
    createElement: () => new Element(), createTextNode: (text) => text,
  };
  const storage = new Map();
  const context = vm.createContext({ document, AbortController, console, confirm: () => true, Date, JSON,
    setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async () => ({ ok: true, json: async () => ({ configured: true, model: "mock" }) }),
    LumaStream: { createTypewriter, fetchSSE: transport },
  });
  vm.runInContext(readFileSync(require.resolve("../static/app.js"), "utf8"), context);
  return { context, storage, document, run: (source) => vm.runInContext(source, context) };
}

test("clear during generation resets context and rejects late data from old request", async () => {
  let finishOld;
  let emitOld;
  const payloads = [];
  const fixture = appFixture(async (_url, options, onEvent) => {
    payloads.push(JSON.parse(options.body));
    if (payloads.length === 1) {
      emitOld = onEvent;
      onEvent({ type: "content", content: "旧回复还在生成中" });
      await new Promise((resolve) => { finishOld = resolve; });
    } else {
      onEvent({ type: "content", content: "新回复" }); onEvent({ type: "done" });
    }
  });
  fixture.run('state.sessions = [{id:"active", title:"旧对话", messages:[{id:"user", role:"user", content:"旧问题"}]}, {id:"other", title:"保留", messages:[{role:"user", content:"别删"}]}]; state.active="active"; globalThis.oldTask = generate(current());');
  assert.equal(fixture.run('current().messages[1].content'), "旧");
  fixture.run("clearCurrentChat()");
  assert.equal(fixture.run("current().messages.length"), 0);
  assert.equal(fixture.run("state.generation"), null);
  assert.equal(fixture.run('state.sessions[1].messages[0].content'), "别删");
  fixture.document.querySelector("#prompt").value = "清空后的问题";
  const newTask = fixture.run("send()");
  emitOld({ type: "content", content: "不应复活" }); finishOld();
  await fixture.context.oldTask; await newTask;
  assert.equal(payloads[1].messages.length, 1);
  assert.equal(payloads[1].messages[0].content, "清空后的问题");
  assert.equal(fixture.run('current().messages[1].content'), "新回复");
  const saved = JSON.parse([...fixture.storage.values()].find((value) => value.includes('"sessions"')));
  assert.equal(saved.sessions[0].messages.length, 2);
});

test("Markdown uses marked then DOMPurify and highlights supported code languages", () => {
  const fixture = appFixture(async () => {});
  const calls = [];
  fixture.context.marked = { parse: (text) => { calls.push("marked"); return `<p>${text}</p>`; } };
  fixture.context.DOMPurify = { sanitize: (html) => { calls.push("sanitize"); return html; } };
  const known = { className: "language-python", textContent: "print(1)", classList: { add() {} } };
  const unknown = { className: "language-unknown", textContent: "data", classList: { add() {} } };
  fixture.context.hljs = { getLanguage: (language) => language === "python", highlightElement: () => calls.push("highlight") };
  fixture.context.target = { style: {}, querySelectorAll: (selector) => selector === "pre code" ? [known, unknown] : [] };
  fixture.run('fillBody(target, {role:"assistant", content:"**你好**", status:"done"})');
  assert.deepEqual(calls, ["marked", "sanitize", "highlight"]);
});
