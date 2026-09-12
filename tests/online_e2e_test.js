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
    await host.addInitScript(() => { window._netIdleMs = 90000; });   // ⑬：让请求带非默认的 deadline；reload 后仍生效
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
    // 房主自动应答一步：优先确认弹窗 → 角色卡（偏好探矿者：无人决策、阶段即刻结束）→ 任意可点选项。
    // 页内 el.click()：不依赖视口坐标（手机布局下角色卡在折叠区也能点），返回是否有动作。
    const hostStep = (p) => p.evaluate(() => {
      const btn = [...document.querySelectorAll('.modal-box button')].find(b => !/撤销/.test(b.textContent));
      if (btn) { btn.click(); return 'modal:' + btn.textContent.trim().slice(0, 8); }
      const cards = [...document.querySelectorAll('.role-card')].filter(c => c.onclick);
      if (cards.length) { const c = cards.find(x => /role-Prospector/.test(x.className)) || cards[0]; c.click(); return 'role:' + c.className.replace('role-card', '').trim(); }
      // 棋盘上可选项统一带 .selectable + onclick（种植园池/采石场/建筑卡…）；只在对局页内找，
      // 绝不碰 topbar（规则/教程/**重开**）与隐藏的设置页/大厅按钮。
      const sel = document.querySelector('#game-screen .selectable');
      if (sel && sel.onclick) { sel.click(); return 'choice:' + String(sel.className).slice(0, 24); }
      const skip = document.querySelector('#game-screen #action-bar .skip-btn, #game-screen .skip-btn');
      if (skip && skip.onclick) { skip.click(); return 'skip'; }
      return null;
    });
    // 推进直到 cond(guestPage) 为真；房主有决策就答，客人若也在钟上（旧请求）则由 answerGuest 决定要不要答。
    const advanceUntil = async (hostP, guestP, cond, { answerGuest = false, ticks = 80 } = {}) => {
      const trace = [];
      for (let i = 0; i < ticks; i++) {
        if (await cond(guestP)) return trace;
        const a = await hostStep(hostP); if (a) trace.push('H:' + a);
        if (answerGuest) { const b = await hostStep(guestP); if (b) trace.push('G:' + b); }
        await hostP.waitForTimeout(500);
      }
      return trace;
    };
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

    // ---- ⑫ 客人看到的「轮到谁」与提示文字 == 快照的 _actingSeat ----
    // 此前两处叠加：① _currentPlayer 只在选角色时更新，阶段内子决策只设 _actingSeat → 客人整个阶段都高亮着选角色的人；
    // ② PRSpectate.applyState **没有导出**，netplay 的「先套最新状态再开 UI」从未执行 → 客人在旧棋盘上做决策，
    //    房主重连后横幅还卡在「房主正在重连…」。总督随机（game.js:427），这里不假设谁先手。
    // 需要一个在 _netIdleMs=90s 之下发出的请求：host 页 addInitScript 已在每次导航前设好（⑩ 的 reload 也保住）。
    const guestOnClock = async (gp) => (await gp.locator('#np-guest-turn').count()) > 0
      && (await gp.evaluate(() => parseInt((document.querySelector('.np-guest-cd') || {}).textContent || '999'))) <= 90;
    const tr12 = await advanceUntil(host, guest, guestOnClock, { answerGuest: true });
    ok(await guestOnClock(guest), `⑫ 推进到客人上钟（新请求，倒计时 ≤ 90s）；驱动轨迹：${tr12.slice(-6).join(' ')}`);
    const gSeat = await guest.evaluate(() => PRNetPlay.mySeat());
    const snapAct = await guest.evaluate(() => G._actingSeat);
    ok(snapAct === gSeat, `⑫ 客人 G 的行动座位就是自己的座位（${snapAct} == ${gSeat}）——请求附带的快照真的被套进来了`);
    const hiIdx = await guest.evaluate(() => [...document.querySelectorAll('.player-board')].findIndex(d => d.classList.contains('current')));
    ok(hiIdx === gSeat, `⑫ 客人棋盘高亮的是行动座位（高亮 ${hiIdx}，行动 ${gSeat}）`);
    const gB12 = await bannerOf(guest);
    ok(/轮到你了/.test(gB12), `⑫ 客人横幅写明轮到自己（…${gB12.slice(-24)}）`);
    ok(!/正在重连|已断线/.test(gB12), `⑫ 房主重连后客人横幅不再卡在「正在重连」（…${gB12.slice(-30)}）`);
    // 提示文字：客人本地 UI 会盖上自己的提示，所以看**房主快照**里路由前写入的那条。
    const hs = await host.evaluate(() => { const s = PRSpectate.snapshot(); return { act: s._actingSeat, prompt: s._currentPrompt, kinds: PRNetPlay._debug().pendingKinds }; });
    ok(hs.act === gSeat && !!hs.prompt, `⑫ 房主快照：行动座位 ${hs.act}、提示「${hs.prompt}」（路由前已写入，不再是上一条）`);
    if (/pickRole/.test(String(hs.kinds))) ok(/选择角色/.test(hs.prompt) && !/点击角色卡/.test(hs.prompt), `⑫ 选角路由时提示是「<名> 选择角色」而非房主自己那条（"${hs.prompt}"）`);
    // ⑫-b 提示前置（确定性）：把 maybeRoute 打桩成「路由出去」，直接调三个输入原语，
    // 断言 _currentPrompt 在路由**之前**就写好了。流程里路由到的决策与房主上一条提示可能同文，判别不了，故单测。
    const hoist = await host.evaluate(async () => {
      const orig = PRNetPlay.maybeRoute, out = {};
      PRNetPlay.maybeRoute = () => Promise.resolve(0);           // 假装该座位是远程客人
      try {
        humanBoardSelect({ type: 'plantation', choices: [], promptText: 'E2E-PROMPT-BS', allowSkip: false }); out.bs = G._currentPrompt;
        humanPickFromList('E2E-PROMPT-PL', ['a', 'b'], false);   out.pl = G._currentPrompt;
        humanPickRole([G.roleCards[0]], G.players[0]);           out.pr = G._currentPrompt;
      } finally { PRNetPlay.maybeRoute = orig; }
      return out;
    });
    ok(hoist.bs === 'E2E-PROMPT-BS', `⑫-b boardSelect：路由前已写入提示（"${hoist.bs}"）`);
    ok(hoist.pl === 'E2E-PROMPT-PL', `⑫-b pickFromList：路由前已写入提示（"${hoist.pl}"）`);
    ok(/选择角色/.test(hoist.pr || '') && !/点击角色卡/.test(hoist.pr || ''), `⑫-b pickRole：路由前已写入「<名> 选择角色」（"${hoist.pr}"）`);
    // 判别用例：高亮规则本身——_actingSeat ≠ _currentPlayer 时须按 _actingSeat；单机路径不受影响
    const rule = await guest.evaluate(() => {
      const idx = () => [...document.querySelectorAll('.player-board')].findIndex(d => d.classList.contains('current'));
      const s0 = { on: G._online, act: G._actingSeat, cur: G._currentPlayer };
      G._online = true; G._actingSeat = 2; G._currentPlayer = 0; render(); const online = idx();
      G._online = false; render(); const solo = idx();
      G._online = s0.on; G._actingSeat = s0.act; G._currentPlayer = s0.cur; render();
      return { online, solo };
    });
    ok(rule.online === 2, `⑫ 联机：_actingSeat(2) ≠ _currentPlayer(0) 时高亮行动座位（实际 ${rule.online}）`);
    ok(rule.solo === 0, `⑫ 单机：仍按 _currentPlayer 高亮（实际 ${rule.solo}）——渲染规则以 G._online 为门`);

    // ---- ⑬ 被计时的人看得到计时；轮到你有通知 ----
    // 此前 deadline 只存在房主的 _pending 里；客人零通知，切到后台就在 3 分钟引信上。
    const turnEl = (await guest.locator('#np-guest-turn').count()) ? await guest.locator('#np-guest-turn').innerText() : '';
    ok(/秒内出手/.test(turnEl), `⑬ 提示条带倒计时（请求随附 deadline）："${turnEl.slice(0, 44)}"`);
    const cd = await guest.evaluate(() => parseInt((document.querySelector('.np-guest-cd') || {}).textContent || '0'));
    ok(cd > 0 && cd <= 90, `⑬ 倒计时来自 deadline 且 ≤ idleMs（${cd}s）`);
    let flashed = false;
    for (let i = 0; i < 6; i++) { await guest.waitForTimeout(400); if (/轮到你了/.test(await guest.title())) { flashed = true; break; } }
    ok(flashed, '⑬ 标题栏闪烁「轮到你了」（切到后台也看得见）');
    // 房主侧倒计时跟随请求的 deadline（_netIdleMs=90s）。注：浮层标记里的初始数字在 showOverlay 的同一同步调用里
    // 就被 _updateCountdown 覆盖（pending 尚未建立时写「—」），从未渲染——所以「写死 180」改成 idleMs() 只是一致性整理，
    // 没有可观察行为，这里不为它立断言（反向验证 R6 因此不成立，见 PR 说明）。
    await host.waitForTimeout(1200);
    const hostCd = await host.evaluate(() => (document.getElementById('np-countdown') || {}).textContent || '');
    ok(/^\d+$/.test(hostCd) && +hostCd > 0 && +hostCd <= 90, `⑬ 房主浮层倒计时跟随请求的 90s deadline（显示 ${hostCd}）`);

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

    // ---- ⑰ 手机视口：横幅不盖 topbar；触控目标 ≥ 44px ----
    // 此前 `#spectate-banner + #app` 永不匹配（横幅 append 在 #app 之后），幸存的 :has 规则把 padding 从 16 减到 4
    // → 横幅盖住整个 topbar；认领/接管按钮只有 ~25–28px 高，不在触控块里。
    {
      const mctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await mctx.route('**/supabase-config.js', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* e2e */' }));
      const mh = await mctx.newPage(); wire(mh, 'm-host');
      await mh.goto(BASE, { waitUntil: 'load' }); await mh.waitForTimeout(800);
      ok(await mh.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), '⑰ 触控媒体查询在移动端仿真下生效（否则下面测的不是那条规则）');
      await mh.locator('#lobby-panel button', { hasText: '创建房间' }).first().click(); await mh.waitForTimeout(1500);
      const mcode = ((await mh.locator('#lobby-panel').innerText()).match(/\b([A-HJ-NP-Z2-9]{4})\b/) || [])[1];
      const mg = await mctx.newPage(); wire(mg, 'm-guest');
      await mg.goto(BASE, { waitUntil: 'load' }); await mg.waitForTimeout(800);
      await mg.locator('#lobby-panel input').first().fill(mcode);
      await mg.locator('#lobby-panel button', { hasText: '加入' }).first().click(); await mg.waitForTimeout(2500);
      await mh.locator('#lobby-panel button', { hasText: '开始对战' }).first().click(); await mh.waitForTimeout(3500);
      await mg.waitForTimeout(2500);
      const boxes = await mg.evaluate(() => {
        const r = s => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
        return { banner: r('#spectate-banner'), topbar: r('#topbar'), pad: getComputedStyle(document.getElementById('game-screen')).paddingTop };
      });
      ok(!!boxes.banner && !!boxes.topbar, '⑰ 手机视口下横幅与 topbar 都已渲染');
      ok(!!boxes.banner && !!boxes.topbar && boxes.banner.bottom <= boxes.topbar.top + 0.5,
        `⑰ 横幅不盖 topbar（banner.bottom=${boxes.banner ? boxes.banner.bottom.toFixed(0) : '?'} ≤ topbar.top=${boxes.topbar ? boxes.topbar.top.toFixed(0) : '?'}；#game-screen padding-top=${boxes.pad}）`);
      await advanceUntil(mh, mg, async (gp) => (await gp.locator('#np-guest-turn').count()) > 0, { ticks: 60 });
      const ovH = await mh.evaluate(() => { const b = document.querySelector('#netplay-overlay.show .np-takeover'); return b ? b.getBoundingClientRect().height : 0; });
      ok(ovH >= 44, `⑰ 房主「立即让 AI 接管」按钮触控高度 ≥ 44px（实际 ${ovH.toFixed(0)}）`);
      const nrH = await mg.evaluate(() => { const d = document.createElement('div'); d.id = 'netplay-reclaim'; d.innerHTML = '<button class="nr-btn">认领座位</button>'; document.body.appendChild(d); const h = d.querySelector('.nr-btn').getBoundingClientRect().height; d.remove(); return h; });
      ok(nrH >= 44, `⑰ 「认领座位」按钮触控高度 ≥ 44px（实际 ${nrH.toFixed(0)}）`);
      await mctx.close();
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
