// tests/online_e2e_test.js — 联机端到端回归（真实浏览器）
//
// 为什么需要它：联机功能从 Phase 1 一路做到 3.1，却**从来没有被真实运行过**一次。
// 本测试用 Playwright 开真实 Chromium 走完整流程，把「写完了」和「能用」分开。
//
// 覆盖：
//   ① 页面加载、大厅渲染、无 console 报错
//   ② LocalTransport 全流程：建房 → 客人加入 → 双方在场列表互见 → 开局 → 客人拿到座位
//   ③ 联机会话中单机「开始游戏」被禁用（否则客人开的本地局会被房主广播覆盖）
//   ④ 频道订阅失败必须**有界地**失败（不是永久挂起）——这是本轮修掉的头号 bug
//
// 环境要求：playwright（devDependency）+ 预装 Chromium。缺任一 → 按项目约定
// `exit(2)` 且输出含 "skipped"（tools/run_tests.sh 只在两者同时满足时才算跳过）。
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = path.join(__dirname, '..');

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

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.log('skipped: playwright 未安装（npm i -D playwright）'); process.exit(2); }
const CHROME = findChrome();
if (!CHROME) { console.log('skipped: 找不到预装 Chromium（/opt/pw-browsers）'); process.exit(2); }

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css' };
const KV = new Map(); // 内存版 KV：与 worker/index.js 的 /game-save /game-load 同契约
function serve(port) {
  return new Promise((res, rej) => {
    const s = http.createServer((req, rq) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/game-save' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c); req.on('end', () => {
          try { const b = JSON.parse(body); if (!b.snap) KV.delete(b.id); else KV.set(b.id, b.snap); rq.writeHead(200, { 'Content-Type': 'application/json' }); rq.end('{"ok":true}'); }
          catch (e) { rq.writeHead(400); rq.end('{"ok":false}'); }
        }); return;
      }
      if (u.pathname === '/game-load' && req.method === 'GET') {
        rq.writeHead(200, { 'Content-Type': 'application/json' }); return rq.end(JSON.stringify({ ok: true, snap: KV.get(u.searchParams.get('id')) || null }));
      }
      const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
      const f = path.join(ROOT, rel);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rq.writeHead(404); return rq.end('nf'); }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rq);
    });
    s.on('error', rej);
    s.listen(port, () => res(s));
  });
}

let fails = 0;
const ok = (c, m) => { if (c) console.log('  ok ' + m); else { fails++; console.log('FAIL ' + m); } };

(async () => {
  let server;
  try { server = await serve(0); }
  catch (e) { console.log('skipped: 无法启动本地静态服务 — ' + e.message); process.exit(2); }
  const BASE = `http://127.0.0.1:${server.address().port}/index.html`;

  const browser = await chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext();
    // 把 supabase-config.js 拦成空 → hasSupabase() 假 → 走 LocalTransport。
    // ⚠ 不能用 addInitScript 设 null：init script 跑在页面脚本**之前**，会被 config 覆盖回去。
    await ctx.route('**/supabase-config.js', r =>
      r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* e2e: force local transport */' }));

    const errs = [];
    const wire = (p, tag) => {
      p.on('pageerror', e => errs.push(`[${tag}] ${String(e).slice(0, 120)}`));
      p.on('dialog', async d => { errs.push(`[${tag}] ALERT ${d.message().slice(0, 120)}`); await d.dismiss(); });
    };

    // ---- ① 加载 + 大厅 ----
    const host = await ctx.newPage(); wire(host, 'host');
    await host.goto(BASE, { waitUntil: 'load' });
    await host.waitForTimeout(800);
    ok(await host.locator('#lobby-panel').count() === 1, '① 大厅面板已渲染');
    ok(await host.evaluate(() => typeof PRNet !== 'undefined'), '① PRNet 已加载');
    ok(await host.evaluate(() => !PRNet.crossDevice()), '① 已切到 LocalTransport（本测试不依赖外网）');

    // ---- ② 建房 ----
    await host.locator('#lobby-panel button', { hasText: '创建房间' }).first().click();
    await host.waitForTimeout(2000);
    const code = ((await host.locator('#lobby-panel').innerText()).match(/\b([A-HJ-NP-Z2-9]{4})\b/) || [])[1];
    ok(!!code, `② 建房成功（房间码 ${code || '—'}）`);
    if (!code) throw new Error('建房失败，后续用例无法继续');

    // ---- ③ 客人加入 ----
    const guest = await ctx.newPage(); wire(guest, 'guest');
    await guest.goto(BASE, { waitUntil: 'load' });
    await guest.waitForTimeout(800);
    await guest.locator('#lobby-panel input').first().fill(code);
    await guest.locator('#lobby-panel button', { hasText: '加入' }).first().click();
    await guest.waitForTimeout(3000);
    ok(/离开房间/.test(await guest.locator('#lobby-panel').innerText()), '③ 客人加入成功');
    await host.waitForTimeout(1500);
    const hostList = await host.locator('#lobby-panel').innerText();
    ok(/房主/.test(hostList) && (hostList.match(/\d\.\s/g) || []).length >= 2, '③ 房主能看到两名在场玩家');

    // ---- ④ 联机中不得再开单机局（否则会被房主广播覆盖）----
    ok(await guest.locator('#btn-start').isDisabled(), '④ 客人侧单机「开始游戏」已禁用');
    ok(await host.locator('#btn-start').isDisabled(), '④ 房主侧单机「开始游戏」已禁用');

    // ---- ⑤ 开局 → 客人自动进入参战/观战 ----
    await host.locator('#lobby-panel button', { hasText: '开始对战' }).first().click();
    await host.waitForTimeout(4000);
    ok(await host.locator('#game-screen').isVisible(), '⑤ 房主进入对局');
    await guest.waitForTimeout(3000);
    const banner = await guest.locator('#spectate-banner').count()
      ? await guest.locator('#spectate-banner').innerText() : '';
    ok(/联机中/.test(banner), `⑤ 客人进入联机视图（${banner.slice(0, 60) || '无横幅'}）`);
    ok(/座位|观战/.test(banner), '⑤ 客人被告知自己的角色（参战座位或观战）');

    ok(errs.length === 0, `⑥ 全程无 pageerror / 弹窗${errs.length ? '：' + errs.slice(0, 3).join(' ; ') : ''}`);

    // ---- ⑨ 客人自己掉线要有感（此前横幅照旧「联机中」，棋盘只是不动）----
    const bannerOf = async (p) => (await p.locator('#spectate-banner').count()) ? await p.locator('#spectate-banner').innerText() : '';
    await ctx.setOffline(true);            // 触发 window 'offline'（LocalTransport 本身不受影响）
    await guest.waitForTimeout(600);
    const offB = await bannerOf(guest);
    ok(/掉线/.test(offB), `⑨ 断网后横幅变红并说明（${offB.slice(0, 50) || '无变化'}）`);
    await ctx.setOffline(false);
    await guest.waitForTimeout(600);
    const onB = await bannerOf(guest);
    ok(/联机中|重新连上/.test(onB) && !/掉线/.test(onB), `⑨ 恢复后横幅复原（${onB.slice(0, 50)}）`);

    // ---- ⑩ 房主刷新不再整局死：同码重开 + 取回存档 + 以房主身份续跑 ----
    // 此前：saveGame 对联机早退、建房不记 prnet_room、重连恒以 guest 身份 join → 引擎状态全没，
    // 客人永远卡在「房主已断线，等待重连」。
    const slotKey = await host.evaluate(() => Object.keys(localStorage).find(k => /:room:/.test(k)) || '');
    ok(!!slotKey, `⑩ 房主对局已写入按房间码的独立存档槽（${slotKey || '无'}）`);
    await host.reload({ waitUntil: 'load' });
    let backAsHost = false;
    for (let i = 0; i < 40; i++) {
      await host.waitForTimeout(500);
      backAsHost = await host.evaluate(() =>
        typeof PRNetPlay !== 'undefined' && PRNetPlay.role() === 'host' && PRNetPlay.isOnline() &&
        !!window.PR_SESSION && !document.getElementById('game-screen').classList.contains('hidden')).catch(() => false);
      if (backAsHost) break;
    }
    ok(backAsHost, '⑩ 刷新后以房主身份回到对局（引擎状态取回、远程出手层已接上）');
    ok(await host.evaluate(() => window.PR_SESSION && window.PR_SESSION.code) === code, '⑩ 重开的是同一个房间码');
    ok(await host.evaluate(() => !!(G && G._resumed && G._online && !G._spectator)), '⑩ G 来自存档且仍是联机房主局');
    await guest.waitForTimeout(8000);      // 等客人 presence 看到房主回来 + 收到新一帧
    const gB = await bannerOf(guest);
    ok(/联机中/.test(gB) && !/已断线/.test(gB), `⑩ 客人横幅不再卡在「房主已断线」（${gB.slice(0, 60)}）`);
    ok(await guest.evaluate(() => !document.getElementById('game-screen').classList.contains('hidden')), '⑩ 客人仍在对局画面');

    // ---- ⑧ presence 掉线有宽限期，不再一抖就被 AI 顶替；真掉线到期后才接管 ----
    // 用真实路径：关掉客人页 → LocalTransport 的 presence 条目 9s 后过期 → 房主 onPresence 少了该令牌
    // → 进宽限期（本测试设 6s）→ 到期仍不在 → aiTakeover。轮询记录中间态，断言「先宽限、后接管」。
    await host.evaluate(() => { window._netGraceMs = 6000; });
    const guestSeat = await host.evaluate(() => Object.keys(PRNetPlay.seatOwners())[0]);
    await guest.close();
    let sawGrace = false, taken = false;
    for (let i = 0; i < 90 && !taken; i++) {
      await host.waitForTimeout(500);
      const st = await host.evaluate((seat) => ({ pending: PRNetPlay._debug().lossPending, taken: !!PRNetPlay.takenOver()[seat] }), guestSeat);
      if (st.pending.length && !st.taken) sawGrace = true;
      taken = st.taken;
    }
    ok(sawGrace, '⑧ presence 丢失后先进入宽限期（未立即接管）');
    ok(taken, '⑧ 宽限期到期仍不在 → 专家 AI 接管该座位');

    // ---- ⑪ 单机存档路径不受联机改动影响（saveSlot 重构的回归护栏）----
    // 联机房主改用按房间码的独立槽后，单机仍必须写原来的 pr_save_v1、且设置页能给出「继续上一局」。
    // 同时断言单机局**不会**写出 :room: 槽——否则说明 saveSlot 把单机误判成联机。
    {
      const solo = await ctx.newPage(); wire(solo, 'solo');
      await solo.goto(BASE, { waitUntil: 'load' });
      await solo.waitForTimeout(800);
      await solo.evaluate(() => { try { sessionStorage.clear(); localStorage.removeItem('pr_save_v1'); } catch (e) {} });
      await solo.locator('#btn-start').click();
      await solo.waitForTimeout(3500);
      const keys = await solo.evaluate(() => Object.keys(localStorage));
      ok(keys.includes('pr_save_v1'), '⑪ 单机局写入原存档槽 pr_save_v1');
      ok(!keys.some(k => /^pr_save_v1:room:/.test(k) && k !== slotKey), '⑪ 单机局没有写出 :room: 槽（未被误判为联机）');
      await solo.reload({ waitUntil: 'load' });
      await solo.waitForTimeout(2500);
      ok(await solo.locator('#btn-resume').count() === 1, '⑪ 刷新后设置页出现「继续上一局」');
      await solo.close();
    }

    // ---- ⑦ 订阅失败必须有界（本轮修掉的头号 bug）----
    // 旧写法 `ch.subscribe(s => { if (s==="SUBSCRIBED") res(); })` 只处理成功一种状态，
    // CHANNEL_ERROR / TIMED_OUT / CLOSED 既不 resolve 也不 reject 且无超时 → 永久挂起、
    // 「创建房间」按钮永久变灰且零提示。实测退回旧写法：15 秒仍未落定；修复后 ~0.3 秒 reject。
    // 这里用一个必然连不通的 Supabase 端点，断言 host() 会在有限时间内失败而不是卡住。
    const probe = await ctx.newPage();
    await probe.route('**/supabase-config.js', r => r.fulfill({
      status: 200, contentType: 'application/javascript',
      body: 'window.PR_SUPABASE={url:"https://127.0.0.1:9",key:"sb_publishable_e2e_dummy"};',
    }));
    await probe.goto(BASE, { waitUntil: 'load' });
    await probe.waitForTimeout(800);
    ok(await probe.evaluate(() => PRNet.crossDevice()), '⑦ 探针已切到 Supabase 传输');
    const r = await probe.evaluate(async () => {
      const t0 = Date.now();
      const out = await Promise.race([
        PRNet.host({ name: 'probe', onPresence() {}, onMessage() {} })
          .then(() => ({ settled: true, kind: 'resolve' }))
          .catch(e => ({ settled: true, kind: 'reject', msg: String((e && e.message) || e) })),
        new Promise(res => setTimeout(() => res({ settled: false }), 20000)),
      ]);
      return Object.assign(out, { ms: Date.now() - t0 });
    });
    ok(r.settled, `⑦ 连不通时 host() 必须有界落定（实际 ${r.settled ? r.kind + ' @' + r.ms + 'ms' : '20 秒仍挂起'}）`);
    ok(r.settled && r.kind === 'reject' && r.msg && !/\[object/.test(r.msg),
      `⑦ 失败信息必须可读（实际："${(r.msg || '').slice(0, 60)}"）`);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(fails ? `\nONLINE E2E TEST FAILED: ${fails}` : '\nONLINE E2E TEST OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ONLINE E2E TEST ERROR:', e.message); process.exit(1); });
