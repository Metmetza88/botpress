// Pause / resume BotTeam (ลุงจืด 2026-10-04: "พัก botteam ก่อน เอาตัวนี้แทน") so BotPress gets both llama-server slots and the RAM.
// Rakazo runs routines server-side even with BotAdmin closed, so closing the app is not enough: switch its active routines off
// and suspend its running bot computers through BotTeam's own session (the app must be running with --devtools-port 9223).
// Nothing is deleted. The ids go to botteam-paused.json so "resume" turns exactly those routines back on.
// usage: node tools/botteam-pause.mjs pause | resume
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { connect } from "file:///D:/localai/botadmin/tests/cdp.mjs";

const STATE = new URL("../botteam-paused.json", import.meta.url);
const cmd = process.argv[2];
const OWNER = `(select id from "user" where email = 'owner@botteam.local')`;
const sql = query => { // read-only lookups straight from Rakazo's postgres (the API has no "list running computers")
  const q = spawnSync("wsl", ["-d", "Ubuntu-24.04", "-u", "rakazo", "--", "docker", "exec", "rakazo-postgres-1", "psql", "-U", "rakazo", "-d", "rakazo", "-Atc", query], { encoding: "utf8" });
  if (q.status !== 0) throw new Error("psql: " + q.stderr);
  return q.stdout.split("\n").map(x => x.trim()).filter(Boolean);
};
if (!["pause", "resume"].includes(cmd)) { console.log("usage: node tools/botteam-pause.mjs pause|resume"); process.exit(2); }

const c = await connect(9223);
const rk = (path, input = {}) => c.evaluate(`App.call("rk", ${JSON.stringify({ path, input })})`);
try {
  if (cmd === "pause") {
    const boot = await rk("bootstrap");
    const routines = (await Promise.all(boot.bots.map(b => rk("routines/list", { botId: b.id }).catch(() => [])))).flat();
    const active = routines.filter(r => r.active);
    for (const r of active) await rk("routines/update", { routineId: r.id, active: false });
    // computers that read "running" (archived test bots included); rakazo.sh revive restarts exactly these, so suspend via the API
    const botIds = sql(`select b.id from bots b join computers c on c.id = b."computerId" where b."userId" = ${OWNER} and c.state = 'running'`), stopped = [];
    for (const botId of botIds) {
      try { await rk("computer/stop", { botId }); stopped.push(botId); }
      catch (e) { console.log("skip computer", botId, e.message); } // busy (a run holds the lease) -> it suspends by itself when idle
    }
    const prev = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { routines: [] };
    const ids = [...new Set([...prev.routines, ...active.map(r => r.id)])]; // pausing twice must not forget the first batch
    fs.writeFileSync(STATE, JSON.stringify({ at: new Date().toISOString(), routines: ids, computers: stopped }, null, 1));
    const left = sql(`select count(*) from routines where "userId" = ${OWNER} and active`)[0]; // routines of archived bots are not in bootstrap
    console.log(`paused: ${active.length} routines off, ${stopped.length}/${botIds.length} computers suspended, still active in DB: ${left} -> ${STATE.pathname}`);
  } else {
    const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
    let on = 0;
    for (const id of st.routines) {
      try { await rk("routines/update", { routineId: id, active: true }); on++; } catch (e) { console.log("skip routine", id, e.message); }
    }
    fs.renameSync(STATE, new URL(`../botteam-paused.${Date.now()}.done.json`, import.meta.url));
    console.log(`resumed: ${on}/${st.routines.length} routines on (computers boot by themselves on the next run)`);
  }
} finally { c.close(); }
