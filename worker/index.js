// ============================================================
// worker/index.js — Cloudflare Worker
// ============================================================
// 收集「真人打赢 AI」的对局训练样本，并提供一次性取回接口；其余路径回退到静态资源。
//
// 路由：
//   POST /collect  接收一局训练样本 {ver,ts,n,humanSeat,turns,valueMode,scores,lines[]} → 存入 KV
//   GET  /dump     取回聚合的训练 JSONL（需 ?token=；分页 ?cursor=&limit=；可 ?since=&download=1）
//   GET  /stats    汇总统计（局数 / 样本数 / 按人数）
//   其它           交给静态资源（env.ASSETS），站点照常工作
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

  const ts = (body.ts | 0) || Date.now();
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
