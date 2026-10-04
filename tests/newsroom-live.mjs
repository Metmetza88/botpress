// Live newsroom run on the real LLM: one AI story from pitch to published, through the 15 seeded bots.
// Kicks the stage owners the way the daily routines would (routines/testRun = same prompt, fresh chain) when a stage stalls,
// approves ONLY the publish_story ask whose title is this story's headline (as the owner would), and stops on any other ask.
// usage: BotPress.exe --devtools-port 9224 running + seeded; node tests/newsroom-live.mjs [maxMinutes=90]
import fs from "node:fs";
import { connect } from "./cdp.mjs";

const MAX_MIN = +(process.argv[2] || 90), STALL_MIN = 12, DATA = "D:/botpress/news/stories.json";
const t0 = Date.now(), min = () => ((Date.now() - t0) / 60000).toFixed(1);
const log = (...a) => console.log(`[${min()}m]`, ...a);
const c = await connect(9224);
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${JSON.stringify({ path, input })})`);
const stories = () => { try { return JSON.parse(fs.readFileSync(DATA, "utf8")).stories; } catch { return []; } };
const boot = await rk("bootstrap"), bot = n => boot.bots.find(b => b.name === n);
const routine = async (botName, name) => (await rk("routines/list", { botId: bot(botName).id })).find(r => r.name === name);
const kick = async (botName, name) => {
  const r = await routine(botName, name);
  await rk("routines/testRun", { routineId: r.id, clientNonce: "live-" + Date.now() });
  log(`kick routine ${botName} / ${name}`);
};
const tell = async (botName, text) => { await rk("threads/send", { botId: bot(botName).id, text, clientNonce: "live-" + Date.now() }); log(`message -> ${botName}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const before = new Set(stories().map(s => s.id));
let story = null, lastStatus = "", lastChange = Date.now(), kicks = 0, answered = new Set(), result = "timeout";
await tell("นักข่าว AI", "งานทดสอบระบบจากลุงจืด: หาข่าว AI ใหม่ 1 เรื่องตามขั้นตอนของคุณ แล้ว pitch_story เสนอแค่ 1 เรื่อง");
try {
  while ((Date.now() - t0) / 60000 < MAX_MIN) {
    await sleep(20000);
    story = story ? stories().find(s => s.id === story.id) : stories().find(s => !before.has(s.id));
    if (!story) { if (Date.now() - lastChange > STALL_MIN * 60000) { log("no pitch yet"); lastChange = Date.now(); } continue; }
    if (story.status !== lastStatus) {
      const h = story.history.at(-1);
      log(`${story.id} ${lastStatus || "-"} -> ${story.status} by ${h?.by || "?"}${h?.note ? " · " + h.note.slice(0, 120) : ""}`);
      lastStatus = story.status; lastChange = Date.now();
      if (story.status === "pitched") await kick("หัวหน้าข่าว", "รวบรวมข่าวเช้า");
    }
    if (story.status === "published") { result = "published"; break; }
    if (story.status === "killed") { result = "killed"; break; }

    // the owner's inbox: approve only this story's publish ask; anything else stops the run for a human to look at
    const waiting = (await rk("runs/list", { filter: "active" })).runs.filter(r => /^waiting_(input|takeover)$/.test(r.status));
    for (const r of waiting) {
      const th = await rk("threads/get", r.groupId ? { groupId: r.groupId } : { botId: r.botId });
      for (const m of th.messages || []) for (const b of m.blocks || []) {
        if (b.kind !== "ask" || b.status === "answered" || answered.has(m.id)) continue;
        const text = `${b.text || ""} ${b.detail || ""}`;
        if (/publish_story/.test(text) && story.headline && text.includes(story.headline.slice(0, 20))) {
          await rk("threads/answer", { ...(r.groupId ? { groupId: r.groupId } : { botId: r.botId }), runId: r.runId, messageId: m.id, answer: "allow" });
          answered.add(m.id); log(`approved publish_story for ${story.id}`);
        } else if (!answered.has(m.id)) { answered.add(m.id); log(`OTHER ASK (left for a human): ${text.slice(0, 200)}`); }
      }
    }

    if (Date.now() - lastChange > STALL_MIN * 60000) { // what the daily sweep for this stage would do
      lastChange = Date.now(); kicks++;
      const s = story.status;
      if (s === "pitched") await kick("หัวหน้าข่าว", "รวบรวมข่าวเช้า");
      else if (s === "assigned" || s === "drafting") await tell(story.reporter || "นักข่าว AI", `เรื่อง ${story.id} ที่ได้รับมอบหมาย สถานะ ${s} ทำต่อตามขั้นตอนของคุณจนส่งตรวจ`);
      else if (s === "factcheck") await kick(["security", "gaming", "cloud", "policy"].includes(story.beat) ? "ผู้ตรวจข่าว 2" : "ผู้ตรวจข่าว 1",
        `กวาดงานตรวจ (${["security", "gaming", "cloud", "policy"].includes(story.beat) ? "ผู้ตรวจข่าว 2" : "ผู้ตรวจข่าว 1"})`);
      else if (s === "editing") await kick("บก.ต้นฉบับ", "กวาดงานเกลา");
      else if (s === "ready") await kick("บก.บห.", "ตรวจข่าวรอเผยแพร่");
    }
  }
} finally {
  const s = story && stories().find(x => x.id === story.id);
  const file = s?.publishedFile && `D:/botpress/news/${s.publishedFile}`;
  console.log(JSON.stringify({ result, minutes: +min(), kicks, id: s?.id, status: s?.status, headline: s?.headline, beat: s?.beat,
    sources: s?.sources?.length, hasImage: !!s?.image, hasSocial: !!s?.social, steps: s?.history?.map(h => `${h.to}:${h.by}`),
    file, fileExists: !!file && fs.existsSync(file) }, null, 1));
  c.close();
}
