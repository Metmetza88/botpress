// News board (โต๊ะข่าว): the newsdesk MCP's stories.json as a kanban, read through the host ("news.list").
// Read-only on purpose: the bots move stories with the mcp__newsdesk__* tools, and publishing stays บก.บห.'s tool call behind
// the owner's approval, so the board sends the owner to บก.บห.'s chat instead of publishing around the bots.
"use strict";
(() => {
  const { $, esc, icon, relTime, toast, modal, call, register, go } = App;
  // same keys and Thai labels as newsdesk/server.mjs (BEATS, STATUS); STATUS order = board column order
  const BEATS = { ai: "AI-โมเดล", gadget: "Gadget-มือถือ", software: "ซอฟต์แวร์-แอป", startup: "สตาร์ทอัพ-ธุรกิจเทค", security: "ความปลอดภัยไซเบอร์",
    gaming: "เกม-สตรีมมิง", cloud: "คลาวด์-ดีเวลอปเปอร์", policy: "นโยบาย-กฎหมายเทค", other: "อื่นๆ" };
  const STATUS = { pitched: "เสนอข่าว", assigned: "มอบหมายแล้ว", drafting: "กำลังเขียน", factcheck: "ตรวจข้อเท็จจริง",
    editing: "เกลาต้นฉบับ", ready: "รอ บก.บห.", published: "เผยแพร่แล้ว", killed: "ไม่ใช้" };
  const STALE_MS = 3 * 3600 * 1000; // a story that has not moved for 3 hours is one หัวหน้าข่าว should chase
  const stale = s => !/^(published|killed)$/.test(s.status) && Date.now() - Date.parse(s.updatedAt) > STALE_MS;
  const beatOf = s => BEATS[s.beat] || s.beat || BEATS.other;
  const srcTag = s => s.sources?.length ? ` · 🔗 ${s.sources.length}` : "";
  const load = () => call("news.list").then(d => Array.isArray(d?.stories) ? d.stories : []);
  const httpUrl = u => /^https?:\/\//i.test(u || ""); // a bot-written "javascript:" source must never become a link
  const when = ts => ts ? new Date(ts).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

  // ---------- home: breaking-news ticker + summary card, both from one news.list per home render ----------
  async function card(el) {
    let stories;
    try { stories = await load(); }
    catch (e) { el.innerHTML = `<div class="card desk-sum muted">อ่านโต๊ะข่าวไม่ได้: ${esc(e.message)}</div>`; return; }
    const n = st => stories.filter(s => s.status === st).length, late = stories.filter(stale).length;
    // ticker: the 8 most recently moved stories (killed ones are not news); the 2nd copy only makes the loop seamless
    const latest = stories.filter(s => s.status !== "killed").sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 8);
    const ticks = tab => latest.map(s => `<button class="tick" data-id="${esc(s.id)}" ${tab}title="${esc(STATUS[s.status] || s.status)}">${esc(s.headline || s.title)}</button>`).join("");
    el.innerHTML = (latest.length ? `<div class="ticker"><span class="ticker-label">ข่าวด่วน</span><div class="ticker-view">
      <div class="ticker-track" style="animation-duration:${latest.length * 7}s"><div class="ticker-group">${ticks("")}</div>
      <div class="ticker-group" aria-hidden="true">${ticks('tabindex="-1" ')}</div></div></div></div>` : "") + `<div class="card desk-sum" role="button" tabindex="0" title="เปิดโต๊ะข่าว"><h3>${icon("book")}โต๊ะข่าว<span class="grow"></span>${stories.length} เรื่อง</h3>
      <div class="row wrap" style="gap:8px">${Object.entries(STATUS).map(([k, t]) => `<span class="chip ${k === "ready" && n(k) ? "warn" : ""}">${esc(t)} <b>${n(k)}</b></span>`).join("")}
        ${late ? `<span class="chip bad">ค้างเกิน 3 ชม. <b>${late}</b></span>` : ""}</div></div>`;
    const ticker = $(".ticker", el);
    if (ticker) ticker.onclick = e => { // open the story's reader over the board
      const t = e.target.closest(".tick");
      if (t) { go({ type: "desk" }); reader(stories.find(s => s.id === t.dataset.id)); }
    };
    const c = $(".desk-sum", el);
    c.onclick = () => go({ type: "desk" });
    c.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go({ type: "desk" }); } };
  }

  // ---------- reader ----------
  function reader(s) {
    if (!s) return;
    const sec = (title, html) => html ? `<div class="reader-sec"><h3>${esc(title)}</h3>${html}</div>` : "";
    const src = s.sources || [], hist = s.history || [];
    const m = modal(`<div class="row"><h2 class="headline" style="margin:0;min-width:0">${esc(s.headline || s.title)}</h2><span class="grow"></span>
        <button class="btn ghost icon sm" data-x title="ปิด">${icon("x")}</button></div>
      <div class="row wrap muted" style="gap:8px;margin-top:8px;font-size:12.5px"><span class="chip">${esc(STATUS[s.status] || s.status)}</span><span class="chip">${esc(beatOf(s))}</span>
        <span>${esc(s.id)} · ${esc(s.reporter || "ยังไม่มีนักข่าว")} · อัปเดต ${esc(relTime(s.updatedAt))}</span></div>
      ${s.status === "ready" ? `<div class="row" style="margin-top:14px"><span class="muted grow">ข่าวพร้อมแล้ว รอ บก.บห. เผยแพร่ (ทุกครั้งต้องผ่านการอนุมัติของคุณ)</span>
        <button class="btn primary sm" data-chief>${icon("chat")}ไปแชท บก.บห.</button></div>` : ""}
      ${sec("หัวข้อที่เสนอ", s.headline && s.headline !== s.title ? esc(s.title) : "")}
      ${sec("มุมข่าว", esc(s.angle))}
      ${sec("เนื้อข่าว", s.body ? `<div class="md">${App.md(s.body)}</div>` : `<div class="muted">ยังไม่มีเนื้อข่าว</div>`)}
      ${sec(`แหล่งอ้างอิง (${src.length})`, src.length ? `<ul>${src.map(x => `<li>${httpUrl(x.url)
        ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title || x.url)}</a>` : esc(x.title || x.url)}</li>`).join("")}</ul>` : "")}
      ${sec("ผลตรวจข้อเท็จจริง", s.factcheck ? `<div class="md">${App.md(s.factcheck)}</div>` : "")}
      ${sec("บรีฟภาพ", s.image ? `<div class="reader-pre">${esc(s.image)}</div>` : "")}
      ${sec("ข้อความโซเชียล (ร่าง ยังไม่โพสต์)", s.social ? `<div class="reader-pre">${esc(s.social)}</div>` : "")}
      ${sec("ไฟล์ที่เผยแพร่", esc(s.publishedFile))}
      ${sec("ประวัติ", hist.length ? `<div class="timeline">${hist.map(h => `<div><span class="muted">${esc(when(h.at))}</span> <b>${esc(h.by)}</b>
        ${h.from && h.from !== h.to ? esc(STATUS[h.from] || h.from) + " → " : ""}${esc(STATUS[h.to] || h.to)}${h.note ? ` <span class="muted">· ${esc(h.note)}</span>` : ""}</div>`).join("")}</div>` : "")}`,
      { wide: true });
    $("[data-x]", m.el).onclick = m.close;
    const chief = $("[data-chief]", m.el);
    if (chief) chief.onclick = () => {
      const b = App.chat.state.bots.find(x => x.name === "บก.บห.");
      if (!b) return toast("ไม่พบบอทชื่อ บก.บห.", "warn");
      m.close(); go({ type: "bot", id: b.id });
    };
  }

  // ---------- board ----------
  register("desk", view => {
    let beat = "", showKilled = false, stories = [], sig = "", alive = true;
    view.innerHTML = `<div class="page"><div class="page-head"><div><h1>โต๊ะข่าว</h1>
        <div class="sub">ข่าวทุกชิ้นตั้งแต่เสนอจนเผยแพร่ · บอทย้ายสถานะเองผ่านเครื่องมือ newsdesk · อัปเดตทุก 5 วินาที</div></div><span class="grow"></span>
        <select class="input" id="d-beat" style="width:auto" title="กรองตามสายข่าว"><option value="">ทุกสาย</option>${Object.entries(BEATS).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join("")}</select>
        <button class="btn" id="d-folder">${icon("folder")}เปิดโฟลเดอร์ข่าว</button></div>
      <div id="d-board"><div class="card skeleton" style="height:140px"></div></div></div>`;
    const board = $("#d-board", view);
    function draw() {
      if (!stories.length) {
        board.innerHTML = `<div class="empty" style="min-height:40vh"><div><div class="float" style="font-size:44px">📰</div><h2>ยังไม่มีข่าวบนโต๊ะ</h2>
          <div class="muted">เมื่อนักข่าวเสนอข่าว เรื่องจะขึ้นที่นี่ · ลองสั่งในห้องข่าว เช่น "@everyone เสนอข่าวเด่นวันนี้คนละ 1 เรื่องพร้อมลิงก์"</div></div></div>`;
        return;
      }
      const list = stories.filter(s => !beat || s.beat === beat);
      board.innerHTML = `<div class="board">${Object.entries(STATUS).map(([k, t]) => {
        const col = list.filter(s => s.status === k).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), shut = k === "killed" && !showKilled;
        return `<div class="board-col ${shut ? "shut" : ""}" data-status="${k}"><div class="board-head" ${k === "killed" ? `data-killed role="button" tabindex="0" title="${shut ? "แสดง" : "ซ่อน"}ข่าวที่ไม่ใช้"` : ""}>${esc(t)}<span>${col.length}</span></div>
          ${shut ? "" : col.map(s => `<div class="card story ${stale(s) ? "stale" : ""}" data-id="${esc(s.id)}" tabindex="0">
            <div class="story-h">${esc(s.headline || s.title)}</div><div class="story-meta"><span class="chip">${esc(beatOf(s))}</span></div>
            <div class="story-meta muted">${esc(s.reporter || "ยังไม่มีนักข่าว")} · ${esc(relTime(s.updatedAt))}${srcTag(s)}${stale(s) ? ` · <b class="stale-tag">ค้างเกิน 3 ชม.</b>` : ""}</div></div>`).join("")}</div>`;
      }).join("")}</div>`;
    }
    board.addEventListener("click", e => {
      if (e.target.closest("[data-killed]")) { showKilled = !showKilled; return draw(); }
      const c = e.target.closest(".story");
      if (c) reader(stories.find(s => s.id === c.dataset.id));
    });
    board.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches(".story, [data-killed]")) e.target.click(); });
    $("#d-beat", view).onchange = e => { beat = e.target.value; if (sig) draw(); };
    $("#d-folder", view).onclick = () => call("news.folder").catch(e => toast("เปิดโฟลเดอร์ข่าวไม่สำเร็จ: " + e.message, "bad"));
    async function poll() {
      try {
        const next = await load();
        // the minute is part of it: ages and the 3-hour flag move with the clock even when no story does
        const s = JSON.stringify(next) + "|" + Math.floor(Date.now() / 60000);
        if (!alive || s === sig) return;
        sig = s; stories = next; draw();
      } catch (e) { if (alive && !sig) board.innerHTML = `<div class="muted" style="padding:24px">อ่านโต๊ะข่าวไม่ได้: ${esc(e.message)}</div>`; }
    }
    poll();
    const timer = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(timer); };
  });

  App.news = { card };
})();
