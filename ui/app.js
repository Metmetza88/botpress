// BotPress (สำนักข่าวบอท) shell: host bridge, shared store, router, sidebar, modal/toast, small UI helpers.
"use strict";
window.__errors = [];
window.addEventListener("error", e => window.__errors.push(String(e.message)));
window.addEventListener("unhandledrejection", e => window.__errors.push(String(e.reason)));
// optional art (staff portraits, the home masthead) may not be shipped: a broken one is dropped so the initials / page show instead.
// A capture listener because the CSP (script-src 'self') blocks inline onerror="".
document.addEventListener("error", e => { if (e.target.matches?.("img[data-optional]")) e.target.remove(); }, true);
const App = (() => {
  // ---------- host bridge (C# MainWindow.Dispatch) ----------
  const pending = new Map(), subs = new Map();
  let seq = 0;
  const webview = window.chrome && window.chrome.webview;
  if (webview) webview.addEventListener("message", e => {
    const m = e.data;
    if (m.sub != null) { const h = subs.get(m.sub); if (h) h(m); return; }
    if (m.nav) { go(m.nav); return; } // clicked a Windows notification
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || "error"));
  });
  function call(op, args) {
    if (!webview) return Promise.reject(new Error("ต้องเปิดผ่านแอป BotPress"));
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      webview.postMessage({ id, op, args: args || {} });
    });
  }
  // streaming: host sends {sub, event} / {sub, end} / {sub, error}
  function subscribe(op, args, onMsg) {
    const sub = ++seq;
    subs.set(sub, onMsg);
    call(op, Object.assign({ sub }, args)).catch(err => onMsg({ sub, error: err.message }));
    return () => { subs.delete(sub); call("sub.close", { sub }).catch(() => {}); };
  }

  // ---------- helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
    send: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    play: '<path d="M7 5v14l11-7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
    external: '<path d="M14 4h6v6M10 14 20 4M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    inbox: '<path d="M4 13h4l2 3h4l2-3h4M4 13l2-8h12l2 8v6H4z"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
    brain: '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h1V4zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3h-1V4z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    coin: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.5-.9-1.4-1.3-2.5-1.3-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.3 5 3.9 0 1.1-1 1.9-2.5 1.9-1.1 0-2-.4-2.5-1.3M12 6.5v1.7M12 15.8v1.7"/>',
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6M9 10.5h6"/>',
    clip: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.2-8.2a3.3 3.3 0 0 1 4.7 4.7l-8.2 8.2a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4"/>',
  };
  const icon = (n, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24">${ICONS[n] || ""}</svg>`;

  const PALETTE = [["#6d7cff", "#9b7bff"], ["#ff7a59", "#ffb347"], ["#2fd3a0", "#1fa2ff"], ["#ff5fa2", "#ff9a8b"],
    ["#f5b942", "#ff7a59"], ["#5ad1ff", "#6d7cff"], ["#a3e635", "#2fd3a0"], ["#c084fc", "#ff5fa2"]];
  // staff portraits (ui/avatars/<key>.png) for the newsroom's own bots, by exact name; every other bot keeps its initials
  const PORTRAITS = { "บก.บห.": "editor-in-chief", "หัวหน้าข่าว": "news-editor", "นักข่าว AI": "reporter-ai", "นักข่าว Gadget": "reporter-gadget",
    "นักข่าวซอฟต์แวร์": "reporter-software", "นักข่าวสตาร์ทอัพ": "reporter-startup", "นักข่าวไซเบอร์": "reporter-security", "นักข่าวเกม": "reporter-gaming",
    "นักข่าวคลาวด์": "reporter-cloud", "นักข่าวนโยบายเทค": "reporter-policy", "ผู้ตรวจข่าว 1": "checker-1", "ผู้ตรวจข่าว 2": "checker-2",
    "บก.ต้นฉบับ": "copy-editor", "ฝ่ายโซเชียล": "social", "ฝ่ายภาพ": "photo" };
  function hash(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h); }
  function avatar(name, opts = {}) {
    const [a, b] = PALETTE[(opts.color != null ? opts.color : hash(name)) % PALETTE.length];
    // first consonant/letter: Thai leading vowels (เ แ โ ใ ไ) and marks alone make a poor monogram
    const letter = esc((String(name || "").match(/[ก-ฮA-Za-z0-9]/) || ["?"])[0]).toUpperCase();
    const face = Object.hasOwn(PORTRAITS, name) && PORTRAITS[name]; // hasOwn: a bot named "constructor" is not a portrait
    return `<div class="av ${opts.size || ""} ${opts.state || ""}${face ? " photo" : ""}" style="background:linear-gradient(145deg,${a},${b})">${letter}${
      face ? `<img src="avatars/${face}.png" alt="" data-optional>` : ""}</div>`;
  }

  function animateNumber(el, to, decimals = 0, suffix = "") {
    if (!el) return;
    const from = parseFloat(el.dataset.v || "0"), start = performance.now(), dur = 700;
    el.dataset.v = to;
    const fmt = v => v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
    if (from === to) { el.textContent = fmt(to); return; }
    const step = t => {
      const k = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function relTime(ts) {
    if (!ts) return "";
    const d = new Date(ts), now = new Date(), diff = (now - d) / 1000;
    if (diff < 60) return "เมื่อสักครู่";
    if (diff < 3600) return Math.floor(diff / 60) + " นาที";
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "เมื่อวาน";
    return d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  }

  // ---------- toast / modal ----------
  function toast(text, kind = "") {
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<span class="dot ${kind}"></span><span>${esc(text)}</span>`;
    $("#toasts").appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, 3600);
  }
  // only the top modal is live: Tab, clicks and typing can't reach the page or a modal underneath (an Enter guard alone missed ส่ง/mic)
  const inertBehind = () => { const open = [...document.querySelectorAll(".scrim:not(.out)")], top = open.at(-1);
    $(".app").inert = !!top;
    // a closing scrim stays a click shield (its card inert) so the 2nd click of a double-click can't hit the page behind
    for (const s of document.querySelectorAll(".scrim")) { const out = s.classList.contains("out"); s.inert = !out && s !== top; s.firstElementChild.inert = out; } };
  function modal(html, { wide = false, onClose } = {}) {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    scrim.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" tabindex="-1">${html}</div>`;
    const back = document.activeElement; // e.g. the chat composer: left focused, Enter there sent text to the bot behind the card
    const close = () => {
      if (scrim.classList.contains("out")) return;
      scrim.classList.add("out");
      setTimeout(() => scrim.remove(), 500); // fade is 200 ms; 500 = Windows double-click time
      document.removeEventListener("keydown", onKey);
      inertBehind();
      if (back?.isConnected && (back.closest(".scrim:not(.out)") || !document.querySelector(".scrim:not(.out)"))) back.focus(); // never behind a modal
      if (onClose) onClose();
    };
    // stacked modals: Esc closes only the top one
    const onKey = e => { if (e.key === "Escape" && scrim === [...document.querySelectorAll(".scrim:not(.out)")].pop()) close(); };
    // the 2nd click of the double-click that opened this modal lands on it: never let it close the modal or press a card button
    const opened = performance.now(), echo = e => e.detail > 1 && performance.now() - opened < 500;
    scrim.addEventListener("click", e => { if (echo(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
    // preventDefault on every backdrop press (echo or not): focus stays where it is / where close() put it
    scrim.addEventListener("mousedown", e => { if (e.target !== scrim) return; e.preventDefault(); if (!echo(e)) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(scrim);
    inertBehind();
    const el = $(".modal", scrim);
    (el.querySelector("textarea, input:not([type=checkbox]):not([type=radio]), select") || el).focus({ preventScroll: true });
    return { el, close };
  }
  function confirm({ title, body, ok = "ยืนยัน", danger = false }) {
    return new Promise(resolve => {
      let done = false;
      const m = modal(`<h2>${esc(title)}</h2><div class="muted" style="white-space:pre-line">${esc(body)}</div>
        <div class="actions"><button class="btn ghost" data-a="no">ยกเลิก</button>
        <button class="btn ${danger ? "danger" : "primary"}" data-a="yes">${esc(ok)}</button></div>`,
        { onClose: () => { if (!done) resolve(false); } });
      m.el.addEventListener("click", e => {
        const a = e.target.closest("[data-a]");
        if (!a) return;
        done = true; resolve(a.dataset.a === "yes"); m.close();
      });
      setTimeout(() => $(danger ? '[data-a="no"]' : '[data-a="yes"]', m.el).focus(), 50); // Enter must not delete by default
    });
  }
  // run a host op with a spinner on the button and a toast for the outcome
  async function act(btn, label, op, args) {
    const html = btn ? btn.innerHTML : "";
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${esc(label)}`; }
    try { const r = await call(op, args); toast(label + " สำเร็จ", "good"); return r; }
    catch (e) { toast(label + " ไม่สำเร็จ: " + e.message, "bad"); throw e; }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = html; } refresh(); }
  }

  // ---------- system snapshot store (polled) ----------
  const store = { snap: null, history: { vram: [], gpu: [], tps: [], cpu: [] }, listeners: new Set() };
  let polling = false;
  async function refresh() {
    if (polling) return;
    polling = true;
    try {
      const s = await call("snapshot");
      store.snap = s;
      const h = store.history, push = (k, v) => { h[k].push(v); if (h[k].length > 100) h[k].shift(); };
      if (s.gpu) { push("vram", 100 * s.gpu.vramUsed / s.gpu.vramTotal); push("gpu", s.gpu.util); }
      push("tps", s.llm.tps); push("cpu", s.cpuPct);
      store.listeners.forEach(fn => fn(s));
    } catch (e) { /* host busy; next tick retries */ }
    finally { polling = false; }
  }
  const onSnapshot = fn => { store.listeners.add(fn); if (store.snap) fn(store.snap); return () => store.listeners.delete(fn); };

  // ---------- router ----------
  const views = {};
  let current = null, cleanup = null;
  function register(type, render) { views[type] = render; }
  function go(route) {
    current = route;
    if (cleanup) { cleanup(); cleanup = null; }
    const main = $("#main");
    main.innerHTML = "";
    const view = document.createElement("section");
    view.className = "view";
    main.appendChild(view);
    cleanup = (views[route.type] || views.home)(view, route) || null;
    renderSide();
  }
  const route = () => current;

  // ---------- sidebar ----------
  const sideSections = []; // [{ render(filter) -> html, bind(root) }] contributed by chat.js
  const THEMES = [["system", "🖥 ระบบ"], ["light", "☀️ สว่าง"], ["dark", "🌙 มืด"]];
  function renderSide() {
    const q = ($("#search").value || "").trim().toLowerCase();
    const list = $("#sideList"), html = sideSections.map(s => s.render(q)).join("");
    if (html !== list.dataset.html) {
      list.innerHTML = html;
      list.dataset.html = html;
      // entrance animation only for the first real list, not on every refresh
      if (!list.dataset.settled && list.querySelector(".item[data-id]")) setTimeout(() => { list.dataset.settled = 1; }, 900);
    }
    sideSections.forEach(s => s.bind && s.bind(list));
    renderFoot();
  }
  // LLM mode = Rakazo's default model for every bot: local Gemma (data stays here) or BCAiRouter (the gateway on this PC
  // picks a free cloud provider per request, no load on this PC). The host's "synthetic" mode has no button (ลุงจืด 2026-10-04).
  let llmMode = null;
  const LLM_MODES = [["local", "🖥 Local"], ["bcai", "🔀 BCAiRouter"]];
  const LLM_TOAST = { bcai: "บอททุกตัวใช้ BCAiRouter แล้ว (gateway เลือก provider cloud ให้ทีละครั้ง)" };
  async function setLlmMode(mode) {
    try { // no early return when mode === llmMode: the shown mode can be stale until the next re-read
      llmMode = (await call("llm.mode.set", { mode })).mode;
      toast(LLM_TOAST[llmMode] || "บอททุกตัวใช้ Local model แล้ว (ข้อมูลไม่ออกนอกเครื่อง)", "good");
    } catch (e) { toast("สลับโหมดไม่สำเร็จ: " + e.message, "bad"); }
    renderFoot();
  }
  function renderFoot() {
    const s = store.snap, llm = s && s.llm, rk = s && s.rakazo;
    const llmDot = !s ? "" : llm.health === "พร้อม" ? "good" : llm.process ? "warn" : "bad";
    const rkDot = !s ? "" : rk.health.startsWith("พร้อม") ? "good" : "bad";
    // llama-server queue: 2 slots think at once, the rest wait in its own queue
    const q = llmMode === "local" && llm && (llm.busy || llm.deferred) ? `<span class="muted" style="font-size:11px;margin-left:6px">🧠 ${llm.busy} กำลังคิด${llm.deferred ? ` · ${llm.deferred} รอคิว` : ""}</span>` : "";
    $("#sideFoot").innerHTML = `
      ${llmMode ? `<div class="llm-mode" title="โมเดลที่บอททุกตัวใช้">${LLM_MODES.map(([m, t]) => `<button class="${m === llmMode ? "on" : ""}" data-mode="${m}">${t}</button>`).join("")}</div>` : ""}
      <div class="llm-mode" title="ธีมของแอป (ระบบ = ตาม Windows)">${THEMES.map(([t, l]) => `<button class="${t === Theme.choice() ? "on" : ""}" data-theme-pick="${t}">${l}</button>`).join("")}</div>
      <div class="nav ${current && current.type === "desk" ? "active" : ""}" data-go="desk">${icon("book")}<span class="grow">โต๊ะข่าว</span></div>
      <div class="nav ${current && current.type === "work" ? "active" : ""}" data-go="work">${icon("inbox")}
        <span class="grow">ศูนย์งาน</span>${store.waiting ? `<span class="badge" title="งานที่รอคุณ">${store.waiting}</span>` : ""}</div>
      <div class="nav ${current && current.type === "monitor" ? "active" : ""}" data-go="monitor">${icon("activity")}
        <span class="grow">Monitor${q}</span><span class="dot ${llmDot}" title="LLM"></span><span class="dot ${rkDot}" title="Rakazo"></span></div>`;
    $("#sideFoot").querySelectorAll("[data-go]").forEach(n => n.onclick = () => go({ type: n.dataset.go }));
    $("#sideFoot").querySelectorAll("[data-mode]").forEach(b => b.onclick = () => setLlmMode(b.dataset.mode));
    $("#sideFoot").querySelectorAll("[data-theme-pick]").forEach(b => b.onclick = () => { Theme.set(b.dataset.themePick); renderSide(); });
  }

  // opening the app = ready to work: start the LLM and Rakazo if they are down
  async function autostart() {
    await refresh();
    const s = store.snap;
    if (!s) return;
    const jobs = [];
    if (!s.llm.process) jobs.push(["llm.start", "เปิด LLM"]);
    if (!s.rakazo.health.startsWith("พร้อม")) jobs.push(["rakazo.start", "เปิด Rakazo"]);
    for (const [op, label] of jobs) {
      toast(label + "…");
      call(op).then(() => { toast(label + " สำเร็จ", "good"); refresh(); document.dispatchEvent(new CustomEvent("app:services")); },
        e => toast(label + " ไม่สำเร็จ: " + e.message, "bad"));
    }
  }
  function start() {
    $("#search").addEventListener("input", renderSide);
    // home (bot cards + news board summary) was reachable only at start
    $("#brand").onclick = () => go({ type: "home" });
    $("#brand").onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go({ type: "home" }); } };
    onSnapshot(renderFoot);
    // the mode lives in Rakazo, so read it once Rakazo is up and again every 30 s (tests or another window can switch it)
    let modeLoading = false, modeAt = 0;
    onSnapshot(snap => {
      if (modeLoading || Date.now() - modeAt < 30000 || !snap.rakazo.health.startsWith("พร้อม")) return;
      modeLoading = true;
      call("llm.mode").then(m => { modeAt = Date.now(); if (m.mode !== llmMode) { llmMode = m.mode; renderFoot(); } }, () => {}).finally(() => { modeLoading = false; });
    });
    autostart();
    setInterval(refresh, 3000);
    // botpress.sh revive once a minute (was ui/live.js in BotTeam): rejoins the supervisor to computer networks it lost (computer_act
    // then fails with 500 forever), restarts bot computers that died and re-attaches the news desk. ponytail: one WSL call a minute
    setInterval(() => { if (store.snap?.rakazo?.health?.startsWith("พร้อม")) call("rakazo.revive").catch(() => {}); }, 60000);
    document.dispatchEvent(new CustomEvent("app:start"));
    if (!current) go({ type: "home" });
  }
  window.addEventListener("DOMContentLoaded", () => start());

  return { PALETTE, call, subscribe, $, esc, icon, avatar, animateNumber, relTime, toast, modal, confirm, act, store, refresh,
    onSnapshot, register, go, route, renderSide, sideSections };
})();
