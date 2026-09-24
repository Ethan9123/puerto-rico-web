// ============================================================
// tools/browser_audit.js — 宗师(L6) 浏览器实况审计（第三轮 Stage 6）
// ============================================================
// 问题：Node 评测证明了「L6 每次选角用满思考预算」，但真实浏览器里走的是另一条路：
//   aiPickRoleAsync → alphazeroPickRoleAsync → PRAIPool.pickRoleParallel（K 个 Web Worker 各跑一棵 ISMCTS，
//   主线程按角色名合并根 N/Q）。池起不来 / NN 没加载 / 超时都会静默回退（同步 L5、主线程搜索…）。
// 本工具用 Playwright 开真实 Chromium，经真实设置页 UI 跑全 AI 4 人基础局，读 window._aiDecisionLog
// （logAiDecision 写入，环形 1000 条）+ PerformanceObserver('longtask')，回答：
//   L6 是否每次都走池、每个 worker 实际跑了多少迭代、墙钟是否守住预算、主线程是否在 AI 思考窗口内卡顿。
//
// 做法（与 tests/online_e2e_test.js 同款：本地静态服务 + /opt/pw-browsers 预装 Chromium）：
//   - 每局一个全新 BrowserContext（= 用户新开页面：新 worker 池、冷 NN 加载），localStorage 为空；
//   - 设置页：#player-count=座位数、勾 #all-ai、#cpu-level-i=座位等级（默认 [6,5,5,5]）、#ai-think-budget=预设；
//   - 只开 window._fastSpectator（游戏自带的无头/训练开关：跳过观战 5s/10s 停顿与动画），**不碰任何 AI 预算**；
//   - --tempsample 额外加一局 window._roleTempSample=true（模拟有真人在场时 L6 的近平局温度采样路径）；
//   - 群友人格默认关闭（替换 maybeAssignPersonas 为空函数）：人格会以 12%/位 把 L5 席位抬成 L6 并改 _thinkMs，
//     座位配置就不再是 [6,5,5,5]。--allow-personas 保留游戏原行为（逐决策预算按该席位 _thinkMs 计）。
//   - logAiDecision 包一层只读记账（附上 PRAIPool.lastStats 的池内耗时/错误/合并访问数、席位 _thinkMs），不改控制流。
//
// 验收（Stage 6 预注册；阈值可由 CLI 覆盖，默认即计划值）：
//   (a) 0 次 L6 回退、0 次 'pool-failed'（L6 的 'sync' 路径——池可用却没走池——也算回退）；
//   (b) L5/L6 走池决策中 ≥95% 在 预算ms + 600ms 内完成；
//   (c) 没有与 AI 决策窗口 [t, t+ms] 重叠且 >250ms 的 long task；
//   (d) L6 每 worker 迭代数（中位数）≥ 0.7 × alphaMs ÷ Node µs/迭代（--node-us-per-iter，默认 1350）。
//   另有前置检查 (0)：所有局都跑完、座位/全 AI 配置与请求一致。任一 FAIL → exit 1。
//   (c) 的 long task 另用 long-animation-frame 归因为 render（样式/布局/文字排版）或 script（附函数名），
//   只作报告；--lt-cause script 可把 (c) 限定为脚本为主的 long task（默认 any = 计划口径）。
//   (d) 的中位数跨全局：后期 rollout 短、迭代数高，故另按回合段（r1-5 / r6-10 / r11+）给出，便于对照 Node 基准的局面分布。
//
// 用法：
//   node tools/browser_audit.js                                   # 正式审计：deep，2 局 + 不含 tempSample
//   node tools/browser_audit.js --games 2 --tempsample            # 计划中的完整审计（2 局 + 1 局 tempSample）
//   node tools/browser_audit.js --budget fast --games 1           # 冒烟
//   选项：--budget fast|normal|deep|extreme  --games N  --tempsample  --seats 6,5,5,5
//         --node-us-per-iter 1350  --iter-frac 0.7  --iter-stat median|p10
//         --margin-ms 600  --within-share 0.95  --longtask-max-ms 250
//         --lt-cause any|script  --game-timeout-min 60  --out /tmp/browser_audit-<budget>-<ts>.json  --allow-personas  --headed
//   node tools/browser_audit.js --from <report.json> [阈值选项…]   # 不重跑，用新阈值重新汇总/判定已有报告
// 退出码：0 全 PASS；1 任一 FAIL 或运行出错；2 跳过（没装 playwright / 找不到 Chromium，与测试约定一致）。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
function argOpt(name, def) { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def; }
const hasFlag = name => argv.includes(name);
// --knobs '<json>'：开局前注入的 window 旋钮（如 '{"_l6TreePar":true}' 审计树并行）；记入报告
const KNOBS = (() => { const k = argOpt('--knobs', null); if (!k) return null; try { return JSON.parse(k); } catch (e) { console.error('--knobs 不是合法 JSON'); process.exit(1); } })();
if (hasFlag('--help') || hasFlag('-h')) {
  const ls = fs.readFileSync(__filename, 'utf8').split('\n'); const end = ls.findIndex(l => !l.startsWith('//'));
  console.log(ls.slice(0, end).join('\n'));
  process.exit(0);
}
const numOpt = (name, def) => {
  const v = Number(argOpt(name, String(def)));
  if (!Number.isFinite(v)) { console.error(`bad ${name}: ${argOpt(name)}`); process.exit(1); }
  return v;
};
// --from <report.json>：不重跑对局，只用新阈值重新汇总/判定一份已有报告（deep 审计很贵，改阈值不必重跑）
const FROM = argOpt('--from', null);
const FROM_R = FROM ? JSON.parse(fs.readFileSync(FROM, 'utf8')) : null;
const BUDGET = FROM_R ? FROM_R.args.budget : argOpt('--budget', 'deep');
if (!['fast', 'normal', 'deep', 'extreme'].includes(BUDGET)) { console.error(`bad --budget ${BUDGET} (fast|normal|deep|extreme)`); process.exit(1); }
const GAMES = Math.max(0, Math.floor(numOpt('--games', 2)));
const TEMPSAMPLE = hasFlag('--tempsample');
const SEATS = (FROM_R && !hasFlag('--seats')) ? FROM_R.args.seats : argOpt('--seats', '6,5,5,5').split(',').map(s => parseInt(s, 10));
if (SEATS.length < 2 || SEATS.length > 5 || SEATS.some(l => !(l >= 1 && l <= 6))) { console.error('bad --seats (2–5 levels in 1..6)'); process.exit(1); }
const NODE_US = numOpt('--node-us-per-iter', 1350);
const ITER_FRAC = numOpt('--iter-frac', 0.7);
const ITER_STAT = argOpt('--iter-stat', 'median');
if (!['median', 'p10'].includes(ITER_STAT)) { console.error('bad --iter-stat (median|p10)'); process.exit(1); }
const MARGIN_MS = numOpt('--margin-ms', 600);
const WITHIN_SHARE = numOpt('--within-share', 0.95);
const LT_MAX_MS = numOpt('--longtask-max-ms', 250);
// (c) 计哪些 long task：any（计划口径，默认）| script（只计脚本为主的，即主线程 AI 记账/游戏 JS；渲染卡顿另行报告）
const LT_CAUSE = argOpt('--lt-cause', 'any');
if (!['any', 'script'].includes(LT_CAUSE)) { console.error('bad --lt-cause (any|script)'); process.exit(1); }
const GAME_TIMEOUT_MS = numOpt('--game-timeout-min', 60) * 60000;
const ALLOW_PERSONAS = FROM_R ? !!FROM_R.args.allowPersonas : hasFlag('--allow-personas');
const HEADED = hasFlag('--headed');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
const OUT = argOpt('--out', FROM ? null : path.join(os.tmpdir(), `browser_audit-${BUDGET}-${STAMP}.json`));
if (!FROM && GAMES + (TEMPSAMPLE ? 1 : 0) === 0) { console.error('nothing to do: --games 0 and no --tempsample'); process.exit(1); }

// ---------------------------------------------------------------- 环境（与 tests/online_e2e_test.js 同约定）
const CHROME_CANDIDATES = [
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
];
function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  const dir = '/opt/pw-browsers';
  if (fs.existsSync(dir)) {
    for (const d of fs.readdirSync(dir)) {
      const p = path.join(dir, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}
let chromium, CHROME = null;
if (!FROM) {
  try { ({ chromium } = require('playwright')); }
  catch (e) { console.log('skipped: playwright 未安装（npm i -D playwright）'); process.exit(2); }
  CHROME = findChrome();
  if (!CHROME) { console.log('skipped: 找不到预装 Chromium（/opt/pw-browsers）'); process.exit(2); }
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
function serve() {
  return new Promise((res, rej) => {
    const s = http.createServer((req, rq) => {
      const u = new URL(req.url, 'http://x');
      // 同源后端端点打桩（worker/index.js 契约）：存档 / 读档 / 对局日志收集——本审计不需要它们，只求不报错
      if (u.pathname === '/game-save' || u.pathname === '/collect') {
        req.resume(); req.on('end', () => { rq.writeHead(200, { 'Content-Type': 'application/json' }); rq.end('{"ok":true}'); }); return;
      }
      if (u.pathname === '/game-load') { rq.writeHead(200, { 'Content-Type': 'application/json' }); return rq.end('{"ok":true,"snap":null}'); }
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
      const f = path.join(ROOT, rel);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); return rq.end('nf'); }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rq);
    });
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

// ---------------------------------------------------------------- 统计小工具
const sortNum = a => a.slice().sort((x, y) => x - y);
function pct(a, p) { // 最近秩百分位
  if (!a.length) return null;
  const s = sortNum(a);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1))];
}
const median = a => pct(a, 50);
const countBy = (a, f) => a.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
const fmtMix = m => Object.keys(m).length ? Object.entries(m).map(([k, v]) => `${k}:${v}`).join(' ') : '—';
const fmtMs = ms => ms == null ? '—' : ms >= 60000 ? `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s` : `${(ms / 1000).toFixed(1)}s`;
const r1 = x => x == null ? null : Math.round(x * 10) / 10;
const r3 = x => x == null ? null : Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------- 页内注入
// 开局前（页面脚本之前）装好 long task 观察器；时间戳换算成 epoch ms，与 _aiDecisionLog 的 Date.now() 同一时钟。
function initScript(cfg) {
  window._fastSpectator = true; // 游戏自带开关：跳过观战停顿/动画；不影响任何 AI 预算
  if (cfg.tempSample) window._roleTempSample = true;
  if (cfg.knobs) Object.assign(window, cfg.knobs);   // --knobs：在任何页面脚本之前注入
  window.__auditLT = [];
  window.__auditLTSupported = false;
  try {
    const po = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const a = e.attribution && e.attribution[0];
        window.__auditLT.push({ s: performance.timeOrigin + e.startTime, d: e.duration, name: e.name,
          attr: a ? [a.containerType, a.containerSrc, a.containerName].filter(Boolean).join(' ') : '' });
      }
    });
    po.observe({ type: 'longtask', buffered: true });
    window.__auditLTSupported = (PerformanceObserver.supportedEntryTypes || []).includes('longtask');
  } catch (e) { window.__auditLTErr = String(e && e.message || e); }
  // long-animation-frame（LoAF）只用于给 long task 归因：是脚本（哪个函数）还是渲染（样式/布局/文字排版）
  window.__auditLoAF = [];
  try {
    const po2 = new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        const end = e.startTime + e.duration;
        const scripts = (e.scripts || []).map(s => ({ d: s.duration, fsl: s.forcedStyleAndLayoutDuration || 0,
          src: `${s.sourceFunctionName || s.invoker || '?'}@${String(s.sourceURL || '').split('/').pop()}` }));
        window.__auditLoAF.push({ s: performance.timeOrigin + e.startTime, d: e.duration,
          renderMs: e.renderStart ? end - e.renderStart : 0, styleLayoutMs: e.styleAndLayoutStart ? end - e.styleAndLayoutStart : 0,
          scriptMs: scripts.reduce((a, x) => a + x.d, 0), scripts: scripts.sort((a, b) => b.d - a.d).slice(0, 3) });
      }
    });
    po2.observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) {}
}

// 游戏脚本加载后、点「开始游戏」前：只读记账钩子 + （默认）关闭群友人格
function installHooks(cfg) {
  const out = { hookedLog: false, personasOff: false };
  if (!cfg.allowPersonas && typeof window.maybeAssignPersonas === 'function') {
    window.maybeAssignPersonas = function () { /* browser_audit: personas off → seat levels stay as configured */ };
    out.personasOff = true;
  }
  if (typeof window.logAiDecision === 'function' && !window.logAiDecision.__audit) {
    const orig = window.logAiDecision;
    const wrapped = function (p, available, r0, t0) {
      const r = orig.apply(this, arguments);
      try {
        const log = window._aiDecisionLog, e = log && log[log.length - 1];
        if (e && e.t === t0 && e.seat === p.idx) {
          e.thinkMs = p._thinkMs || null;
          e.persona = (p._persona && p._persona.key) || null;
          const s = PRAIPool.lastStats;
          if (e.path !== 'sync' && s) {
            e.poolMs = s.ms; e.errors = (s.errors || []).slice(0, 4);
            e.sumN = Array.isArray(s.merged) ? s.merged.reduce((a, m) => a + (m.N || 0), 0) : null;
          }
          e.game = window.__auditGame;
        }
      } catch (err) {}
      return r;
    };
    wrapped.__audit = true;
    window.logAiDecision = wrapped;
    out.hookedLog = true;
  }
  // 局终时刻（100ms 粒度）：G.gameOver 在最后一轮选角后置位
  window.__auditOverAt = null;
  const iv = setInterval(() => { try { if (G && G.gameOver && !window.__auditOverAt) { window.__auditOverAt = Date.now(); clearInterval(iv); } } catch (e) {} }, 100);
  return out;
}

// ---------------------------------------------------------------- 一局
async function playOne(browser, BASE, gi, tempSample, log) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const consoleMsgs = [], pageErrors = [];
  // supabase-config.js 置空 → 走 LocalTransport，不出网；其它非本机请求一律拒绝（容器无外网，免得挂起）
  await ctx.route('**/supabase-config.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* browser_audit: no supabase */' }));
  await ctx.route(url => !/^https?:\/\/127\.0\.0\.1[:/]/.test(url.href) && !/^(data|blob):/.test(url.href), r => r.abort());
  const page = await ctx.newPage();
  page.on('console', m => {
    const ty = m.type();
    const tx = m.text();
    if (ty === 'warning' || ty === 'error' || /ai-worker|\[L6\]|fallback|回退/.test(tx)) consoleMsgs.push({ t: Date.now(), type: ty, text: tx.slice(0, 300) });
  });
  page.on('pageerror', e => pageErrors.push({ t: Date.now(), text: String(e && e.message || e).slice(0, 300) }));
  page.on('dialog', d => { pageErrors.push({ t: Date.now(), text: 'DIALOG ' + d.message().slice(0, 200) }); d.dismiss().catch(() => {}); });
  page.on('worker', w => w.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') consoleMsgs.push({ t: Date.now(), type: 'worker-' + m.type(), text: m.text().slice(0, 300) }); }));
  await page.addInitScript(initScript, { tempSample, knobs: KNOBS });

  const rec = { game: gi, tempSample, ok: false, error: null };
  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof startGame === 'function' && typeof PRAIPool === 'object' && !!document.getElementById('btn-start'), null, { timeout: 30000 });
    const hooks = await page.evaluate(installHooks, { allowPersonas: ALLOW_PERSONAS });
    await page.evaluate(g => { window.__auditGame = g; }, gi);

    // ---- 设置页（真实 UI 控件）----
    await page.selectOption('#player-count', String(SEATS.length));
    await page.check('#all-ai');
    for (let i = 0; i < SEATS.length; i++) await page.selectOption(`#cpu-level-${i}`, String(SEATS[i]));
    for (const id of ['mod-newbuildings', 'mod-nobles', 'mod-tibs', 'mod-festival', 'mod-buccaneer', 'mod-balance']) {
      if (await page.locator('#' + id).count()) await page.uncheck('#' + id);
    }
    await page.selectOption('#ai-think-budget', BUDGET);
    const env = await page.evaluate(() => ({
      hardwareConcurrency: navigator.hardwareConcurrency, userAgent: navigator.userAgent,
      aiWorkersK: window._aiWorkersK || null, poolAvailable: PRAIPool.available(),
      ltSupported: window.__auditLTSupported, ltErr: window.__auditLTErr || null,
    }));
    const startAt = Date.now();
    await page.click('#btn-start');
    await page.waitForFunction(() => typeof G !== 'undefined' && G && Array.isArray(G.players) && !document.getElementById('game-screen').classList.contains('hidden'), null, { timeout: 30000 });
    const setup = await page.evaluate(() => ({
      seats: G.players.map((p, i) => ({ seat: i, lvl: p._aiLevel || null, isHuman: !!p.isHuman, name: p.name, persona: (p._persona && p._persona.key) || null, thinkMs: p._thinkMs || null })),
      budget: Object.assign({}, window._aiThinkBudget), allAIMode: !!window._allAIMode, fastSpectator: !!window._fastSpectator,
      roleTempSample: !!window._roleTempSample, tsMinIters: window._tsMinIters != null ? window._tsMinIters : 600,
      mods: G.expansionType || null, numPlayers: G.numPlayers,
    }));
    Object.assign(rec, { env, hooks, setup, startAt });
    log(`game ${gi}${tempSample ? ' [tempSample]' : ''}: started — seats ${setup.seats.map(s => 'L' + s.lvl + (s.persona ? '(' + s.persona + ')' : '')).join(',')}, ` +
      `hardwareConcurrency=${env.hardwareConcurrency}, budget ${BUDGET} (alphaMs ${setup.budget.alphaMs}, expertMs ${setup.budget.expertMs})`);

    // ---- 等终局 ----
    let lastBeat = Date.now(), done = false;
    while (Date.now() - startAt < GAME_TIMEOUT_MS) {
      await page.waitForTimeout(1000);
      const st = await page.evaluate(() => ({ over: !!(G && G.gameOver), overAt: window.__auditOverAt, turn: G && G.turnNumber, n: (window._aiDecisionLog || []).length, poolK: PRAIPool.K }));
      if (st.over && st.overAt) { done = true; break; }
      if (Date.now() - lastBeat >= 60000) { lastBeat = Date.now(); log(`  … game ${gi}: turn ${st.turn}, ${st.n} role decisions, pool K=${st.poolK}, ${fmtMs(Date.now() - startAt)}`); }
    }
    if (!done) throw new Error(`game did not finish within ${fmtMs(GAME_TIMEOUT_MS)}`);
    await page.waitForFunction(() => { const m = document.getElementById('modal'); return m && !m.classList.contains('hidden'); }, null, { timeout: 15000 }).catch(() => {});
    const fin = await page.evaluate(() => {
      const scores = G.players.map((p, i) => {
        const bvp = p.buildings.reduce((s, b) => s + BLD_BY_ID[b.bid].vp, 0);
        return { seat: i, lvl: p._aiLevel || null, total: p.vp + bvp + G.getSpecialVPs(p), vp: p.vp, bvp };
      });
      return {
        overAt: window.__auditOverAt, turns: G.turnNumber, scores,
        decisions: (window._aiDecisionLog || []).slice(),
        longtasks: (window.__auditLT || []).slice(),
        loaf: (window.__auditLoAF || []).filter(x => x.d >= 50),
        pool: { K: PRAIPool.K, nn: PRAIPool.nn, wasm: PRAIPool.wasm, broken: PRAIPool._broken, reqs: PRAIPool._reqId },
      };
    });
    Object.assign(rec, fin, { wallMs: fin.overAt - startAt, ok: true });
  } catch (e) {
    rec.error = String(e && e.message || e);
    try { // 尽量带回半局数据，便于诊断
      const part = await page.evaluate(() => ({ decisions: (window._aiDecisionLog || []).slice(), longtasks: (window.__auditLT || []).slice(), loaf: (window.__auditLoAF || []).filter(x => x.d >= 50), turns: typeof G !== 'undefined' && G ? G.turnNumber : null }));
      Object.assign(rec, part);
    } catch (e2) {}
  } finally {
    rec.console = consoleMsgs.slice(0, 300);
    rec.pageErrors = pageErrors.slice(0, 100);
    await ctx.close().catch(() => {});
  }
  return rec;
}

// ---------------------------------------------------------------- 汇总
function budgetFor(d, B) { // 该决策应遵守的思考预算（ms）
  if (d.thinkMs) return d.thinkMs; // 人格席位 _thinkMs（仅 --allow-personas 时可能出现）
  const m = d.mode || (d.lvl >= 6 ? 'alpha' : d.lvl === 5 ? 'expert' : d.lvl === 4 ? 'hard' : null);
  return m === 'alpha' ? B.alphaMs : m === 'expert' ? B.expertMs : m === 'hard' ? B.hardMs : null;
}

// long task 归因：与之重叠最多的 long-animation-frame 里，渲染（样式/布局/排版）与脚本谁占大头
function ltCause(x, loafs) {
  let best = null, bo = 0;
  for (const f of loafs) { const o = Math.min(x.s + x.d, f.s + f.d) - Math.max(x.s, f.s); if (o > bo) { bo = o; best = f; } }
  if (!best) return { kind: 'unknown' };
  return { kind: best.renderMs >= best.scriptMs ? 'render' : 'script', renderMs: Math.round(best.renderMs), scriptMs: Math.round(best.scriptMs),
    top: best.scripts && best.scripts[0] ? best.scripts[0].src : null };
}

function summarize(games) {
  const B = (games.find(g => g.setup) || {}).setup ? games.find(g => g.setup).setup.budget : {};
  const all = [];
  for (const g of games) for (const d of (g.decisions || [])) all.push(Object.assign({ gameIdx: g.game, tempSample: g.tempSample }, d));
  const lts = [];
  for (const g of games) for (const x of (g.longtasks || [])) lts.push(Object.assign({ gameIdx: g.game, cause: ltCause(x, g.loaf || []) }, x));

  // 每个决策的窗口 [t, t+ms] 与 long task 重叠
  for (const d of all) {
    d.budgetMs = budgetFor(d, B);
    d.lt = lts.filter(x => x.gameIdx === d.gameIdx && x.s < d.t + d.ms && x.s + x.d > d.t);
  }
  const inAnyWindow = x => all.some(d => d.gameIdx === x.gameIdx && x.s < d.t + d.ms && x.s + x.d > d.t);
  const ltIn = lts.filter(inAnyWindow), ltOut = lts.filter(x => !inAnyWindow(x));

  const levels = [...new Set(all.map(d => d.lvl))].sort((a, b) => b - a);
  const perLevel = {};
  for (const L of levels) {
    const ds = all.filter(d => d.lvl === L);
    const pooled = ds.filter(d => d.path === 'pool');
    const within = pooled.filter(d => d.budgetMs != null && d.ms <= d.budgetMs + MARGIN_MS);
    const pw = [].concat(...pooled.map(d => d.perWorker || []));
    const over = pooled.filter(d => d.poolMs != null).map(d => d.ms - d.poolMs);
    const ltL = [].concat(...ds.map(d => d.lt));
    perLevel['L' + L] = {
      n: ds.length, path: countBy(ds, d => d.path), mode: countBy(ds.filter(d => d.mode), d => d.mode),
      fallback: ds.filter(d => d.fallback).length, syncWhilePool: ds.filter(d => d.syncWhilePool).length,
      K: countBy(pooled, d => d.K), poolK: countBy(ds, d => d.poolK),
      workerErrors: pooled.filter(d => d.errors && d.errors.length).length,
      budgetMs: median(pooled.map(d => d.budgetMs).filter(x => x != null)),
      wallMs: { median: median(ds.map(d => d.ms)), p90: pct(ds.map(d => d.ms), 90), max: ds.length ? Math.max(...ds.map(d => d.ms)) : null },
      pooledWithin: { n: pooled.length, within: within.length, share: pooled.length ? within.length / pooled.length : null },
      overheadMs: { median: median(over), max: over.length ? Math.max(...over) : null },
      perWorkerIters: { n: pw.length, median: median(pw), p10: pct(pw, 10), min: pw.length ? Math.min(...pw) : null },
      perDecisionIters: { median: median(pooled.map(d => (d.perWorker || []).reduce((a, b) => a + b, 0))) },
      longtasksInWindows: { n: ltL.length, maxMs: ltL.length ? Math.max(...ltL.map(x => x.d)) : 0 },
      slowest: pooled.filter(d => d.budgetMs != null && d.ms > d.budgetMs + MARGIN_MS).map(d => ({ game: d.gameIdx, turn: d.turn, seat: d.seat, ms: d.ms, poolMs: d.poolMs, budgetMs: d.budgetMs })).slice(0, 10),
    };
  }

  // L6 迭代（只看成功的 alpha 池决策；回退到 expert 池的不算）
  const l6a = all.filter(d => d.lvl === 6 && d.path === 'pool' && d.mode === 'alpha');
  const l6pw = [], l6ratio = [];
  for (const d of l6a) for (const it of (d.perWorker || [])) {
    l6pw.push(it);
    const bud = d.budgetMs || B.alphaMs;
    l6ratio.push(it / (bud * 1000 / NODE_US)); // 该 worker 实际迭代 ÷ 同墙钟下 Node 单线程迭代数
  }
  const l6 = {
    decisions: l6a.length, workerResults: l6pw.length,
    median: median(l6pw), p10: pct(l6pw, 10), min: l6pw.length ? Math.min(...l6pw) : null,
    ratioMedian: median(l6ratio), ratioP10: pct(l6ratio, 10),
    alphaMs: B.alphaMs, alphaIters: B.alphaIters,
    nodeItersAtBudget: B.alphaMs ? B.alphaMs * 1000 / NODE_US : null,
    target: B.alphaMs ? ITER_FRAC * B.alphaMs * 1000 / NODE_US : null,
  };
  l6.impliedBrowserUsPerIter = l6.median ? B.alphaMs * 1000 / l6.median : null;
  // 每次迭代的成本强烈依赖对局阶段（后期 rollout 短 → 迭代多），分段给出便于与 Node 基准的局面分布对照
  const phase = t => t <= 5 ? 'r1-5' : t <= 10 ? 'r6-10' : 'r11+';
  l6.byPhase = {};
  for (const ph of ['r1-5', 'r6-10', 'r11+']) {
    const pw = [].concat(...l6a.filter(d => phase(d.turn || 0) === ph).map(d => d.perWorker || []));
    l6.byPhase[ph] = { n: pw.length, median: median(pw), p10: pct(pw, 10) };
  }
  l6.capBinds = !!(B.alphaIters && l6.nodeItersAtBudget && B.alphaIters < l6.target);

  // L6 回退：日志 fallback 标记 + 池可用却走了同步（worker 无 NN → 主线程 alphazeroPickRole / level5Reactive）
  const l6fb = all.filter(d => d.lvl === 6 && (d.fallback || d.path !== 'pool'));
  const poolFailed = all.filter(d => d.path === 'pool-failed');
  const pooled56 = all.filter(d => (d.lvl === 5 || d.lvl === 6) && d.path === 'pool');
  const within56 = pooled56.filter(d => d.budgetMs != null && d.ms <= d.budgetMs + MARGIN_MS);
  const ltScript = ltIn.filter(x => x.cause.kind === 'script');
  const ltBad = ltIn.filter(x => x.d > LT_MAX_MS);

  const env = (games.find(g => g.env) || {}).env || {};
  return {
    env: { hardwareConcurrency: env.hardwareConcurrency, aiWorkersK: env.aiWorkersK || null,
      expectedK: env.hardwareConcurrency ? Math.max(1, Math.min(env.aiWorkersK || 8, env.hardwareConcurrency - 1)) : null,
      poolK: [...new Set(games.map(g => g.pool && g.pool.K).filter(x => x != null))] },
    budget: B, levels: perLevel, l6iters: l6,
    l6Fallbacks: l6fb.map(d => ({ game: d.gameIdx, turn: d.turn, path: d.path, mode: d.mode, fallback: d.fallback, syncWhilePool: d.syncWhilePool, ms: d.ms })),
    poolFailed: poolFailed.map(d => ({ game: d.gameIdx, turn: d.turn, lvl: d.lvl, ms: d.ms, errors: d.errors || null })),
    pooled56: { n: pooled56.length, within: within56.length, share: pooled56.length ? within56.length / pooled56.length : null },
    longtasks: {
      total: lts.length, maxMs: lts.length ? Math.max(...lts.map(x => x.d)) : 0,
      inWindows: { n: ltIn.length, maxMs: ltIn.length ? Math.max(...ltIn.map(x => x.d)) : 0, over: ltBad.length,
        causeAll: countBy(ltIn, x => x.cause.kind), causeOver: countBy(ltBad, x => x.cause.kind),
        script: { n: ltScript.length, maxMs: ltScript.length ? Math.max(...ltScript.map(x => x.d)) : 0, over: ltScript.filter(x => x.d > LT_MAX_MS).length,
          sources: countBy(ltScript, x => x.cause.top) },
        scriptSourcesOver: countBy(ltBad.filter(x => x.cause.kind === 'script'), x => x.cause.top),
        top: ltIn.slice().sort((a, b) => b.d - a.d).slice(0, 8).map(x => {
          const d = all.find(d => d.gameIdx === x.gameIdx && x.s < d.t + d.ms && x.s + x.d > d.t) || {};
          return { game: x.gameIdx, ms: Math.round(x.d), at: x.s, turn: d.turn, lvl: d.lvl, offMs: d.t != null ? Math.round(x.s - d.t) : null, cause: x.cause };
        }) },
      outside: { n: ltOut.length, maxMs: ltOut.length ? Math.max(...ltOut.map(x => x.d)) : 0, sumMs: Math.round(ltOut.reduce((a, x) => a + x.d, 0)) },
    },
    totalGameMs: games.reduce((a, g) => a + (g.wallMs || 0), 0),
    decisions: all.length,
  };
}

function checks(games, S) {
  const want = SEATS.join(',');
  const setupBad = games.filter(g => !g.ok || !g.setup || g.setup.seats.map(s => s.lvl).join(',') !== want || g.setup.seats.some(s => s.isHuman) || !g.setup.allAIMode);
  const ltUnsupported = games.some(g => g.env && !g.env.ltSupported);
  const l6 = S.l6iters;
  const stat = ITER_STAT === 'p10' ? l6.ratioP10 : l6.ratioMedian;
  const out = [];
  out.push({ id: '0', name: 'setup', pass: games.length > 0 && setupBad.length === 0,
    detail: setupBad.length ? `${setupBad.length}/${games.length} game(s) failed or mis-configured: ` + setupBad.map(g => `g${g.game}:${g.error || (g.setup ? g.setup.seats.map(s => (s.isHuman ? 'H' : 'L' + s.lvl)).join(',') : 'no setup')}`).join('; ')
      : `${games.length} game(s) completed, seats [${want}] all-AI, personas ${ALLOW_PERSONAS ? 'allowed' : 'off'}` });
  out.push({ id: 'a', name: 'no L6 fallback / no pool-failed', pass: l6.decisions > 0 && S.l6Fallbacks.length === 0 && S.poolFailed.length === 0,
    detail: `L6 fallbacks ${S.l6Fallbacks.length} (flag ${S.l6Fallbacks.filter(d => d.fallback).length}, non-pool ${S.l6Fallbacks.filter(d => d.path !== 'pool').length}), pool-failed ${S.poolFailed.length}, L6 alpha-pool decisions ${l6.decisions}` });
  out.push({ id: 'b', name: `≥${Math.round(WITHIN_SHARE * 100)}% of L5/L6 pooled decisions within budget+${MARGIN_MS}ms`,
    pass: S.pooled56.n > 0 && S.pooled56.share >= WITHIN_SHARE,
    detail: `${S.pooled56.within}/${S.pooled56.n} = ${S.pooled56.share == null ? '—' : (S.pooled56.share * 100).toFixed(1) + '%'}` });
  const W = S.longtasks.inWindows, cW = LT_CAUSE === 'script' ? W.script : W;
  out.push({ id: 'c', name: `no ${LT_CAUSE === 'script' ? 'script-dominated ' : ''}long task >${LT_MAX_MS}ms overlapping an AI decision window`,
    pass: !ltUnsupported && cW.over === 0,
    detail: ltUnsupported ? 'longtask PerformanceObserver unsupported → no data'
      : `${cW.n} overlapping long task(s), max ${Math.round(cW.maxMs)}ms, ${cW.over} over ${LT_MAX_MS}ms` +
        (LT_CAUSE === 'any' ? ` (by cause >${LT_MAX_MS}ms: ${fmtMix(W.causeOver)}; script-dominated max ${Math.round(W.script.maxMs)}ms)` : ` (all causes: ${W.over} over, max ${Math.round(W.maxMs)}ms)`) });
  out.push({ id: 'd', name: `L6 per-worker iterations (${ITER_STAT}) ≥ ${ITER_FRAC} × alphaMs ÷ ${NODE_US}µs`,
    pass: l6.workerResults > 0 && stat != null && stat >= ITER_FRAC,
    detail: l6.workerResults ? `${ITER_STAT} ${ITER_STAT === 'p10' ? l6.p10 : l6.median} vs target ${l6.target == null ? '—' : Math.round(l6.target)} (implied ratio ${r3(stat)} of Node throughput; need ≥ ${ITER_FRAC})` + (l6.capBinds ? ` — alphaIters cap ${l6.alphaIters} < target: cannot pass at this preset` : '')
      : 'no L6 alpha-pool decisions' });
  return out;
}

function printReport(R, log) {
  const S = R.summary, B = S.budget || {};
  const L = [];
  L.push('');
  L.push(`== Browser AI audit — budget '${R.args.budget}' (L6 alphaMs ${B.alphaMs} / alphaIters ${B.alphaIters}; L5 expertMs ${B.expertMs} / expertIters ${B.expertIters}), seats [${R.args.seats.join(',')}]`);
  const env = (R.games.find(g => g.env) || {}).env || {};
  const pools = [...new Set(R.games.map(g => g.pool && g.pool.K).filter(x => x != null))];
  L.push(`Chromium hardwareConcurrency=${env.hardwareConcurrency} → K = max(1, min(${env.aiWorkersK || 8}, ${env.hardwareConcurrency}−1)) = ${Math.max(1, Math.min(env.aiWorkersK || 8, (env.hardwareConcurrency || 2) - 1))}; PRAIPool.K observed ${pools.join('/') || '—'}` +
    ` (nn ${[...new Set(R.games.map(g => g.pool && g.pool.nn))].join('/')}, wasm ${[...new Set(R.games.map(g => g.pool && g.pool.wasm))].join('/')})`);
  if (R.host.loadStart && R.host.loadStart[0] > R.host.nproc) L.push(`WARNING: host oversubscribed (loadavg ${R.host.loadStart[0].toFixed(1)} > ${R.host.nproc} cpus) — iteration and latency numbers are pessimistic`);
  L.push(`Host: nproc ${R.host.nproc}, loadavg start ${R.host.loadStart.map(x => x.toFixed(2)).join(' ')} → end ${R.host.loadEnd ? R.host.loadEnd.map(x => x.toFixed(2)).join(' ') : '—'}`);
  for (const g of R.games) {
    const ts = g.setup ? (g.setup.roleTempSample ? (B.alphaIters >= g.setup.tsMinIters ? ' [tempSample ON]' : ` [tempSample flag set, inactive: alphaIters ${B.alphaIters} < ${g.setup.tsMinIters}]`) : '') : '';
    if (!g.ok) { L.push(`Game ${g.game}${ts}: FAILED — ${g.error} (${(g.decisions || []).length} decisions logged, turn ${g.turns})`); continue; }
    const sc = g.scores.slice().sort((a, b) => b.total - a.total);
    L.push(`Game ${g.game}${ts}: ${fmtMs(g.wallMs)}, ${g.turns} rounds, ${g.decisions.length} role decisions; scores ${g.scores.map(s => `L${s.lvl}:${s.total}`).join(' ')} (winner seat ${sc[0].seat} L${sc[0].lvl})` +
      (g.pageErrors.length ? `; ${g.pageErrors.length} page error(s)` : '') + (g.console.length ? `; ${g.console.length} console message(s)` : ''));
  }
  L.push('Per level:');
  for (const [k, v] of Object.entries(S.levels)) {
    L.push(`  ${k}: n=${v.n} | path ${fmtMix(v.path)} | mode ${fmtMix(v.mode)} | fallback ${v.fallback}, syncWhilePool ${v.syncWhilePool}, worker errors ${v.workerErrors} | K ${fmtMix(v.K)} poolK ${fmtMix(v.poolK)}`);
    L.push(`      wall ms median ${v.wallMs.median} p90 ${v.wallMs.p90} max ${v.wallMs.max} vs budget ${v.budgetMs} | within budget+${MARGIN_MS}: ${v.pooledWithin.within}/${v.pooledWithin.n}` +
      (v.pooledWithin.share != null ? ` (${(v.pooledWithin.share * 100).toFixed(1)}%)` : '') + ` | overhead (wall−pool) median ${v.overheadMs.median} max ${v.overheadMs.max} ms`);
    L.push(`      per-worker iters median ${v.perWorkerIters.median} p10 ${v.perWorkerIters.p10} min ${v.perWorkerIters.min} (n=${v.perWorkerIters.n}); per-decision total median ${v.perDecisionIters.median}` +
      ` | long tasks in windows ${v.longtasksInWindows.n} (max ${Math.round(v.longtasksInWindows.maxMs)} ms)`);
    if (v.slowest.length) L.push(`      over budget+${MARGIN_MS}: ` + v.slowest.map(s => `g${s.game} t${s.turn} seat${s.seat} ${s.ms}ms (pool ${s.poolMs}, pre-pool ${s.poolMs != null ? s.ms - s.poolMs : '?'})`).join('; '));
  }
  const l6 = S.l6iters;
  L.push(`L6 per-worker iterations (alpha pool, ${l6.decisions} decisions, ${l6.workerResults} worker results): median ${l6.median}, p10 ${l6.p10}, min ${l6.min}`);
  L.push(`   Node reference ${NODE_US} µs/iter → ${l6.nodeItersAtBudget == null ? '—' : Math.round(l6.nodeItersAtBudget)} iters in ${l6.alphaMs} ms; target ${ITER_FRAC}× = ${l6.target == null ? '—' : Math.round(l6.target)}` +
    `; implied ratio median ${r3(l6.ratioMedian)} p10 ${r3(l6.ratioP10)}; implied browser µs/iter/worker at median ${l6.impliedBrowserUsPerIter == null ? '—' : Math.round(l6.impliedBrowserUsPerIter)}` +
    `\n   by round: ` + Object.entries(l6.byPhase).map(([k, v]) => `${k} median ${v.median} p10 ${v.p10} (n=${v.n})`).join('; ') +
    (l6.capBinds ? `\n   NOTE: alphaIters cap ${l6.alphaIters} < target ${Math.round(l6.target)} — the iteration cap, not time, ends each search at this preset` : ''));
  const lt = S.longtasks;
  L.push(`Long tasks: total ${lt.total} (max ${Math.round(lt.maxMs)} ms); overlapping AI windows ${lt.inWindows.n} (max ${Math.round(lt.inWindows.maxMs)} ms, >${LT_MAX_MS}ms: ${lt.inWindows.over}); outside windows ${lt.outside.n} (max ${Math.round(lt.outside.maxMs)} ms, sum ${lt.outside.sumMs} ms)`);
  L.push(`   in-window cause (via long-animation-frame): all ${fmtMix(lt.inWindows.causeAll)}; >${LT_MAX_MS}ms ${fmtMix(lt.inWindows.causeOver)}` +
    `; script-dominated ${lt.inWindows.script.n} (max ${Math.round(lt.inWindows.script.maxMs)} ms; ${fmtMix(lt.inWindows.script.sources)})`);
  if (lt.inWindows.top.length) L.push('   top in-window: ' + lt.inWindows.top.map(x => `g${x.game} t${x.turn} L${x.lvl} +${x.offMs}ms ${x.ms}ms ${x.cause.kind}${x.cause.kind === 'script' ? '(' + x.cause.top + ')' : ''}`).join(', '));
  if (S.l6Fallbacks.length) L.push('L6 fallbacks: ' + S.l6Fallbacks.slice(0, 10).map(d => `g${d.game} t${d.turn} ${d.path}/${d.mode}`).join('; '));
  if (S.poolFailed.length) L.push('pool-failed: ' + S.poolFailed.slice(0, 10).map(d => `g${d.game} t${d.turn} L${d.lvl} ${d.ms}ms ${JSON.stringify(d.errors)}`).join('; '));
  const warns = [].concat(...R.games.map(g => (g.console || []).map(c => `g${g.game} ${c.type}: ${c.text}`)));
  const errs = [].concat(...R.games.map(g => (g.pageErrors || []).map(c => `g${g.game}: ${c.text}`)));
  if (errs.length) L.push(`Page errors (${errs.length}):\n   ` + errs.slice(0, 5).join('\n   '));
  if (warns.length) L.push(`Console warnings / AI-path logs (${warns.length}, first 6):\n   ` + warns.slice(0, 6).join('\n   '));
  L.push(`Total game time: ${fmtMs(S.totalGameMs)} over ${R.games.filter(g => g.ok).length} game(s), ${S.decisions} role decisions`);
  L.push('Checks:');
  for (const c of R.checks) L.push(`  ${c.pass ? 'PASS' : 'FAIL'} (${c.id}) ${c.name}: ${c.detail}`);
  L.push(FROM ? `Re-analysed ${FROM}${R.out ? ' → ' + R.out : ''}` : `Report: ${R.out}`);
  log(L.join('\n'));
}

// ---------------------------------------------------------------- main
(async () => {
  const log = s => console.log(s);
  const R = {
    tool: 'browser_audit', version: 1, startedAt: new Date().toISOString(), out: OUT,
    args: { budget: BUDGET, knobs: KNOBS, games: GAMES, tempsample: TEMPSAMPLE, seats: SEATS, nodeUsPerIter: NODE_US, iterFrac: ITER_FRAC, iterStat: ITER_STAT,
      marginMs: MARGIN_MS, withinShare: WITHIN_SHARE, longtaskMaxMs: LT_MAX_MS, ltCause: LT_CAUSE, allowPersonas: ALLOW_PERSONAS, gameTimeoutMin: GAME_TIMEOUT_MS / 60000 },
    host: { nproc: os.cpus().length, loadStart: os.loadavg(), loadEnd: null, node: process.version, chrome: CHROME },
    games: [],
  };
  let gitHead = null;
  try { gitHead = require('child_process').execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) {}
  R.host.engineCommit = gitHead;
  const finish = (code) => {
    if (!FROM) { R.host.loadEnd = os.loadavg(); R.finishedAt = new Date().toISOString(); }
    R.summary = summarize(R.games);
    R.checks = checks(R.games, R.summary);
    if (OUT) {
      try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(R, null, 1)); }
      catch (e) { console.error('could not write report: ' + e.message); code = 1; }
    }
    printReport(R, log);
    const fail = R.checks.some(c => !c.pass);
    return code != null ? code : (fail ? 1 : 0);
  };

  if (FROM_R) { // 重新判定：沿用原报告的对局与主机信息，阈值用本次 CLI
    Object.assign(R, { games: FROM_R.games, host: FROM_R.host, startedAt: FROM_R.startedAt, finishedAt: FROM_R.finishedAt, reanalysedFrom: FROM });
    Object.assign(R.args, { games: FROM_R.args.games, tempsample: FROM_R.args.tempsample });
    process.exit(finish(null));
  }

  let server, browser;
  try { server = await serve(); }
  catch (e) { console.log('skipped: 无法启动本地静态服务 — ' + e.message); process.exit(2); }
  const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) process.exit(130);
    interrupted = true; log('\nSIGINT — writing partial report…');
    const code = finish(130);
    Promise.resolve(browser && browser.close()).catch(() => {}).finally(() => { server.close(); process.exit(code); });
  });
  try {
    // 前台页的行为：禁用后台节流（真人看着的标签页不会被节流）
    browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED,
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
    log(`browser_audit: ${GAMES} game(s)${TEMPSAMPLE ? ' + 1 tempSample game' : ''}, budget ${BUDGET}, seats [${SEATS}], engine ${gitHead ? gitHead.slice(0, 7) : '?'}, host loadavg ${os.loadavg().map(x => x.toFixed(2)).join(' ')} on ${os.cpus().length} cpus`);
    const plan = [];
    for (let i = 0; i < GAMES; i++) plan.push(false);
    if (TEMPSAMPLE) plan.push(true);
    for (let i = 0; i < plan.length && !interrupted; i++) {
      const rec = await playOne(browser, BASE, i + 1, plan[i], log);
      R.games.push(rec);
      log(`game ${rec.game}: ${rec.ok ? 'done in ' + fmtMs(rec.wallMs) + `, ${rec.decisions.length} role decisions` : 'FAILED — ' + rec.error}`);
    }
  } catch (e) {
    console.error('browser_audit error: ' + (e && e.stack || e));
    R.error = String(e && e.message || e);
  } finally {
    if (!interrupted) {
      await Promise.resolve(browser && browser.close()).catch(() => {});
      server.close();
      const code = finish(R.error ? 1 : null);
      process.exit(code);
    }
  }
})();
