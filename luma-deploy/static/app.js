/* Luma · vanilla JavaScript + Axios. All credentials stay in Python. */
"use strict";

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  sparkles: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4ZM20 2v4M18 4h4"/>',
  moon: '<path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  "arrow-up": '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  "arrow-down": '<path d="M12 5v14m-5-5 5 5 5-5"/>',
  "arrow-up-right": '<path d="M6 18 18 6M6 6h12v12"/>',
  feather: '<path d="M20 4c-3-3-8-1-11 3s-3 10-3 11c1 0 7 0 11-3s6-8 3-11ZM3 21 15 9M9 15v-5M13 11h5"/>',
  bulb: '<path d="M9 18h6M9 21h6M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2Z"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
  brain: '<path d="M12 5c-2-4-7-1-6 2-4 0-4 6-1 7-2 4 2 8 5 5l2-2m0-12c2-4 7-1 6 2 4 0 4 6 1 7 2 4-2 8-5 5l-2-2ZM12 5v12M6 7l2 2M5 14l3-1M18 7l-2 2M19 14l-3-1"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  message: '<path d="M21 11.5a8.5 8.5 0 0 1-12.8 7.4L3 21l1.6-5.5A8.5 8.5 0 1 1 21 11.5Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M19 12a7 7 0 0 0-12-5L4 10m16 4-3 3a7 7 0 0 1-12-5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" stroke="none"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.message}</svg>`;
const $ = (selector) => document.querySelector(selector);
document.querySelectorAll("[data-icon]").forEach((element) => { element.innerHTML = icon(element.dataset.icon); });

const STORE = "luma.conversations.v1";
const state = { sessions: [], active: null, generation: null, thinking: false, follow: true, saveWarning: false, model: "deepseek-v4-pro" };
let toastTimer;

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 3300);
}
function uid() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function current() { return state.sessions.find((session) => session.id === state.active); }
function save() {
  try { localStorage.setItem(STORE, JSON.stringify({ sessions: state.sessions, active: state.active })); }
  catch (_error) { if (!state.saveWarning) { toast("浏览器存储不可用或已满，请及时导出重要对话。"); state.saveWarning = true; } }
}
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || "null");
    if (saved && Array.isArray(saved.sessions)) {
      state.sessions = saved.sessions.filter((s) => s && typeof s.id === "string" && typeof s.title === "string" && Array.isArray(s.messages)).map((s) => ({
        ...s, messages: s.messages.filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string").map((m) => ({ ...m, id: m.id || uid(), status: m.status === "streaming" ? "stopped" : m.status })),
      }));
      state.active = state.sessions.some((s) => s.id === saved.active) ? saved.active : null;
    }
    const theme = localStorage.getItem("luma.theme");
    document.body.classList.toggle("dark", theme === "dark");
  } catch (_error) { toast("无法读取历史记录，本次对话仍可正常使用。"); }
  updateThemeButton();
}
function updateThemeButton() {
  const dark = document.body.classList.contains("dark");
  $("#theme-toggle").innerHTML = icon(dark ? "sun" : "moon");
  $("#theme-toggle").setAttribute("aria-label", dark ? "切换浅色模式" : "切换深色模式");
  $("#theme-toggle").title = dark ? "切换浅色模式" : "切换深色模式";
}
function closeMenu() {
  $("#sidebar").classList.remove("open");
  $("#sidebar-shade").hidden = true;
  $("#menu-toggle").setAttribute("aria-expanded", "false");
}
function renderHistory() {
  const list = $("#session-list");
  list.replaceChildren();
  $("#session-count").textContent = state.sessions.length;
  const query = $("#search").value.trim().toLocaleLowerCase();
  const sessions = [...state.sessions].sort((a, b) => (b.updated || 0) - (a.updated || 0)).filter((s) => s.title.toLocaleLowerCase().includes(query) || s.messages.some((m) => m.content.toLocaleLowerCase().includes(query)));
  if (!sessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-history";
    empty.innerHTML = icon("message");
    empty.append(document.createTextNode(query ? "没有找到相关对话" : "这里还很安静。"), document.createElement("br"), document.createTextNode(query ? "试试其他关键词。" : "开启对话，让灵感留下来。"));
    list.append(empty);
  }
  for (const session of sessions) {
    const row = document.createElement("div");
    row.className = `session-item${session.id === state.active ? " active" : ""}`;
    const open = document.createElement("button");
    open.className = "session-open";
    open.innerHTML = `${icon("message")}<span class="session-title"></span>`;
    open.querySelector("span").textContent = session.title;
    open.title = session.title;
    if (session.id === state.active) open.setAttribute("aria-current", "page");
    open.addEventListener("click", () => {
      if (state.active === session.id) { closeMenu(); return; }
      stopGeneration(); state.active = session.id; state.follow = true; save(); render(); closeMenu();
    });
    const remove = document.createElement("button");
    remove.className = "session-delete"; remove.innerHTML = icon("trash"); remove.setAttribute("aria-label", `删除对话：${session.title}`);
    remove.addEventListener("click", () => {
      if (!confirm(`删除“${session.title}”？此操作无法撤销。`)) return;
      if (state.generation?.session.id === session.id) stopGeneration();
      state.sessions = state.sessions.filter((s) => s.id !== session.id);
      if (state.active === session.id) state.active = null;
      save(); render();
    });
    row.append(open, remove); list.append(row);
  }
}
function markdown(text) {
  if (!globalThis.marked || !globalThis.DOMPurify) return null;
  return DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }), { USE_PROFILES: { html: true }, FORBID_TAGS: ["img", "style", "input", "button", "form", "video", "audio"], FORBID_ATTR: ["style"] });
}
function fillBody(element, message) {
  if (!message.content && message.status === "streaming") {
    element.innerHTML = '<span class="typing-dots" aria-label="正在生成"><i></i><i></i><i></i></span>';
    return;
  }
  const html = message.role === "assistant" ? markdown(message.content) : null;
  if (html === null) { element.textContent = message.content; element.style.whiteSpace = "pre-wrap"; }
  else {
    element.innerHTML = html;
    element.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
  }
}
function createMessage(message, session) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`; article.dataset.id = message.id;
  article.innerHTML = '<div class="message-avatar" aria-hidden="true"></div><div class="message-main"><div class="message-meta"><span></span><small></small></div><details class="reasoning" hidden><summary>思考过程</summary><div class="reasoning-content"></div></details><div class="message-body"></div><div class="message-state" hidden></div><div class="message-actions"></div></div>';
  article.querySelector(".message-avatar").textContent = message.role === "user" ? "我" : "✳";
  article.querySelector(".message-meta span").textContent = message.role === "user" ? "你" : "Luma";
  article.querySelector(".message-meta small").textContent = message.role === "assistant" ? (message.thinking ? "深度思考" : "AI 助手") : "";
  fillBody(article.querySelector(".message-body"), message);
  updateMessageParts(article, message);
  const actions = article.querySelector(".message-actions");
  if (message.role === "assistant" && message.status !== "streaming") {
    if (message.content) {
      const copy = document.createElement("button"); copy.innerHTML = `${icon("copy")}复制`;
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(message.content); toast("已复制回复"); }
        catch (_error) { toast("复制失败，请选中文字后手动复制。"); }
      }); actions.append(copy);
    }
    if (message === session.messages.at(-1)) {
      const retry = document.createElement("button"); retry.innerHTML = `${icon("refresh")}${message.error ? "重试" : "重新生成"}`;
      retry.addEventListener("click", () => regenerate(session, message)); actions.append(retry);
    }
  }
  return article;
}
function updateMessageParts(article, message) {
  const reasoning = article.querySelector(".reasoning");
  reasoning.hidden = !message.reasoning;
  article.querySelector(".reasoning-content").textContent = message.reasoning || "";
  reasoning.querySelector("summary").textContent = message.status === "streaming" ? "正在深度思考…" : "思考过程";
  const status = article.querySelector(".message-state");
  const text = message.error || message.notice || (message.status === "stopped" ? "已停止生成" : "");
  status.textContent = text; status.hidden = !text; status.classList.toggle("message-error", Boolean(message.error));
}
function renderMessages() {
  const session = current();
  const hasMessages = Boolean(session?.messages.length);
  $("#welcome").hidden = hasMessages; $("#messages").hidden = !hasMessages;
  $("#messages").replaceChildren();
  if (session) for (const message of session.messages) $("#messages").append(createMessage(message, session));
  $("#page-title").textContent = session?.title || "新对话";
  $("#export-chat").disabled = !hasMessages;
  scrollDown();
}
function render() { renderHistory(); renderMessages(); updateSend(); }
function scrollDown() { if (state.follow) $("#chat-scroll").scrollTop = $("#chat-scroll").scrollHeight; }
function resizeInput() { const input = $("#prompt"); input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 180)}px`; updateSend(); }
function updateSend() {
  const busy = Boolean(state.generation);
  const button = $("#send-button");
  button.disabled = !busy && !$("#prompt").value.trim();
  button.innerHTML = icon(busy ? "stop" : "arrow-up");
  button.classList.toggle("generating", busy);
  button.title = busy ? "停止生成" : "发送消息";
  button.setAttribute("aria-label", busy ? "停止生成" : "发送消息");
  $("#thinking-toggle").disabled = busy;
  const count = $("#prompt").value.length;
  $("#char-count").textContent = count > 2000 ? `${count.toLocaleString()} / 32,000` : "";
}
function stopGeneration() { if (state.generation) { state.generation.stopped = true; state.generation.controller.abort(); } }
function newChat() {
  stopGeneration(); state.active = null; state.follow = true;
  $("#prompt").value = ""; $("#search").value = ""; $("#inline-alert").hidden = true;
  save(); render(); closeMenu(); resizeInput(); $("#prompt").focus();
}
function alertMessage(message) { $("#inline-alert").textContent = message; $("#inline-alert").hidden = false; }

async function generate(session) {
  const history = session.messages.filter((m) => m.content && !m.error).map((m) => ({ role: m.role, content: m.content }));
  if (history.length > 100 || history.reduce((sum, m) => sum + m.content.length, 0) > 100000) {
    alertMessage("当前对话过长，请导出保存后开启新对话。"); return;
  }
  const reply = { id: uid(), role: "assistant", content: "", reasoning: "", thinking: state.thinking, status: "streaming" };
  session.messages.push(reply);
  const generation = { controller: new AbortController(), session, reply, stopped: false };
  state.generation = generation;
  state.follow = true; $("#inline-alert").hidden = true; save(); render();
  let offset = 0; let pending = ""; let receivedDone = false; let receivedError = false; let lastSave = 0;
  function consume(text) {
    if (text.length < offset) return;
    pending += text.slice(offset); offset = text.length;
    const lines = pending.split("\n"); pending = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      if (data.type === "content") reply.content += data.content;
      else if (data.type === "reasoning") reply.reasoning += data.content;
      else if (data.type === "error") { reply.error = data.message; receivedError = true; }
      else if (data.type === "notice") reply.notice = data.message;
      else if (data.type === "done") receivedDone = true;
    }
    if (state.active === session.id) {
      const element = [...$("#messages").children].find((node) => node.dataset.id === reply.id);
      if (element) { fillBody(element.querySelector(".message-body"), reply); updateMessageParts(element, reply); scrollDown(); }
    }
    if (Date.now() - lastSave > 1000) { save(); lastSave = Date.now(); }
  }
  try {
    const response = await axios.post("/api/chat", { messages: history, thinking: state.thinking }, {
      adapter: "xhr", responseType: "text", transformResponse: [(data) => data],
      signal: generation.controller.signal, timeout: 240000,
      onDownloadProgress: (progress) => {
        const text = progress.event?.target?.responseText;
        if (typeof text === "string") consume(text);
      },
    });
    consume(response.data);
    if (!receivedDone && !receivedError) reply.error = "连接提前结束，请重试。";
    if (receivedDone && !reply.content && !receivedError) reply.error = "模型未返回正文，请重试。";
    reply.status = reply.error ? "error" : "done";
  } catch (error) {
    if (generation.stopped || axios.isCancel(error)) reply.status = "stopped";
    else {
      reply.status = "error";
      let detail;
      try { detail = JSON.parse(error.response?.data || "{}").detail; } catch (_error) { /* Non-JSON proxy error. */ }
      reply.error = typeof detail === "string" ? detail : error.code === "ECONNABORTED" ? "等待回复超时，请重试。" : "无法完成请求，请检查后端服务和网络连接。";
    }
  } finally {
    if (state.generation === generation) state.generation = null;
    session.updated = Date.now(); save(); renderHistory();
    if (state.active === session.id) renderMessages();
    updateSend();
  }
}
async function send() {
  if (state.generation) { stopGeneration(); return; }
  if (!globalThis.axios) { alertMessage("Axios 未能加载，请联网后刷新页面（需访问 cdn.jsdelivr.net）。"); return; }
  const content = $("#prompt").value.trim(); if (!content) return;
  let session = current();
  if (!session) {
    if (state.sessions.length >= 50) { alertMessage("最多保留 50 个会话，请先导出或删除部分历史对话。"); return; }
    session = { id: uid(), title: content.replace(/\s+/g, " ").slice(0, 30), updated: Date.now(), messages: [] };
    state.sessions.push(session); state.active = session.id;
  }
  const usable = session.messages.filter((m) => m.content && !m.error);
  if (usable.length >= 100 || usable.reduce((sum, m) => sum + m.content.length, 0) + content.length > 100000) {
    alertMessage("当前对话过长，请导出保存后开启新对话。"); return;
  }
  session.messages.push({ id: uid(), role: "user", content, status: "done" });
  $("#prompt").value = ""; resizeInput();
  await generate(session);
}
function regenerate(session, message) {
  if (state.generation) { toast("请先停止当前生成，再重试。"); return; }
  if (!globalThis.axios) { alertMessage("Axios 未能加载，请联网后刷新页面。"); return; }
  if (session.messages.at(-1) !== message) return;
  session.messages.pop();
  if (session.messages.at(-1)?.role === "user") generate(session);
}
function exportChat() {
  const session = current(); if (!session?.messages.length) { toast("开始对话后即可导出"); return; }
  const text = `# ${session.title}\n\n导出时间：${new Date().toLocaleString("zh-CN")}\n\n` + session.messages.map((m) => `## ${m.role === "user" ? "你" : "Luma"}\n\n${m.content || "（无正文）"}${m.error ? `\n\n> ${m.error}` : ""}\n`).join("\n---\n\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = `Luma-${session.title.replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")}.md`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast("对话已导出为 Markdown");
}
async function checkHealth() {
  if (!globalThis.axios) { $("#connection-status span").textContent = "资源加载失败"; $("#connection-status").classList.add("error"); alertMessage("Axios 未能加载，请联网后刷新页面（需访问 cdn.jsdelivr.net）。"); return; }
  try {
    const { data } = await axios.get("/api/health", { timeout: 6000 });
    state.model = data.model;
    $("#model-name").textContent = data.model === "deepseek-v4-pro" ? "DeepSeek V4 Pro" : data.model;
    $("#about-model").textContent = data.model;
    $("#connection-status span").textContent = data.configured ? "服务已就绪" : "待配置密钥";
    $("#connection-status").classList.toggle("error", !data.configured);
    if (!data.configured) alertMessage("请在后端 .env 中配置 DeepSeek API Key 后重启服务。");
  } catch (_error) { $("#connection-status span").textContent = "服务未连接"; $("#connection-status").classList.add("error"); alertMessage("暂时无法连接后端，请确认 Python 服务已启动。"); }
}

$("#chat-form").addEventListener("submit", (event) => { event.preventDefault(); send(); });
$("#prompt").addEventListener("input", resizeInput);
$("#prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!state.generation) send(); }
});
$("#thinking-toggle").addEventListener("click", () => { state.thinking = !state.thinking; $("#thinking-toggle").setAttribute("aria-pressed", String(state.thinking)); });
$("#new-chat").addEventListener("click", newChat);
$("#search").addEventListener("input", renderHistory);
$("#theme-toggle").addEventListener("click", () => {
  document.body.classList.toggle("dark"); updateThemeButton();
  try { localStorage.setItem("luma.theme", document.body.classList.contains("dark") ? "dark" : "light"); } catch (_error) { /* Theme remains active for this visit. */ }
});
$("#export-chat").addEventListener("click", exportChat);
$("#menu-toggle").addEventListener("click", () => { const open = $("#sidebar").classList.toggle("open"); $("#sidebar-shade").hidden = !open; $("#menu-toggle").setAttribute("aria-expanded", String(open)); });
$("#sidebar-shade").addEventListener("click", closeMenu);
$("#about-button").addEventListener("click", () => $("#about-dialog").showModal());
$("#close-about").addEventListener("click", () => $("#about-dialog").close());
$("#about-dialog").addEventListener("click", (event) => { if (event.target === $("#about-dialog")) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
document.querySelectorAll(".suggestion").forEach((button) => button.addEventListener("click", () => { $("#prompt").value = button.dataset.prompt; resizeInput(); $("#prompt").focus(); }));
$("#chat-scroll").addEventListener("scroll", () => { const node = $("#chat-scroll"); state.follow = node.scrollHeight - node.scrollTop - node.clientHeight < 90; });
document.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); newChat(); }
  if (event.key === "/" && !typing && !$("#about-dialog").open) { event.preventDefault(); $("#search").focus(); if (window.innerWidth <= 680) { $("#sidebar").classList.add("open"); $("#sidebar-shade").hidden = false; $("#menu-toggle").setAttribute("aria-expanded", "true"); } }
  if (event.key === "Escape") closeMenu();
});
load(); render(); resizeInput(); checkHealth();
