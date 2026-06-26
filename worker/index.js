// ============================================================
// worker/index.js — Cloudflare Worker
// ============================================================
// 收集「真人打赢 AI」的对局训练样本，并提供一次性取回接口；其余路径回退到静态资源。
//
// 路由：
//   POST /collect    接收一局训练样本 {ver,ts,n,humanSeat,turns,valueMode,scores,lines[]} → 存入 KV
//   GET  /dump       取回聚合的训练 JSONL（需 ?token=；分页 ?cursor=&limit=；可 ?since=&download=1）
//   GET  /stats      汇总统计（局数 / 样本数 / 按人数）
//   POST /game-save  跨设备存档：{id,ts,snap} 写入 save:<id>（snap="" 则删除）；30 天过期
//   GET  /game-load  取回某设备的存档：?id=<deviceId> → {ok,snap|null}
//   其它             交给静态资源（env.ASSETS），站点照常工作
//
// 绑定（见 wrangler.toml）：
//   KV     PR_TRACES   存储每局样本（未配置时 /collect、/dump、/stats 返回 503，站点不受影响）
//   Secret DUMP_TOKEN  保护 /dump、/stats（未设置则不保护，强烈建议设置）
//
// 输出的每一行都是 {f,a,v,vv,n}，与 tools/selfplay_dump.js 同构，可直接喂 train/load_data.py。

const FEATURE_DIM = 446;   // 对齐 sim_features.js FEATURE_DIM_RICH
const N_ROLES = 7;         // 对齐 ROLE_LIST
const MAX_LINES = 400;     // 单局样本上限（一局真人决策点远少于此）
const MAX_BODY = 1_000_000; // 1MB 请求体上限

function cors(resp) {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return resp;
}
function json(obj, status = 200) {
  return cors(new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    try {
      if (p === "/collect" && request.method === "POST") return await handleCollect(request, env);
      if (p === "/dump" && request.method === "GET") return await handleDump(url, env);
      if (p === "/stats" && request.method === "GET") return await handleStats(url, env);
      if (p === "/game-save" && request.method === "POST") return await handleGameSave(request, env);
      if (p === "/game-load" && request.method === "GET") return await handleGameLoad(url, env);
    } catch (e) {
      return json({ ok: false, error: String((e && e.message) || e) }, 500);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request); // 静态资源回退（index.html / game.js / ...）
    return new Response("Not found", { status: 404 });
  },
};

// 解析并规范化为干净的 {f,a,v,vv,n}，杜绝脏数据 / 换行注入。无效返回 null。
function sanitizeLine(line) {
  let d;
  try { d = typeof line === "string" ? JSON.parse(line) : line; } catch (e) { return null; }
  if (!d || !Array.isArray(d.f) || d.f.length !== FEATURE_DIM) return null;
  const a = d.a | 0;
  if (!(a >= 0 && a < N_ROLES)) return null;
  const f = new Array(FEATURE_DIM);
  for (let i = 0; i < FEATURE_DIM; i++) {
    const x = +d.f[i];
    if (!isFinite(x)) return null;
    f[i] = Math.round(x * 10000) / 10000;
  }
  let vv = Array.isArray(d.vv) ? d.vv.slice(0, 4).map((x) => { const y = +x; return isFinite(y) ? Math.round(y * 10000) / 10000 : 0; }) : [];
  while (vv.length < 4) vv.push(0);
  const v = isFinite(+d.v) ? Math.round(+d.v * 10000) / 10000 : vv[0];
  const n = (d.n | 0) || 0;
  return JSON.stringify({ f, a, v, vv, n });
}

async function handleCollect(request, env) {
  if (!env.PR_TRACES) return json({ ok: false, error: "collection disabled (KV not configured)" }, 503);
  if (+(request.headers.get("content-length") || 0) > MAX_BODY) return json({ ok: false, error: "payload too large" }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ ok: false, error: "payload too large" }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }
  if (!body || !Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > MAX_LINES)
    return json({ ok: false, error: "bad lines" }, 400);
  const clean = [];
  for (const ln of body.lines) { const s = sanitizeLine(ln); if (s) clean.push(s); }
  if (!clean.length) return json({ ok: false, error: "no valid samples" }, 400);

  // 毫秒时间戳不能用 `| 0`（会被截成 32 位整数 → 负数/乱码，破坏 /stats 与 /dump?since=）
  const ts = Number.isFinite(+body.ts) && +body.ts > 0 ? Math.floor(+body.ts) : Date.now();
  const key = `g:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const scores = Array.isArray(body.scores) ? body.scores.map((s) => ({ seat: s.seat | 0, total: s.total | 0 })) : [];
  // KV metadata ≤ 1024 字节：仅放轻量汇总，供 /stats、/dump?since 用，无需读取大 value。
  const metadata = {
    ts, n: (body.n | 0) || 0, hs: body.humanSeat | 0,
    t: (body.turns | 0) || 0, s: clean.length, vm: String(body.valueMode || ""), sc: scores,
  };
  await env.PR_TRACES.put(key, clean.join("\n"), { metadata });
  return json({ ok: true, key, samples: clean.length });
}

function checkToken(url, env) {
  if (!env.DUMP_TOKEN) return true;  // 未设 token → 不保护（建议 wrangler secret put DUMP_TOKEN）
  return url.searchParams.get("token") === env.DUMP_TOKEN;
}

async function handleDump(url, env) {
  if (!env.PR_TRACES) return json({ ok: false, error: "collection disabled (KV not configured)" }, 503);
  if (!checkToken(url, env)) return json({ ok: false, error: "unauthorized" }, 401);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "40")));
  const since = parseInt(url.searchParams.get("since") || "0") || 0;
  const cursor = url.searchParams.get("cursor") || undefined;
  const list = await env.PR_TRACES.list({ prefix: "g:", limit, cursor });
  const parts = [];
  for (const k of list.keys) {
    if (since && k.metadata && k.metadata.ts && k.metadata.ts < since) continue;
    const val = await env.PR_TRACES.get(k.name, "text");
    if (val) parts.push(val);
  }
  const out = parts.length ? parts.join("\n") + "\n" : "";
  const headers = { "Content-Type": "text/plain; charset=utf-8" };
  if (!list.list_complete && list.cursor) headers["X-Next-Cursor"] = list.cursor; // 分页游标
  if (url.searchParams.get("download") === "1") headers["Content-Disposition"] = 'attachment; filename="pr-human-wins.jsonl"';
  return cors(new Response(out, { status: 200, headers }));
}

async function handleStats(url, env) {
  if (!env.PR_TRACES) return json({ ok: false, error: "collection disabled (KV not configured)" }, 503);
  if (!checkToken(url, env)) return json({ ok: false, error: "unauthorized" }, 401);
  let games = 0, samples = 0, minTs = Infinity, maxTs = 0;
  const byN = {};
  let cursor;
  do {
    const list = await env.PR_TRACES.list({ prefix: "g:", limit: 1000, cursor });
    for (const k of list.keys) {
      games++;
      const m = k.metadata || {};
      samples += m.s | 0;
      if (m.ts) { if (m.ts < minTs) minTs = m.ts; if (m.ts > maxTs) maxTs = m.ts; }
      byN[(m.n | 0) + "p"] = (byN[(m.n | 0) + "p"] || 0) + 1;
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);
  return json({ ok: true, games, samples, byPlayerCount: byN, firstTs: isFinite(minTs) ? minTs : null, lastTs: maxTs || null });
}

// ── 跨设备存档：每个 deviceId 一个槽（save:<id>），最后写入为准，30 天过期 ──────────────
const MAX_SAVE = 600_000; // 单份存档上限 ~600KB
function validDeviceId(id) { return typeof id === "string" && /^[a-z0-9]{8,40}$/.test(id); }

// POST /game-save  body {id, ts, snap}  —— snap 为空串则删除该槽（开新局/游戏结束时）
async function handleGameSave(request, env) {
  if (!env.PR_TRACES) return json({ ok: false, error: "kv disabled" }, 503);
  if (+(request.headers.get("content-length") || 0) > MAX_SAVE) return json({ ok: false, error: "too large" }, 413);
  const text = await request.text();
  if (text.length > MAX_SAVE) return json({ ok: false, error: "too large" }, 413);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }
  if (!validDeviceId(body && body.id)) return json({ ok: false, error: "bad id" }, 400);
  const key = `save:${body.id}`;
  if (typeof body.snap !== "string" || body.snap.length === 0) { await env.PR_TRACES.delete(key); return json({ ok: true, cleared: true }); }
  if (body.snap.length > MAX_SAVE) return json({ ok: false, error: "snap too large" }, 413);
  const ts = Number.isFinite(+body.ts) && +body.ts > 0 ? Math.floor(+body.ts) : Date.now();
  await env.PR_TRACES.put(key, body.snap, { metadata: { ts }, expirationTtl: 60 * 60 * 24 * 30 }); // 30 天未续局自动清理
  return json({ ok: true });
}

// GET /game-load?id=<deviceId>  →  {ok, snap|null}
async function handleGameLoad(url, env) {
  if (!env.PR_TRACES) return json({ ok: false, error: "kv disabled" }, 503);
  const id = url.searchParams.get("id") || "";
  if (!validDeviceId(id)) return json({ ok: false, error: "bad id" }, 400);
  const snap = await env.PR_TRACES.get(`save:${id}`, "text");
  return json({ ok: true, snap: snap || null });
}
