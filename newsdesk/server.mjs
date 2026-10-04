// Newsdesk: story pipeline for a Thai tech/AI news office run by LLM bots (local Gemma 4, so tool schemas stay small and
// every error is plain Thai the model can read and retry). MCP over Streamable HTTP, stateless JSON responses, zero deps.
// Rakazo only lets bots reach http://localhost or public https, so this binds loopback only inside the container.
// Stories live in memory and are mirrored to $NEWS_DIR/stories.json after every mutation (tmp + rename). publish_story is
// deliberately single-purpose (one story -> one .md file) so Rakazo can put a human approval in front of it.
// usage: node server.mjs            (serves 127.0.0.1:7790/mcp; NEWS_PORT overrides; token + data in $NEWS_DIR, default /news)
//        node server.mjs --selftest (temp dir + ephemeral port, touches nothing else)
// BEATS and STATUS (key -> Thai label) are named exports for other code; importing this file does not start the server.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const PORT = process.env.NEWS_PORT ? Number(process.env.NEWS_PORT) : 7790; // "0" = random port; unset or empty = default
const MAX_BODY = 1e6;
export const BEATS = {
  ai: "AI-โมเดล", gadget: "Gadget-มือถือ", software: "ซอฟต์แวร์-แอป", startup: "สตาร์ทอัพ-ธุรกิจเทค", security: "ความปลอดภัยไซเบอร์",
  gaming: "เกม-สตรีมมิง", cloud: "คลาวด์-ดีเวลอปเปอร์", policy: "นโยบาย-กฎหมายเทค", other: "อื่นๆ",
};
export const STATUS = {
  pitched: "เสนอข่าว", assigned: "มอบหมายแล้ว", drafting: "กำลังเขียน", factcheck: "ตรวจข้อเท็จจริง",
  editing: "เกลาต้นฉบับ", ready: "รอ บก.บห.", published: "เผยแพร่แล้ว", killed: "ไม่ใช้",
};
// The whole workflow in one table: published (via publish_story only) and killed are final. "ready" is content-locked
// (update_story refuses field edits there) so the human approval of publish_story covers exactly what gets published;
// the only way to change it is ready -> editing with a note.
const NEXT = {
  pitched: ["assigned", "killed"], assigned: ["drafting", "killed"], drafting: ["factcheck", "killed"],
  factcheck: ["editing", "drafting", "killed"], editing: ["ready", "drafting", "killed"], ready: ["published", "editing", "killed"],
  published: [], killed: [],
};
const listOf = table => Object.entries(table).map(([k, l]) => `${k} (${l})`).join(", ");
// What a story must have (after applying this call's edits) before it may enter a status. killed needs a note, checked separately.
const NEEDS = {
  assigned: [["reporter", s => s.reporter]],
  factcheck: [["headline", s => s.headline], ["body", s => s.body], ["sources (อย่างน้อย 1 แหล่ง)", s => s.sources.length]],
  editing: [["factcheck (บันทึกผลตรวจข้อเท็จจริง)", s => s.factcheck]],
  ready: [["headline", s => s.headline], ["body", s => s.body],
    ["social (ข้อความโซเชียล — ฝ่ายโซเชียลเป็นคนเขียน)", s => s.social], ["image (บรีฟภาพ — ฝ่ายภาพเป็นคนเขียน)", s => s.image]],
};
const lab = k => `${k} (${STATUS[k]})`;
const nextOf = st => NEXT[st].map(x => (x === "published" ? `published (${STATUS.published}, ใช้ publish_story)` : lab(x))).join(", ") || "ไม่มี (สถานะสุดท้าย)";

const bkk = ms => new Date(ms + 7 * 3600e3).toISOString(); // Asia/Bangkok wall clock (UTC+7, no DST) as ISO text
const today = ms => bkk(ms).slice(0, 10);

// ---------- validation (args come from an LLM: trust nothing) ----------
class Bad extends Error {} // user-facing validation error: the message goes back to the model verbatim
const bad = m => { throw new Bad(m); };

// Trimmed string or undefined when empty/absent. Single-line fields collapse whitespace so a headline can't smuggle
// newlines into the markdown file.
function str(a, key, max, { req = false, multi = false, name = key } = {}) {
  let v = a[key] ?? "";
  if (typeof v !== "string") bad(`${name} ต้องเป็นข้อความ (string)`);
  v = multi ? v.replace(/\r\n?/g, "\n").trim() : v.replace(/\s+/g, " ").trim();
  if (!v) return req ? bad(`ต้องระบุ ${name} (ห้ามว่าง)`) : undefined;
  if (v.length > max) bad(`${name} ยาวเกินกำหนด: ${v.length} ตัวอักษร (สูงสุด ${max})`);
  return v;
}

// Accepts the key, the Thai label or a known alias (case-insensitive) and returns the key; used for beats and statuses.
function pick(a, key, table, req = false, aliases = {}) {
  const v = str(a, key, 60, { req });
  if (v === undefined) return undefined;
  const lc = v.toLowerCase();
  return Object.keys(table).find(k => k === lc || table[k].toLowerCase() === lc) || aliases[lc] || bad(`${key} ไม่ถูกต้อง: "${v.slice(0, 40)}" — ใช้ได้เฉพาะ ${listOf(table)}`);
}
// "เกม-สตรีมมิ่ง" was the label before the Royal Institute spelling "เกม-สตรีมมิง"; bots may still send it.
const pickBeat = (a, req) => pick(a, "beat", BEATS, req, { "เกม-สตรีมมิ่ง": "gaming" });

function srcs(a) {
  const v = a.sources;
  if (v == null || (Array.isArray(v) && !v.length)) return undefined; // [] = "not provided": models send it for "no change"
  if (!Array.isArray(v)) bad('sources ต้องเป็นรายการ เช่น [{"url":"https://...","title":"ชื่อแหล่ง"}]');
  if (v.length > 10) bad(`sources มากเกินไป: ${v.length} แหล่ง (สูงสุด 10)`);
  return v.map((x, i) => {
    const o = typeof x === "string" ? { url: x } : x, name = `sources[${i}]`;
    if (!o || typeof o !== "object" || Array.isArray(o)) bad(`${name} ต้องเป็น URL หรือ {url, title}`);
    const url = str(o, "url", 500, { req: true, name: name + ".url" });
    let u; try { u = new URL(url); } catch { bad(`${name}.url ไม่ใช่ URL ที่ถูกต้อง: ${url.slice(0, 80)}`); }
    if (u.protocol !== "http:" && u.protocol !== "https:") bad(`${name}.url ต้องขึ้นต้นด้วย http:// หรือ https://`);
    return { url: u.href, title: str(o, "title", 200, { name: name + ".title" }) || "" }; // href: spaces/Thai encoded, safe inside a markdown link
  });
}

// ---------- storage ----------
// tmp + fsync + rename: a crash or power loss never leaves a half-written or empty file under the real name.
function writeAtomic(file, data) {
  const fd = fs.openSync(file + ".tmp", "w");
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(file + ".tmp", file);
}

// ponytail: whole db rewritten per mutation, fine for hundreds of stories; move to append-only/SQLite if it grows to thousands.
function openDesk(dir, now = Date.now) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "stories.json");
  let db = { seq: {}, stories: [] };
  try { db = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; } // corrupt file: refuse to start rather than overwrite it
  if (!db || !db.seq || typeof db.seq !== "object" || !Array.isArray(db.stories)) throw new Error(`${file} รูปแบบไม่ถูกต้อง`);
  const d = {
    dir, now, db,
    // Mutate, persist; if persisting fails restore memory from the pre-mutation snapshot so RAM never gets ahead of disk.
    commit(fn) {
      const before = JSON.stringify(d.db);
      try { const r = fn(); writeAtomic(file, JSON.stringify(d.db)); return r; } catch (e) { d.db = JSON.parse(before); throw e; }
    },
  };
  return d;
}

function loadToken(dir) {
  const f = path.join(dir, ".token");
  try { const t = fs.readFileSync(f, "utf8").trim(); if (t) return t; } catch (e) { if (e.code !== "ENOENT") throw e; }
  const t = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(f, t + "\n", { mode: 0o600 });
  return t;
}

// ---------- story helpers ----------
const find = (d, a) => {
  const id = str(a, "id", 40, { req: true });
  return d.db.stories.find(s => s.id === id) || bad(`ไม่พบเรื่อง ${id} — ใช้ list_stories ดูรหัสที่มีอยู่`);
};
const link = x => `- [${(x.title || x.url).replace(/[[\]]/g, "\\$&")}](${x.url.replace(/[()]/g, c => (c === "(" ? "%28" : "%29"))})`;
const render = (s, when) => [
  `# ${s.headline}`, `> สาย: ${BEATS[s.beat]} · นักข่าว: ${s.reporter} · เผยแพร่: ${when}`, "", s.body, "",
  ...(s.image ? ["## ภาพประกอบ (บรีฟ)", s.image, ""] : []),
  "## แหล่งอ้างอิง", ...s.sources.map(link),
  ...(s.social ? ["", "## ข้อความโซเชียล", s.social] : []),
  ...(s.factcheck ? ["", "## ผลตรวจข้อเท็จจริง", s.factcheck] : []),
].join("\n") + "\n";

// ---------- MCP tools ----------
const S = (props, required = []) => ({ type: "object", properties: props, required });
const T = description => ({ type: "string", description });
const ID = T("รหัสเรื่อง เช่น 20261004-01");
const BY = T("ชื่อผู้เรียก (บอทของคุณ)");
const BEAT = T(`สาย: ${listOf(BEATS)}`);
const SRC = { type: "array", maxItems: 10, description: "แหล่งอ้างอิง สูงสุด 10 แหล่ง", items: S({ url: T("ลิงก์ http/https"), title: T("ชื่อแหล่ง (ไม่บังคับ)") }, ["url"]) };

const TOOLS = {
  pitch_story: {
    description: "เสนอข่าวใหม่เข้าโต๊ะข่าว (ปกตินักข่าว/ผู้ติดตามข่าวเรียก) ได้รหัสเรื่อง สถานะเริ่มต้น pitched",
    inputSchema: S({ by: BY, title: T("หัวข้อข่าวที่เสนอ (ไม่เกิน 200 ตัวอักษร)"), beat: BEAT, angle: T("มุมข่าว/เหตุผลที่น่าสนใจ (ไม่เกิน 1000 ตัวอักษร)"), sources: SRC }, ["by", "title", "beat", "angle"]),
    run(d, a) {
      const by = str(a, "by", 60, { req: true }), title = str(a, "title", 200, { req: true }), beat = pickBeat(a, true);
      const angle = str(a, "angle", 1000, { req: true, multi: true }), sources = srcs(a) || [];
      const at = new Date(d.now()).toISOString(), day = today(d.now()).replace(/-/g, "");
      return d.commit(() => {
        const n = (d.db.seq[day] || 0) + 1;
        d.db.seq[day] = n;
        const id = `${day}-${String(n).padStart(2, "0")}`;
        d.db.stories.push({ id, title, beat, angle, reporter: "", headline: "", body: "", sources, factcheck: "", social: "", image: "", status: "pitched",
          createdAt: at, updatedAt: at, publishedFile: null, history: [{ at, by, from: null, to: "pitched", note: "" }] });
        return { text: `เสนอข่าวแล้ว: รหัส ${id} สถานะ pitched (สาย ${BEATS[beat]}) — ขั้นถัดไป: ${nextOf("pitched")}`, data: { id, status: "pitched" } };
      });
    },
  },
  list_stories: {
    description: "ดูรายการเรื่องข่าว (ไม่มีเนื้อหา) เรียงใหม่สุดก่อน (ทุกคนเรียกได้) ถ้าไม่ใส่ status จะแสดงเฉพาะเรื่องที่ \"ยังไม่จบ\" (ไม่รวม published/killed); "
      + "ใส่ status=published หรือ killed เพื่อดูเรื่องที่จบแล้ว หรือ all=true เพื่อดูทุกเรื่อง; กรองด้วย beat ได้",
    inputSchema: S({
      status: T(`กรองตามสถานะ (ไม่ใส่ = เฉพาะเรื่องที่ยังไม่จบ): ${listOf(STATUS)}`), beat: BEAT,
      all: { type: "boolean", description: "true = รวมทุกสถานะ (รวม published/killed) เมื่อไม่ได้ใส่ status" },
      limit: { type: "integer", minimum: 1, maximum: 100, description: "จำนวนสูงสุด (ปกติ 30)" },
    }),
    run(d, a) {
      const status = pick(a, "status", STATUS), beat = pickBeat(a), includeAll = a.all === true || a.all === "true";
      const scope = status ? `สถานะ ${lab(status)}` : includeAll ? "ทุกสถานะ" : "ยังไม่จบ";
      let limit = 30;
      if (a.limit != null && a.limit !== "") { limit = Number(a.limit); if (!Number.isInteger(limit) || limit < 1 || limit > 100) bad("limit ต้องเป็นจำนวนเต็ม 1-100"); }
      // reverse first so equal timestamps still list the later-created story first (sort is stable)
      const wanted = s => (status ? s.status === status : includeAll || (s.status !== "published" && s.status !== "killed"));
      const all = d.db.stories.filter(s => wanted(s) && (!beat || s.beat === beat)).reverse()
        .sort((x, y) => (x.updatedAt < y.updatedAt ? 1 : x.updatedAt > y.updatedAt ? -1 : 0));
      const rows = all.slice(0, limit).map(s => ({ id: s.id, status: s.status, beat: s.beat, title: s.headline || s.title, reporter: s.reporter, updatedAt: s.updatedAt,
        sources: s.sources.length, hasSocial: !!s.social, hasImage: !!s.image })); // flags let the copy editor see what is missing without get_story
      const lines = rows.map(r => `${r.id} [${r.status}] ${BEATS[r.beat]} | ${r.title} | นักข่าว: ${r.reporter || "-"} | แหล่ง ${r.sources} | โซเชียล ${r.hasSocial ? "มี" : "ไม่มี"} | ภาพ ${r.hasImage ? "มี" : "ไม่มี"} | ${r.updatedAt}`);
      return { text: all.length ? `พบ ${all.length} เรื่อง [${scope}]${all.length > rows.length ? ` (แสดง ${rows.length} เรื่องล่าสุด)` : ""}\n${lines.join("\n")}` : `ไม่พบเรื่อง [${scope}] ตามเงื่อนไข`, data: { total: all.length, stories: rows } };
    },
  },
  get_story: {
    description: "อ่านเรื่องข่าวฉบับเต็ม (เนื้อหา แหล่งอ้างอิง ประวัติ) ตามรหัสเรื่อง (ทุกคนเรียกได้)",
    inputSchema: S({ id: ID }, ["id"]),
    run: (d, a) => {
      const s = find(d, a), out = { ...s, nextStatuses: NEXT[s.status] };
      return { text: JSON.stringify(out, null, 1) + `\nขั้นถัดไปที่ทำได้: ${nextOf(s.status)}`, data: out };
    },
  },
  update_story: {
    description: "แก้เนื้อหาและ/หรือเปลี่ยนสถานะเรื่องข่าว (บรรณาธิการ/นักข่าว/ผู้ตรวจข้อเท็จจริงเรียกตามขั้นตอน) ส่งเฉพาะฟิลด์ที่จะแก้ "
      + "ลำดับ: pitched→assigned→drafting→factcheck→editing→ready; factcheck/editing ส่งกลับ drafting ได้; ready ส่งกลับ editing ได้ (ต้องใส่ note); killed ได้ทุกขั้น (ต้องใส่ note). "
      + "ก่อนเข้า assigned ต้องมี reporter; factcheck ต้องมี headline+body+sources อย่างน้อย 1; editing ต้องมี factcheck ใหม่ (เข้า factcheck แล้วผลตรวจเก่าจะถูกล้าง); ready ต้องมี headline+body+social (ฝ่ายโซเชียลเขียน)+image (ฝ่ายภาพเขียนบรีฟ). "
      + "ใน ready แก้เนื้อหาไม่ได้ (ต้องส่งกลับ editing ก่อน). ตั้ง published ที่นี่ไม่ได้ ใช้ publish_story. sources ที่ส่งมาจะแทนที่รายการเดิมทั้งหมด",
    inputSchema: S({
      id: ID, by: BY, status: T(`สถานะใหม่ (ไม่เปลี่ยน = ไม่ต้องส่ง): ${listOf(STATUS)} — published ตั้งผ่าน publish_story เท่านั้น`),
      reporter: T("ชื่อนักข่าวที่รับงาน (ไม่เกิน 60)"), headline: T("พาดหัว (ไม่เกิน 200)"), body: T("เนื้อข่าว markdown (ไม่เกิน 20000)"),
      sources: SRC, factcheck: T("บันทึกผลตรวจข้อเท็จจริง (ไม่เกิน 4000)"), social: T("ข้อความโพสต์โซเชียล (ไม่เกิน 2000)"),
      image: T("บรีฟภาพ: ไอเดียภาพหลัก คำบรรยายภาพ alt text แหล่งภาพ (ไม่เกิน 2000)"), note: T("หมายเหตุลงประวัติ (ไม่เกิน 1000) — ต้องมีเมื่อ status=killed หรือส่งกลับจาก ready ไป editing"),
    }, ["id", "by"]),
    run(d, a) {
      const s = find(d, a), by = str(a, "by", 60, { req: true }), from = s.status;
      if (from === "published" || from === "killed") bad(`เรื่อง ${s.id} อยู่สถานะ ${from} (สถานะสุดท้าย) แก้ไขไม่ได้`);
      const f = { reporter: str(a, "reporter", 60), headline: str(a, "headline", 200), body: str(a, "body", 20000, { multi: true }),
        sources: srcs(a), factcheck: str(a, "factcheck", 4000, { multi: true }), social: str(a, "social", 2000, { multi: true }), image: str(a, "image", 2000, { multi: true }) };
      const note = str(a, "note", 1000, { multi: true }), fields = Object.keys(f).filter(k => f[k] !== undefined);
      if (from === "ready" && fields.length) bad("เรื่องอยู่สถานะ ready (รอ บก.บห. อนุมัติ) แก้เนื้อหาไม่ได้ — ถ้าต้องแก้ ให้ส่งกลับก่อนด้วย update_story status=editing พร้อม note บอกสิ่งที่ต้องแก้ (ส่งแค่ status กับ note) แล้วค่อยแก้ในสถานะ editing");
      let to = pick(a, "status", STATUS);
      if (to === "published") bad("ตั้งสถานะ published ด้วย update_story ไม่ได้ — ใช้ publish_story (เรื่องต้องอยู่สถานะ ready)");
      if (to === from) to = undefined; // models resend the current status along with a field edit: treat as a plain edit
      if (!to && !fields.length) bad("ไม่ได้ระบุสิ่งที่จะแก้ — ส่ง status หรืออย่างน้อย 1 ฟิลด์ (reporter, headline, body, sources, factcheck, social, image)");
      if (to) {
        if (!NEXT[from].includes(to)) bad(`ย้ายสถานะจาก ${lab(from)} ไป ${lab(to)} ไม่ได้ — จาก ${lab(from)} ไปได้เฉพาะ: ${nextOf(from)}`);
        const needNote = to === "killed" ? "ยกเลิกเรื่อง (killed) ต้องใส่ note บอกเหตุผล" : from === "ready" && to === "editing" ? "ส่งกลับ editing ต้องใส่ note บอกสิ่งที่ต้องแก้" : "";
        if (needNote && !note) bad(needNote);
        // entering factcheck wipes the old note (below), so a factcheck sent in the same call would be silently lost
        if (to === "factcheck" && f.factcheck !== undefined) bad("ส่ง factcheck พร้อมย้ายเข้า factcheck ไม่ได้ (ผลตรวจเก่าจะถูกล้างตอนเข้า) — ย้ายสถานะก่อน แล้วค่อยบันทึก factcheck ในคำสั่งถัดไป");
        const merged = { ...s, ...Object.fromEntries(fields.map(k => [k, f[k]])) };
        const miss = (NEEDS[to] || []).filter(([, has]) => !has(merged)).map(([label]) => label);
        if (miss.length) bad(`ย้ายไป ${to} ไม่ได้ ยังขาด: ${miss.join(", ")} — ส่งมาพร้อมกันในคำสั่งนี้ได้`);
      }
      const at = new Date(d.now()).toISOString();
      d.commit(() => {
        for (const k of fields) s[k] = f[k];
        // a fresh fact-check note is required before editing; the old one must not re-pass that gate (kept in history instead)
        const cleared = to === "factcheck" ? s.factcheck : "";
        if (to === "factcheck") s.factcheck = "";
        if (to) s.status = to;
        s.updatedAt = at;
        s.history.push({ at, by, from, to: to || from,
          note: [note, fields.length && `แก้ไข: ${fields.join(", ")}`, cleared && `ล้างผลตรวจเดิม: ${cleared}`].filter(Boolean).join(" | ") });
      });
      return { text: `อัปเดต ${s.id} แล้ว — สถานะ ${s.status}${to ? ` (จาก ${from})` : ""} · แก้: ${fields.join(", ") || "-"} · ขั้นถัดไป: ${nextOf(s.status)}`,
        data: { id: s.id, status: s.status, from, changed: fields, updatedAt: at } };
    },
  },
  publish_story: {
    description: "เผยแพร่เรื่องที่อยู่สถานะ ready เป็นไฟล์ .md (บรรณาธิการบริหารเรียก ต้องมีคนอนุมัติ) ทำได้ครั้งเดียวต่อเรื่อง "
      + "title = พาดหัวปัจจุบันของข่าว ตรงตัว เพื่อให้คนอนุมัติเห็นว่ากำลังเผยแพร่ข่าวไหน",
    inputSchema: S({ id: ID, by: BY, title: T("พาดหัวปัจจุบันของข่าว ตรงตัว (ดูจาก get_story)") }, ["id", "by", "title"]),
    run(d, a) {
      const s = find(d, a), by = str(a, "by", 60, { req: true }), title = str(a, "title", 200, { req: true });
      if (s.status === "published") bad(`เรื่อง ${s.id} เผยแพร่ไปแล้ว (ไฟล์ ${s.publishedFile}) เผยแพร่ซ้ำไม่ได้`);
      if (s.status !== "ready") bad(`เผยแพร่ได้เฉพาะเรื่องสถานะ ready — ${s.id} อยู่สถานะ ${s.status}`);
      // The approval card only shows a few argument names, so title is the human's view of WHICH story is going out:
      // it must match the real headline (str() already trimmed and collapsed whitespace on both sides of the comparison).
      if (title !== s.headline) bad(`title ไม่ตรงกับพาดหัวปัจจุบันของเรื่อง ${s.id}: "${s.headline}" — เรียก publish_story ใหม่โดยใส่ title = "${s.headline}" ตรงตัว`);
      const ms = d.now(), day = today(ms), rel = `${day}/${s.id}.md`, full = path.join(d.dir, rel), at = new Date(ms).toISOString();
      if (fs.existsSync(full)) bad(`ไฟล์ ${rel} มีอยู่แล้ว เผยแพร่ไม่ได้ ห้ามเรียกซ้ำ แจ้งมนุษย์ตรวจสอบ`);
      // File first (nothing changed if it fails); if saving the state fails afterwards remove it again, so a story still
      // marked ready never has an orphan .md that a human could mistake for published.
      fs.mkdirSync(path.join(d.dir, day), { recursive: true });
      writeAtomic(full, render(s, `${day} ${bkk(ms).slice(11, 16)} น.`));
      try {
        d.commit(() => {
          s.status = "published"; s.publishedFile = rel; s.updatedAt = at;
          s.history.push({ at, by, from: "ready", to: "published", note: `เผยแพร่ ${rel}` });
        });
      } catch (e) { fs.rmSync(full, { force: true }); throw e; }
      return { text: `เผยแพร่ ${s.id} แล้ว — ไฟล์ ${rel}`, data: { id: s.id, status: "published", publishedFile: rel } };
    },
  },
};

const err = text => ({ content: [{ type: "text", text: "ผิดพลาด: " + text }], isError: true });
const argsOf = v => { // some local models send arguments as a JSON string
  if (typeof v === "string") try { v = JSON.parse(v); } catch { /* falls through to {} */ }
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
};

// Validation errors come back as a normal tool result with isError so the model sees the Thai text and can fix and retry.
function callTool(d, name, args) {
  if (!Object.hasOwn(TOOLS, name)) return err(`ไม่มีเครื่องมือชื่อ "${String(name).slice(0, 60)}" — ใช้ได้: ${Object.keys(TOOLS).join(", ")}`);
  try {
    const r = TOOLS[name].run(d, argsOf(args));
    return { content: [{ type: "text", text: r.text }], structuredContent: { result: r.data } };
  } catch (e) {
    if (e instanceof Bad) return err(e.message);
    console.error(e); // real cause stays in the server log; the model gets a generic line (no paths leaked)
    return err("ระบบขัดข้องภายใน ห้ามเรียกซ้ำ ให้แจ้งมนุษย์");
  }
}

// ---------- server ----------
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"]; // newest first; an unknown client version gets the first

function rpc(d, msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "invalid request" } };
  // Notifications (no id) and client responses (no method) never get a reply, and a tools/call without id is not run:
  // a write the caller can't see the result of is worse than a dropped message.
  if (typeof msg.method !== "string" || msg.id == null) return null;
  const ok = result => ({ jsonrpc: "2.0", id: msg.id, result }), fail = (code, message) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  switch (msg.method) {
    case "initialize": return ok({ protocolVersion: PROTOCOLS.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : PROTOCOLS[0], capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "newsdesk", version: "1.0.0" },
      instructions: "โต๊ะข่าวไอที/AI ภาษาไทย — เรื่องข่าวเดินตามสถานะ pitched → assigned → drafting → factcheck → editing → ready → published (ยกเลิกด้วย killed). ถ้าเครื่องมือตอบ 'ผิดพลาด' ให้อ่านข้อความ แก้ค่าที่ส่งตามที่บอก แล้วเรียกใหม่ (ยกเว้น 'ระบบขัดข้องภายใน' ให้แจ้งมนุษย์)" });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
    case "tools/call": return ok(callTool(d, msg.params?.name, msg.params?.arguments));
    default: return fail(-32601, "method not found");
  }
}

function serve(d, token, port) {
  const want = Buffer.from(token);
  return http.createServer((req, res) => {
    const send = (code, body, close) => {
      res.writeHead(code, { ...(body && { "content-type": "application/json" }), ...(close && { connection: "close" }) });
      res.end(body ? JSON.stringify(body) : undefined);
    };
    try {
      const url = req.url.split("?")[0];
      if (url === "/health" && req.method === "GET") return send(200, { ok: true });
      if (url !== "/mcp") return send(404);
      const got = Buffer.from(/^bearer\s+(.+)$/i.exec(req.headers.authorization || "")?.[1].trim() ?? ""); // scheme is case-insensitive (RFC 9110)
      if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return send(401, { error: "unauthorized" });
      if (req.method !== "POST") return send(405); // no server-initiated stream: JSON responses only
      if (Number(req.headers["content-length"]) > MAX_BODY) return send(413, { error: "body too large" }, true);
      const chunks = []; let size = 0, over = false;
      req.on("data", c => {
        if (over) return;
        size += c.length;
        if (size > MAX_BODY) { over = true; chunks.length = 0; return send(413, { error: "body too large" }, true); }
        chunks.push(c);
      });
      req.on("end", () => {
        if (over) return;
        try {
          let msg;
          try { msg = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }); }
          // empty batch is itself an invalid request (rpc(null) builds that -32600 error)
          const out = Array.isArray(msg) ? (msg.length ? msg.map(m => rpc(d, m)).filter(Boolean) : rpc(d, null)) : rpc(d, msg);
          return out && (!Array.isArray(out) || out.length) ? send(200, out) : send(202);
        } catch (e) { console.error(e); if (!res.headersSent) send(500, { error: "internal error" }); }
      });
    } catch (e) { console.error(e); if (!res.headersSent) send(500, { error: "internal error" }); }
  }).listen(port, "127.0.0.1");
}

function main() {
  const dir = process.env.NEWS_DIR || "/news";
  const d = openDesk(dir), server = serve(d, loadToken(dir), PORT);
  server.once("listening", () => console.log(`newsdesk on 127.0.0.1:${server.address().port}/mcp (data ${dir})`)); // real port: NEWS_PORT=0 picks one
}

// ---------- selftest ----------
async function selftest() {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "newsdesk-"));
  const dir = tmp(), dirs = [dir];
  let n = 0;
  const T = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `[${name}] ${e.message}`; throw e; } };
  let t = Date.UTC(2026, 9, 4, 5, 0); // 2026-10-04 12:00 Bangkok; the fake clock ticks 1s per call so updatedAt ordering is testable
  const desk = openDesk(dir, () => t);
  const call = (name, a) => { t += 1000; return callTool(desk, name, a); };
  const good = (name, a) => { const r = call(name, a); assert.ok(!r.isError, r.content[0].text); return r.structuredContent.result; };
  const refuse = (name, a, re) => { const r = call(name, a); assert.ok(r.isError, "ควรถูกปฏิเสธ"); assert.match(r.content[0].text, re); };
  const pitch = (o = {}) => good("pitch_story", { by: "ผู้ติดตามข่าว", title: "ข่าวทดสอบ", beat: "gadget", angle: "มุมข่าว", ...o }).id;
  const mv = (id, status, o = {}) => good("update_story", { id, by: "บก.", status, ...o });
  const toFactcheck = id => { mv(id, "assigned", { reporter: "นักข่าวบี" }); mv(id, "drafting"); mv(id, "factcheck", { headline: "พาดหัว", body: "เนื้อหา", sources: ["https://example.com/x"] }); };
  const story = id => good("get_story", { id });
  const READY = { social: "โพสต์ข่าว", image: "ภาพหลัก: ภาพข่าว" }; // ready also needs the social post and the image brief
  const quiet = fn => { const ce = console.error; console.error = () => {}; try { return fn(); } finally { console.error = ce; } }; // expected server-side failures are logged; keep selftest output clean

  // happy path A: pitch -> ... -> publish, then the markdown file
  const srcs2 = [{ url: "https://example.com/gemma-4", title: "ประกาศ Gemma 4 [ทางการ]" }, "https://example.org/a"];
  const A = pitch({ title: "Gemma 4 เปิดตัว", beat: "ai", angle: "โมเดลเปิดรันบนเครื่อง", sources: srcs2, foo: "unknown args are ignored" });
  const B = pitch({ title: "ข่าว B" });
  await T("per-day id sequence", () => { assert.equal(A, "20261004-01"); assert.equal(B, "20261004-02"); });
  mv(A, "assigned", { reporter: "นักข่าวเอ" }); mv(A, "drafting");
  mv(A, "factcheck", { headline: "Gemma 4 รันบนโน้ตบุ๊กได้แล้ว", body: "เนื้อหาข่าวภาษาไทย\n\nย่อหน้าสอง" });
  mv(A, "editing", { factcheck: "ตรวจกับประกาศต้นทางแล้ว ตรง" });
  mv(A, "ready", { social: "Gemma 4 มาแล้ว #AI", image: "ภาพหลัก: โน้ตบุ๊กกำลังรันโมเดล\nalt: โน้ตบุ๊กแสดงหน้าจอ Gemma 4" });
  t = Date.UTC(2026, 9, 4, 18, 30); // 2026-10-05 01:30 Bangkok: the date folder must follow Bangkok, not UTC
  const pub = good("publish_story", { id: A, by: "บ.ก.บริหาร", title: "Gemma 4 รันบนโน้ตบุ๊กได้แล้ว" });
  await T("publish result + story state", () => {
    assert.deepEqual(pub, { id: A, status: "published", publishedFile: "2026-10-05/20261004-01.md" });
    const s = story(A);
    assert.equal(s.status, "published"); assert.equal(s.publishedFile, "2026-10-05/20261004-01.md");
    assert.deepEqual(s.history.map(h => h.to), ["pitched", "assigned", "drafting", "factcheck", "editing", "ready", "published"]);
    assert.equal(s.history[6].by, "บ.ก.บริหาร"); assert.equal(s.history[0].from, null);
  });
  await T("markdown file: Thai intact, sources listed", () => {
    const md = fs.readFileSync(path.join(dir, "2026-10-05", "20261004-01.md"), "utf8");
    assert.equal(md, [
      "# Gemma 4 รันบนโน้ตบุ๊กได้แล้ว", "> สาย: AI-โมเดล · นักข่าว: นักข่าวเอ · เผยแพร่: 2026-10-05 01:30 น.", "",
      "เนื้อหาข่าวภาษาไทย", "", "ย่อหน้าสอง", "", "## ภาพประกอบ (บรีฟ)", "ภาพหลัก: โน้ตบุ๊กกำลังรันโมเดล", "alt: โน้ตบุ๊กแสดงหน้าจอ Gemma 4", "", "## แหล่งอ้างอิง",
      "- [ประกาศ Gemma 4 \\[ทางการ\\]](https://example.com/gemma-4)", "- [https://example.org/a](https://example.org/a)", "",
      "## ข้อความโซเชียล", "Gemma 4 มาแล้ว #AI", "", "## ผลตรวจข้อเท็จจริง", "ตรวจกับประกาศต้นทางแล้ว ตรง", ""].join("\n"));
  });
  const C = pitch({ sources: ["https://e.com/c"] }); // first pitch after the clock crossed Bangkok midnight
  await T("Bangkok date rollover restarts the per-day sequence", () => { assert.equal(C, "20261005-01"); assert.equal(pitch(), "20261005-02"); });
  await T("ready needs social + image: the error names what is missing and who writes it; image section sits between body and sources", () => {
    toFactcheck(C); mv(C, "editing", { factcheck: "ok" });
    refuse("update_story", { id: C, by: "x", status: "ready" }, /ยังขาด: social.*ฝ่ายโซเชียล.*image.*ฝ่ายภาพ/);
    refuse("update_story", { id: C, by: "x", status: "ready", social: "โพสต์" }, /ยังขาด: image.*ฝ่ายภาพ/);
    refuse("update_story", { id: C, by: "x", status: "ready", image: "ภาพ" }, /ยังขาด: social.*ฝ่ายโซเชียล/);
    refuse("update_story", { id: C, by: "x", image: "ก".repeat(2001) }, /image ยาวเกินกำหนด: 2001.*2000/);
    assert.equal(story(C).status, "editing");
    good("update_story", { id: C, by: "ฝ่ายโซเชียล", social: "โพสต์ข่าว" }); // each department fills its own part, then the editor moves it on
    good("update_story", { id: C, by: "ฝ่ายภาพ", image: "ภาพหลัก: ก\nคำบรรยาย: ข" });
    assert.equal(story(C).image, "ภาพหลัก: ก\nคำบรรยาย: ข"); // multi-line kept
    mv(C, "ready");
    good("publish_story", { id: C, by: "x", title: "พาดหัว" });
    const md = fs.readFileSync(path.join(dir, "2026-10-05", C + ".md"), "utf8");
    assert.ok(md.includes("เนื้อหา\n\n## ภาพประกอบ (บรีฟ)\nภาพหลัก: ก\nคำบรรยาย: ข\n\n## แหล่งอ้างอิง\n"));
    const bare = render({ headline: "h", beat: "ai", reporter: "r", body: "b", sources: [], social: "", factcheck: "" }, "w"); // optional sections vanish when empty
    assert.ok(!bare.includes("ภาพประกอบ") && !bare.includes("ข้อความโซเชียล") && !bare.includes("ผลตรวจ") && !bare.includes("undefined"));
  });

  await T("factcheck without source rejected", () => {
    mv(B, "assigned", { reporter: "นักข่าวบี" }); mv(B, "drafting");
    refuse("update_story", { id: B, by: "x", status: "factcheck", headline: "h", body: "b" }, /ยังขาด.*sources/s);
    assert.equal(story(B).status, "drafting");
  });
  await T("factcheck without headline/body lists what is missing", () => refuse("update_story", { id: B, by: "x", status: "factcheck", sources: ["https://e.com"] }, /headline, body/));
  await T("invalid transition lists allowed statuses", () => {
    const P = pitch();
    refuse("update_story", { id: P, by: "x", status: "ready" }, /จาก pitched \(เสนอข่าว\) ไปได้เฉพาะ: assigned \(มอบหมายแล้ว\), killed \(ไม่ใช้\)/);
    refuse("update_story", { id: P, by: "x", status: "bogus" }, /status ไม่ถูกต้อง/);
  });
  await T("ready is content-locked; ready -> editing needs a note and unlocks edits; publish ships the approved text", () => {
    const R = pitch({ sources: ["https://e.com/r"] }); toFactcheck(R); mv(R, "editing", { factcheck: "ok" }); mv(R, "ready", READY);
    assert.deepEqual(story(R).nextStatuses, ["published", "editing", "killed"]);
    for (const f of [{ headline: "x" }, { body: "x" }, { social: "x" }, { image: "x" }, { reporter: "x" }, { factcheck: "x" }, { sources: ["https://e.com/z"] }])
      refuse("update_story", { id: R, by: "x", ...f }, /ready.*แก้เนื้อหาไม่ได้.*status=editing/);
    refuse("update_story", { id: R, by: "x", status: "ready", body: "x" }, /แก้เนื้อหาไม่ได้/);
    refuse("update_story", { id: R, by: "x", status: "editing", body: "x", note: "n" }, /แก้เนื้อหาไม่ได้/);
    refuse("update_story", { id: R, by: "x", status: "editing" }, /ส่งกลับ editing ต้องใส่ note/);
    refuse("update_story", { id: R, by: "x", status: "drafting", note: "n" }, /ไปได้เฉพาะ: published.*editing \(เกลาต้นฉบับ\).*killed/);
    assert.equal(story(R).status, "ready"); assert.equal(story(R).body, "เนื้อหา");
    mv(R, "editing", { note: "พาดหัวยังไม่ตรง" }); assert.equal(story(R).status, "editing");
    mv(R, "ready", { headline: "พาดหัวใหม่" }); // editing may edit again, then ready locks the new text
    const md = fs.readFileSync(path.join(dir, good("publish_story", { id: R, by: "x", title: "พาดหัวใหม่" }).publishedFile), "utf8");
    assert.ok(md.startsWith("# พาดหัวใหม่\n"));
  });
  await T("entering factcheck clears the old note (kept in history); editing needs a fresh one", () => {
    const F = pitch({ sources: ["https://e.com/f"] }); toFactcheck(F);
    mv(F, "editing", { factcheck: "ตรวจรอบแรก ตัวเลขผิด" }); mv(F, "drafting", { note: "แก้ตัวเลข" }); mv(F, "factcheck");
    const s = story(F);
    assert.equal(s.factcheck, ""); assert.match(s.history.at(-1).note, /ล้างผลตรวจเดิม: ตรวจรอบแรก ตัวเลขผิด/);
    refuse("update_story", { id: F, by: "x", status: "editing" }, /ยังขาด: factcheck/);
    good("update_story", { id: F, by: "x", factcheck: "ตรวจรอบสอง ผ่าน" }); mv(F, "editing");
    assert.equal(story(F).factcheck, "ตรวจรอบสอง ผ่าน");
    const G = pitch({ sources: ["https://e.com/g"] }); mv(G, "assigned", { reporter: "r" }); mv(G, "drafting"); // a note sent with the move would be wiped: reject instead
    refuse("update_story", { id: G, by: "x", status: "factcheck", headline: "h", body: "b", factcheck: "รีบใส่" }, /พร้อมย้ายเข้า factcheck/);
  });
  await T("history note records edited fields even when the status changes too", () => {
    const H = pitch({ sources: ["https://e.com/h"] });
    mv(H, "assigned", { reporter: "นักข่าวเอช", note: "รับงาน" }); assert.equal(story(H).history.at(-1).note, "รับงาน | แก้ไข: reporter");
    mv(H, "drafting", { body: "ร่าง" }); assert.equal(story(H).history.at(-1).note, "แก้ไข: body");
    good("update_story", { id: H, by: "x", headline: "h", note: "แก้พาดหัว" }); assert.equal(story(H).history.at(-1).note, "แก้พาดหัว | แก้ไข: headline");
  });
  await T("status accepts Thai labels; errors show labels; get_story lists next statuses", () => {
    const L = pitch();
    mv(L, "มอบหมายแล้ว", { reporter: "นักข่าวแอล" }); assert.equal(story(L).status, "assigned");
    refuse("update_story", { id: L, by: "x", status: "เผยแพร่แล้ว" }, /publish_story/);
    refuse("update_story", { id: L, by: "x", status: "เกลาต้นฉบับ" }, /จาก assigned \(มอบหมายแล้ว\) ไป editing \(เกลาต้นฉบับ\) ไม่ได้.*ไปได้เฉพาะ: drafting \(กำลังเขียน\), killed \(ไม่ใช้\)/);
    refuse("update_story", { id: L, by: "x", status: "bogus" }, /status ไม่ถูกต้อง.*pitched \(เสนอข่าว\).*killed \(ไม่ใช้\)/);
    assert.ok(good("list_stories", { status: "มอบหมายแล้ว" }).stories.some(x => x.id === L));
    const g = call("get_story", { id: L });
    assert.deepEqual(g.structuredContent.result.nextStatuses, ["drafting", "killed"]);
    assert.match(g.content[0].text, /ขั้นถัดไปที่ทำได้: drafting \(กำลังเขียน\), killed \(ไม่ใช้\)/);
  });
  await T("assigned needs reporter; editing needs factcheck", () => {
    const P = pitch(); refuse("update_story", { id: P, by: "x", status: "assigned" }, /reporter/);
    const Q = pitch({ sources: ["https://e.com/q"] }); toFactcheck(Q);
    refuse("update_story", { id: Q, by: "x", status: "editing" }, /ยังขาด: factcheck/);
  });
  await T("factcheck -> drafting and editing -> drafting send-back", () => {
    const Q = pitch({ sources: ["https://e.com/q"] }); toFactcheck(Q);
    mv(Q, "drafting", { note: "ตรวจแล้วตัวเลขผิด แก้ก่อน" }); assert.equal(story(Q).status, "drafting");
    mv(Q, "factcheck"); mv(Q, "editing", { factcheck: "ok" }); mv(Q, "drafting", { note: "สำนวนยังไม่ดี" });
    const s = story(Q); assert.equal(s.status, "drafting"); assert.equal(s.history.at(-1).note, "สำนวนยังไม่ดี");
  });
  await T("publish from non-ready rejected", () => refuse("publish_story", { id: B, by: "x", title: "x" }, /เฉพาะเรื่องสถานะ ready.*drafting/));
  await T("publish twice rejected", () => refuse("publish_story", { id: A, by: "x", title: "x" }, /เผยแพร่ไปแล้ว/));
  await T("publish_story: title must equal the current headline (trim + collapsed spaces)", () => {
    const W = pitch({ sources: ["https://e.com/w"] }); toFactcheck(W); mv(W, "editing", { factcheck: "ok" }); mv(W, "ready", { headline: "ข่าว   สำคัญ  มาก", ...READY });
    refuse("publish_story", { id: W, by: "x" }, /ต้องระบุ title/);
    refuse("publish_story", { id: W, by: "x", title: "   " }, /ต้องระบุ title/);
    refuse("publish_story", { id: W, by: "x", title: "ข่าวอื่น" }, /ไม่ตรงกับพาดหัวปัจจุบัน.*"ข่าว สำคัญ มาก".*title = "ข่าว สำคัญ มาก"/);
    assert.equal(story(W).status, "ready"); assert.equal(story(W).publishedFile, null); // nothing published by the failed attempts
    assert.equal(good("publish_story", { id: W, by: "x", title: "  ข่าว \n สำคัญ   มาก  " }).status, "published"); // extra spaces/newline are normalised
  });
  await T("edits to published rejected", () => {
    refuse("update_story", { id: A, by: "x", headline: "แก้" }, /สถานะสุดท้าย/);
    refuse("update_story", { id: A, by: "x", status: "killed", note: "n" }, /สถานะสุดท้าย/);
  });
  await T("published via update_story rejected, points to publish_story", () => refuse("update_story", { id: B, by: "x", status: "published" }, /publish_story/));
  await T("killed requires note, then is final", () => {
    const K = pitch();
    refuse("update_story", { id: K, by: "x", status: "killed" }, /note/);
    mv(K, "killed", { note: "ซ้ำกับเรื่องอื่น" });
    assert.equal(story(K).status, "killed");
    refuse("update_story", { id: K, by: "x", status: "assigned", reporter: "r" }, /สถานะสุดท้าย/);
    refuse("publish_story", { id: K, by: "x", title: "x" }, /เฉพาะเรื่องสถานะ ready/);
  });
  await T("bad URL / non-http / too many sources rejected", () => {
    refuse("pitch_story", { by: "x", title: "t", beat: "ai", angle: "a", sources: ["not a url"] }, /sources\[0\]\.url ไม่ใช่ URL/);
    refuse("pitch_story", { by: "x", title: "t", beat: "ai", angle: "a", sources: ["ftp://example.com/x"] }, /http:\/\/ หรือ https:\/\//);
    refuse("pitch_story", { by: "x", title: "t", beat: "ai", angle: "a", sources: [{ url: "https://e.com/" + "a".repeat(500) }] }, /500/);
    refuse("pitch_story", { by: "x", title: "t", beat: "ai", angle: "a", sources: Array.from({ length: 11 }, (_, i) => "https://e.com/" + i) }, /สูงสุด 10/);
    refuse("pitch_story", { by: "x", title: "t", beat: "ai", angle: "a", sources: [{ title: "no url" }] }, /sources\[0\]\.url/);
  });
  await T("too-long fields rejected with field name and limit", () => {
    refuse("update_story", { id: B, by: "x", body: "ก".repeat(20001) }, /body ยาวเกินกำหนด: 20001.*20000/);
    refuse("pitch_story", { by: "x", title: "ก".repeat(201), beat: "ai", angle: "a" }, /title.*200/);
    refuse("pitch_story", { by: "ก".repeat(61), title: "t", beat: "ai", angle: "a" }, /by.*60/);
    assert.equal(story(B).body, "");
  });
  await T("unknown beat rejected; missing/non-string required fields rejected", () => {
    refuse("pitch_story", { by: "x", title: "t", beat: "sports", angle: "a" }, /beat ไม่ถูกต้อง.*ai/);
    refuse("pitch_story", { by: "x", title: "t", angle: "a" }, /ต้องระบุ beat/);
    refuse("pitch_story", { by: "  ", title: "t", beat: "ai", angle: "a" }, /ต้องระบุ by/);
    refuse("pitch_story", { by: "x", title: 123, beat: "ai", angle: "a" }, /title ต้องเป็นข้อความ/);
  });
  await T("all 9 beats: key and Thai label both accepted, key stored; old/unknown labels rejected", () => {
    assert.deepEqual(Object.keys(BEATS), ["ai", "gadget", "software", "startup", "security", "gaming", "cloud", "policy", "other"]);
    for (const [k, label] of Object.entries(BEATS)) { assert.equal(story(pitch({ beat: k })).beat, k); assert.equal(story(pitch({ beat: label })).beat, k); }
    refuse("pitch_story", { by: "x", title: "t", beat: "Gadget-ซอฟต์แวร์", angle: "a" }, /beat ไม่ถูกต้อง.*software \(ซอฟต์แวร์-แอป\)/);
    refuse("list_stories", { beat: "เกม" }, /beat ไม่ถูกต้อง/);
    assert.ok(good("list_stories", { beat: "นโยบาย-กฎหมายเทค" }).stories.every(x => x.beat === "policy"));
  });
  await T("gaming label is เกม-สตรีมมิง; the old spelling เกม-สตรีมมิ่ง is still accepted as input", () => {
    assert.equal(BEATS.gaming, "เกม-สตรีมมิง");
    assert.equal(story(pitch({ beat: "เกม-สตรีมมิ่ง" })).beat, "gaming");
    assert.equal(story(pitch({ beat: "เกม-สตรีมมิง" })).beat, "gaming");
    const l = good("list_stories", { beat: "เกม-สตรีมมิ่ง" }); assert.ok(l.stories.length >= 2 && l.stories.every(x => x.beat === "gaming"));
    refuse("pitch_story", { by: "x", title: "t", beat: "sports", angle: "a" }, /gaming \(เกม-สตรีมมิง\)/); // the hint lists only the canonical label
  });
  await T("STATUS export: Thai labels, same keys as the state machine", () => {
    assert.deepEqual(STATUS, { pitched: "เสนอข่าว", assigned: "มอบหมายแล้ว", drafting: "กำลังเขียน", factcheck: "ตรวจข้อเท็จจริง", editing: "เกลาต้นฉบับ", ready: "รอ บก.บห.", published: "เผยแพร่แล้ว", killed: "ไม่ใช้" });
    assert.deepEqual(Object.keys(STATUS), Object.keys(NEXT));
    assert.ok(Object.values(NEXT).flat().every(x => x in STATUS));
  });
  await T("importing the module exposes BEATS/STATUS and does not start the server", async () => {
    const { execFileSync } = await import("node:child_process"), id = tmp(); dirs.push(id);
    const code = `import { BEATS, STATUS } from ${JSON.stringify(import.meta.url)}; console.log(Object.keys(BEATS).length, Object.keys(STATUS).length, BEATS.gaming)`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, NEWS_DIR: id }, timeout: 15000, encoding: "utf8" });
    assert.equal(out.trim(), "9 8 เกม-สตรีมมิง"); // a started server would keep the child alive until the timeout kills it
  });
  await T("Thai beat label accepted, key stored", () => {
    assert.equal(story(pitch({ beat: "ความปลอดภัยไซเบอร์" })).beat, "security");
    assert.equal(story(pitch({ beat: " AI-โมเดล " })).beat, "ai");
    assert.equal(story(pitch({ beat: "AI" })).beat, "ai");
  });
  await T("field edit without status change appends history with to=from; no-op rejected; same status = edit", () => {
    good("update_story", { id: B, by: "นักข่าวบี", body: "ร่างแรก", status: "drafting" });
    const h = story(B).history.at(-1);
    assert.equal(h.from, "drafting"); assert.equal(h.to, "drafting"); assert.equal(h.by, "นักข่าวบี"); assert.match(h.note, /body/);
    refuse("update_story", { id: B, by: "x", note: "แค่หมายเหตุ" }, /ไม่ได้ระบุสิ่งที่จะแก้/);
    refuse("update_story", { id: "99999999-99", by: "x", body: "b" }, /ไม่พบเรื่อง/);
  });
  await T("single-line fields collapse newlines (no markdown injection)", () => {
    good("update_story", { id: B, by: "x", headline: "บรรทัดหนึ่ง\n## แทรก\r\nบรรทัดสาม" });
    assert.equal(story(B).headline, "บรรทัดหนึ่ง ## แทรก บรรทัดสาม");
  });
  await T("sources replace the old list; empty list means no change", () => {
    good("update_story", { id: B, by: "x", sources: ["https://e.com/1", { url: "https://e.com/2", title: "สอง" }] });
    assert.deepEqual(story(B).sources, [{ url: "https://e.com/1", title: "" }, { url: "https://e.com/2", title: "สอง" }]);
    refuse("update_story", { id: B, by: "x", sources: [] }, /ไม่ได้ระบุสิ่งที่จะแก้/);
  });
  await T("list_stories: newest first, no body, filters, limit", () => {
    good("update_story", { id: B, by: "x", social: "ล่าสุด" }); // B is now the most recently touched
    const r = good("list_stories", {});
    assert.equal(r.stories[0].id, B); assert.ok(r.total >= 8);
    assert.ok(r.stories.every(s => !("body" in s) && typeof s.sources === "number"));
    assert.equal(r.stories.find(s => s.id === B).title, "บรรทัดหนึ่ง ## แทรก บรรทัดสาม"); // headline wins over title
    assert.ok(good("list_stories", { status: "published" }).stories.every(s => s.status === "published"));
    assert.ok(good("list_stories", { beat: "ความปลอดภัยไซเบอร์" }).stories.every(s => s.beat === "security"));
    assert.equal(good("list_stories", { limit: 2 }).stories.length, 2);
    assert.equal(good("list_stories", { limit: "2" }).stories.length, 2);
    refuse("list_stories", { limit: 0 }, /limit/); refuse("list_stories", { limit: 101 }, /limit/); refuse("list_stories", { status: "x" }, /status ไม่ถูกต้อง/);
    assert.match(call("list_stories", { status: "killed", beat: "startup" }).content[0].text, /ไม่พบเรื่อง/);
  });
  await T("list_stories: default = open stories only; status shows published/killed; all=true shows everything", () => {
    const open = good("list_stories", { limit: 100 });
    assert.ok(open.total > 0 && open.stories.every(s => s.status !== "published" && s.status !== "killed"));
    assert.ok(!open.stories.some(s => s.id === A)); // A is published
    const pubs = good("list_stories", { status: "published", limit: 100 }), dead = good("list_stories", { status: "killed", limit: 100 });
    assert.ok(pubs.stories.some(s => s.id === A) && dead.total >= 1);
    const everything = good("list_stories", { all: true, limit: 100 });
    assert.equal(everything.total, desk.db.stories.length); assert.equal(everything.total, open.total + pubs.total + dead.total);
    assert.equal(good("list_stories", { all: "true" }).total, everything.total);
    assert.equal(good("list_stories", { status: "killed", all: true, limit: 100 }).total, dead.total); // status wins over all
    assert.match(call("list_stories", {}).content[0].text, /\[ยังไม่จบ\]/);
    assert.match(TOOLS.list_stories.description, /ยังไม่จบ/);
  });
  await T("list_stories rows carry hasSocial/hasImage and the text line shows them", () => {
    const Z = pitch(); good("update_story", { id: Z, by: "ฝ่ายโซเชียล", social: "โพสต์" });
    const row = good("list_stories", {}).stories.find(s => s.id === Z);
    assert.equal(row.hasSocial, true); assert.equal(row.hasImage, false);
    assert.match(call("list_stories", {}).content[0].text.split("\n").find(l => l.startsWith(Z)), /โซเชียล มี \| ภาพ ไม่มี/);
    good("update_story", { id: Z, by: "ฝ่ายภาพ", image: "ภาพ" }); assert.equal(good("list_stories", {}).stories.find(s => s.id === Z).hasImage, true);
  });
  await T("get_story returns full story; unknown tool is a readable error; string arguments parsed", () => {
    const s = story(A); assert.equal(s.body, "เนื้อหาข่าวภาษาไทย\n\nย่อหน้าสอง"); assert.equal(s.sources.length, 2);
    refuse("get_story", {}, /ต้องระบุ id/);
    const r = callTool(desk, "drop_database", {}); assert.ok(r.isError); assert.match(r.content[0].text, /pitch_story, list_stories/);
    assert.ok(callTool(desk, "toString", {}).isError);
    assert.equal(callTool(desk, "get_story", JSON.stringify({ id: A })).isError, undefined);
    assert.ok(callTool(desk, "get_story", null).isError);
  });
  await T("persistence: reload from disk gives same stories, sequence continues, no .tmp left", () => {
    const again = openDesk(dir, () => t);
    assert.equal(JSON.stringify(again.db), JSON.stringify(desk.db));
    assert.ok(!fs.existsSync(path.join(dir, "stories.json.tmp")));
    const r = callTool(again, "pitch_story", { by: "x", title: "t", beat: "ai", angle: "a" }).structuredContent.result.id;
    assert.equal(r, `20261005-${String(desk.db.seq["20261005"] + 1).padStart(2, "0")}`);
  });
  await T("commit rolls memory back when the disk write fails; internal errors say report to a human, don't retry", () => {
    const d2 = openDesk(tmp(), () => t); dirs.push(d2.dir);
    callTool(d2, "pitch_story", { by: "x", title: "t", beat: "ai", angle: "a" });
    fs.rmSync(d2.dir, { recursive: true, force: true }); // next write fails: directory is gone
    const r = quiet(() => callTool(d2, "pitch_story", { by: "x", title: "t2", beat: "ai", angle: "a" }));
    assert.ok(r.isError); assert.doesNotMatch(r.content[0].text, /ENOENT|newsdesk-/);
    assert.match(r.content[0].text, /ระบบขัดข้องภายใน ห้ามเรียกซ้ำ ให้แจ้งมนุษย์/); assert.doesNotMatch(r.content[0].text, /ลองใหม่/);
    assert.equal(d2.db.stories.length, 1); assert.deepEqual(Object.values(d2.db.seq), [1]);
  });
  await T("publish refuses an existing target file; removes the .md again when saving state fails", () => {
    const P = pitch({ sources: ["https://e.com/p"] }); toFactcheck(P); mv(P, "editing", { factcheck: "ok" }); mv(P, "ready", READY);
    const file = path.join(dir, today(t + 1000), P + ".md"); // the fake clock ticks once more inside the next call
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "มีอยู่แล้ว");
    refuse("publish_story", { id: P, by: "x", title: "พาดหัว" }, /มีอยู่แล้ว.*แจ้งมนุษย์/);
    assert.equal(story(P).status, "ready"); assert.equal(fs.readFileSync(file, "utf8"), "มีอยู่แล้ว"); // existing file untouched
    fs.rmSync(file);
    fs.mkdirSync(path.join(dir, "stories.json.tmp")); // makes the state write fail after the .md was written
    quiet(() => refuse("publish_story", { id: P, by: "x", title: "พาดหัว" }, /ระบบขัดข้องภายใน/));
    assert.ok(!fs.existsSync(file), "orphan .md must be removed");
    assert.equal(story(P).status, "ready"); assert.equal(story(P).publishedFile, null); // memory rolled back too
    fs.rmdirSync(path.join(dir, "stories.json.tmp"));
    good("publish_story", { id: P, by: "x", title: "พาดหัว" }); assert.ok(fs.existsSync(file)); // and it works once the disk is healthy
  });
  await T("writeAtomic fsyncs before the rename", () => {
    const orig = fs.fsyncSync; let calls = 0; fs.fsyncSync = fd => { calls++; return orig(fd); };
    try { pitch(); } finally { fs.fsyncSync = orig; }
    assert.equal(calls, 1);
  });
  await T("corrupt stories.json: refuse to start, file untouched", () => {
    const bd = tmp(); dirs.push(bd); fs.writeFileSync(path.join(bd, "stories.json"), "{ nope");
    assert.throws(() => openDesk(bd));
    assert.equal(fs.readFileSync(path.join(bd, "stories.json"), "utf8"), "{ nope");
    const sd = tmp(); dirs.push(sd); fs.writeFileSync(path.join(sd, "stories.json"), '{"seq":{}}');
    assert.throws(() => openDesk(sd), /รูปแบบไม่ถูกต้อง/);
  });
  await T("token: generated 64 hex, stable across loads", () => {
    const td = tmp(); dirs.push(td);
    const a = loadToken(td); assert.match(a, /^[0-9a-f]{64}$/); assert.equal(loadToken(td), a);
    assert.equal(fs.readFileSync(path.join(td, ".token"), "utf8").trim(), a);
  });

  // ---- HTTP ----
  const hdir = tmp(); dirs.push(hdir);
  const hdesk = openDesk(hdir), token = loadToken(hdir), server = serve(hdesk, token, 0);
  await new Promise(r => server.once("listening", r));
  const port = server.address().port;
  const req = (method, p, obj, tok, scheme = "Bearer") => new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method, path: p, agent: false, headers: { "content-type": "application/json", ...(tok && { authorization: scheme + " " + tok }) } }, res => {
      let b = ""; res.setEncoding("utf8"); res.on("data", c => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    r.on("error", reject); r.end(obj === undefined ? undefined : typeof obj === "string" ? obj : JSON.stringify(obj));
  });
  const rpcCall = async (method, params, id = 1) => { const r = await req("POST", "/mcp", { jsonrpc: "2.0", id, method, params }, token); assert.equal(r.status, 200); return JSON.parse(r.body); };
  // Send a declared/streamed oversize body and read only the status: the server must answer 413 before reading it all.
  const oversize = (headers, firstChunk) => new Promise((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port, method: "POST", path: "/mcp", agent: false, headers: { authorization: "Bearer " + token, ...headers } }, res => { res.resume(); resolve(res.statusCode); r.destroy(); });
    r.on("error", reject); r.write(firstChunk);
  });
  try {
    await T("http: /health 200 without auth", async () => { const r = await req("GET", "/health"); assert.equal(r.status, 200); assert.deepEqual(JSON.parse(r.body), { ok: true }); });
    await T("http: /mcp without or with wrong token -> 401", async () => {
      assert.equal((await req("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "ping" })).status, 401);
      assert.equal((await req("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, "0".repeat(64))).status, 401);
      assert.equal((await req("POST", "/mcp", { jsonrpc: "2.0", id: 1, method: "ping" }, "short")).status, 401);
    });
    await T("http: unknown path 404, GET /mcp 405", async () => { assert.equal((await req("GET", "/nope")).status, 404); assert.equal((await req("GET", "/mcp", undefined, token)).status, 405); });
    await T("http: Authorization scheme is case-insensitive, the token itself is exact", async () => {
      const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
      for (const scheme of ["bearer", "BEARER", "BeArEr"]) assert.equal((await req("POST", "/mcp", ping, token, scheme)).status, 200);
      assert.equal((await req("POST", "/mcp", ping, " " + token, "Bearer")).status, 200); // extra whitespace after the scheme
      assert.equal((await req("POST", "/mcp", ping, token, "Basic")).status, 401);
      assert.equal((await req("POST", "/mcp", ping, token.toUpperCase(), "bearer")).status, 401);
      assert.equal((await req("POST", "/mcp", ping, token + "0", "bearer")).status, 401);
    });
    await T("http: initialize negotiates protocolVersion", async () => {
      assert.equal((await rpcCall("initialize", { protocolVersion: "2025-06-18" })).result.serverInfo.name, "newsdesk");
      for (const v of ["2025-06-18", "2025-03-26", "2024-11-05"]) assert.equal((await rpcCall("initialize", { protocolVersion: v })).result.protocolVersion, v);
      assert.equal((await rpcCall("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion, "2025-06-18");
      assert.equal((await rpcCall("initialize", {})).result.protocolVersion, "2025-06-18");
    });
    await T("http: tools/list returns exactly 5 tools", async () => {
      const tools = (await rpcCall("tools/list")).result.tools;
      assert.deepEqual(tools.map(x => x.name).sort(), ["get_story", "list_stories", "pitch_story", "publish_story", "update_story"]);
      assert.ok(tools.every(x => x.description && x.inputSchema.type === "object"));
    });
    await T("http: tools/call pitch_story works, errors come back as isError text", async () => {
      const ok = (await rpcCall("tools/call", { name: "pitch_story", arguments: { by: "บอท", title: "ทดสอบผ่าน HTTP", beat: "startup", angle: "มุม" } })).result;
      assert.match(ok.structuredContent.result.id, /^\d{8}-01$/); assert.ok(!ok.isError);
      const bad = (await rpcCall("tools/call", { name: "update_story", arguments: { id: "nope", by: "x", body: "b" } })).result;
      assert.equal(bad.isError, true); assert.match(bad.content[0].text, /^ผิดพลาด: ไม่พบเรื่อง/);
      const saved = JSON.parse(fs.readFileSync(path.join(hdir, "stories.json"), "utf8")).stories;
      assert.equal(saved.length, 1); assert.equal(saved[0].title, "ทดสอบผ่าน HTTP"); assert.equal(saved[0].beat, "startup"); // Thai survives the HTTP body decode
    });
    await T("http: notification 202, bad JSON 400, non-object JSON survives", async () => {
      assert.equal((await req("POST", "/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, token)).status, 202);
      assert.equal((await req("POST", "/mcp", "{oops", token)).status, 400);
      assert.equal((await req("POST", "/mcp", "null", token)).status, 200);
      assert.equal((await req("POST", "/mcp", "[1,null]", token)).status, 200);
      assert.deepEqual((await rpcCall("ping")).result, {}); // still alive
    });
    await T("http: notifications and responses get no reply, empty batch is -32600, id-less tools/call is not run", async () => {
      const post = obj => req("POST", "/mcp", obj, token), before = hdesk.db.stories.length;
      assert.equal((await post({ jsonrpc: "2.0", method: "tools/call", params: { name: "pitch_story", arguments: { by: "x", title: "t", beat: "ai", angle: "a" } } })).status, 202);
      assert.equal(hdesk.db.stories.length, before);
      assert.equal((await post({ jsonrpc: "2.0", id: 7, result: {} })).status, 202); // a client response: no method
      assert.equal((await post([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 8, result: {} }])).status, 202);
      const mixed = await post([{ jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 9, method: "ping" }]);
      assert.equal(mixed.status, 200); assert.deepEqual(JSON.parse(mixed.body), [{ jsonrpc: "2.0", id: 9, result: {} }]);
      const empty = await post([]); assert.equal(empty.status, 200); assert.equal(JSON.parse(empty.body).error.code, -32600);
      assert.equal((await rpcCall("nope/method")).error.code, -32601);
    });
    await T("NEWS_PORT=0 means a random port and the startup log shows the real one", async () => {
      const { spawn } = await import("node:child_process"), nd = tmp(); dirs.push(nd);
      const child = spawn(process.execPath, [process.argv[1]], { env: { ...process.env, NEWS_DIR: nd, NEWS_PORT: "0" }, stdio: ["ignore", "pipe", "inherit"] });
      try {
        const p = await new Promise((resolve, reject) => {
          let buf = ""; const timer = setTimeout(() => reject(new Error("no startup line, got: " + buf)), 10000);
          child.stdout.on("data", c => { buf += c; const m = /127\.0\.0\.1:(\d+)\/mcp/.exec(buf); if (m) { clearTimeout(timer); resolve(Number(m[1])); } });
          child.once("exit", code => reject(new Error("child exited " + code)));
        });
        assert.ok(p > 0 && p !== 7790, "port " + p);
        const status = await new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port: p, path: "/health", agent: false }, r => { r.resume(); resolve(r.statusCode); }).on("error", reject));
        assert.equal(status, 200);
      } finally { child.kill(); }
    });
    await T("http: body over 1 MB -> 413 (declared and streamed)", async () => {
      assert.equal(await oversize({ "content-length": 2e6 }, "{}"), 413);
      assert.equal(await oversize({}, Buffer.alloc(1e6 + 1, 97)), 413);
      assert.deepEqual((await rpcCall("ping")).result, {});
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
    for (const x of dirs) fs.rmSync(x, { recursive: true, force: true });
  }
  console.log(`selftest OK (${n} checks)`);
}

// Run only when executed directly (node server.mjs), not when another module imports BEATS/STATUS.
const isMain = process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
if (!isMain) { /* imported as a library */ }
else if (process.argv.includes("--selftest")) selftest().catch(e => { console.error("selftest FAIL:", e.stack || e); process.exitCode = 1; });
else main();
