const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {findChrome, assertRoomSite} = require('./browser_runtime.js');
let chromium;
try { ({chromium} = require('playwright')); } catch { console.log('skipped: playwright 未安装'); process.exit(2); }
const executablePath = findChrome(chromium);
if (!executablePath) { console.log('skipped: Chromium 未安装'); process.exit(2); }
const base = process.env.ROOMS_TEST_BASE || 'http://127.0.0.1:8898';
const artifacts = path.join(__dirname, 'artifacts');
const step = p => p.evaluate(() => {
  const modal = document.querySelector('#modal:not(.hidden)');
  const button = modal && [...modal.querySelectorAll('button')].find(b => !b.disabled && !/撤销/.test(b.textContent));
  if (button) { button.click(); return 'modal'; }
  const roles = [...document.querySelectorAll('.role-card')].filter(c => c.onclick);
  if (roles.length) { roles[Math.floor(Math.random() * roles.length)].click(); return 'role'; }
  const choice = document.querySelector('#game-screen .selectable');
  if (choice?.onclick) { choice.click(); return 'board'; }
  const skip = document.querySelector('#game-screen .skip-btn');
  if (skip?.onclick) { skip.click(); return 'skip'; }
  return null;
});
const fast = p => p.evaluate(() => {
  window._fastSpectator = true;
  sleep = () => Promise.resolve();
  window._aiThinkBudget = {L4: 30, L5: 30, hardIters: 10, hardMs: 30, expertIters: 20, expertMs: 40};
});
const onClock = p => p.locator('#np-guest-turn').count();
async function until(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (!await fn()) { if (Date.now() > end) throw new Error('condition timed out'); await new Promise(r => setTimeout(r, 100)); }
}
(async () => {
  try { await assertRoomSite(base); }
  catch (e) { if (!process.env.ROOMS_TEST_BASE) { console.log('skipped: 本机房间服务未启动'); process.exit(2); } throw e; }
  const browser = await chromium.launch({executablePath});
  const contexts = [await browser.newContext(), await browser.newContext()];
  const [host, guest] = await Promise.all(contexts.map(c => c.newPage()));
  const errors = [];
  for (const p of [host, guest]) p.on('pageerror', e => errors.push(e.message));
  await contexts[0].addInitScript(() => { window._netGraceMs = 1500; window._netIdleMs = 180000; window._fastSpectator = true; });
  let reloadedGuest = false, reloadedHost = false, tookOver = false, actions = 0, guestSeat;
  const randomSeats = process.env.ROOM_RANDOM_TEST === '1';
  try {
    await host.goto(base);
    await host.locator('#player-count').selectOption('3');
    await host.locator('#player-name').fill('房主测试');
    await host.locator('#live-cast').uncheck();
    await host.getByRole('button', {name: '创建房间', exact: true}).click();
    await host.locator('.lobby-code').waitFor({state: 'visible'});
    const code = await host.locator('.lobby-code').innerText();
    await guest.goto(base + '/?room=' + code);
    await guest.locator('#player-name').fill('客人测试');
    await guest.getByRole('button', {name: '加入', exact: true}).click();
    await guest.locator('.lobby-code').waitFor({state: 'visible'});
    await until(() => host.evaluate(() => PR_SESSION.presence().length === 2));
    await host.locator('#room-bots').selectOption('1');
    await host.getByRole('button', {name: '＋ 添加机器人', exact: true}).click();
    assert.equal(await host.locator('#room-bots').inputValue(), '2');
    await host.getByRole('button', {name: '− 移除机器人', exact: true}).click();
    assert.equal(await host.locator('#room-bots').inputValue(), '1');
    await host.locator('#room-bot-level').selectOption('3');
    if (randomSeats) {
      await host.locator('#room-random-seats').check();
      await host.evaluate(() => { const plan = PRRoomPlan; window.PRRoomPlan = args => plan(args, () => 0); });
    }
    await until(() => guest.locator('.room-settings').innerText().then(s => s.includes('2 位真人 + 1 个机器人（L3）')));
    fs.mkdirSync(artifacts, {recursive: true});
    await host.locator('#lobby-panel').screenshot({path: path.join(artifacts, 'room-settings.png')});
    await host.getByRole('button', {name: '▶ 开始对战（房主）', exact: true}).click();
    await fast(host);
    await until(() => guest.locator('#game-screen').isVisible());
    guestSeat = await guest.evaluate(() => PRNetPlay.mySeat());
    const setup = await host.evaluate(() => ({seat: PRNetPlay.mySeat(), hostSeat: G._hostSeat, bots: G.players.filter(p => !p.isHuman).map(p => p._aiLevel)}));
    assert.deepEqual(setup.bots, [3]);
    assert.equal(setup.seat, setup.hostSeat);
    if (randomSeats) { assert.equal(setup.hostSeat, 2); assert.equal(guestSeat, 0); }
    console.log('GAME: independent browser contexts created/joined the Cloudflare room');
    const deadline = Date.now() + 240000;
    let nextLog = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await host.evaluate(() => !!G?.gameOver)) break;
      if (!reloadedGuest && await onClock(guest)) {
        await guest.reload();
        await until(() => guest.locator('#game-screen').isVisible());
        await until(() => onClock(guest));
        assert.equal(await guest.evaluate(() => PRNetPlay.mySeat()), guestSeat);
        reloadedGuest = true;
        console.log('GAME: invitation reload recovered seat and pending input');
      }
      if (reloadedGuest && !reloadedHost && await host.evaluate(() => G.turnNumber >= 2)) {
        await host.reload();
        await until(() => host.evaluate(() => typeof G !== 'undefined' && !!G && PRNetPlay.role() === 'host' && !!G._resumed));
        await fast(host);
        assert.equal(await host.evaluate(() => PRNetPlay.mySeat()), setup.hostSeat);
        reloadedHost = true;
        console.log('GAME: host reload recovered room and saved game');
      }
      if (reloadedHost && !tookOver && await onClock(guest)) {
        await guest.evaluate(() => PR_SESSION.close());
        await until(() => host.evaluate(seat => !!G._takenOverSeats?.[seat], guestSeat));
        const originalToken = await guest.evaluate(() => PR_SESSION.token);
        await host.evaluate(() => saveGame());
        await host.reload();
        await until(() => host.evaluate(() => typeof G !== 'undefined' && !!G && PRNetPlay.role() === 'host' && !!G._resumed));
        await fast(host);
        assert.equal(await host.evaluate(seat => PRNetPlay._debug()._seatTokens[seat], guestSeat), originalToken, 'original owner must survive host reload during takeover');
        await guest.reload();
        await until(() => guest.locator('#game-screen').isVisible());
        await until(() => host.evaluate(seat => !G._takenOverSeats?.[seat], guestSeat));
        tookOver = true;
        console.log('GAME: disconnected guest replaced by AI, then reclaimed original seat');
      }
      for (const p of [host, guest]) if (await step(p)) actions++;
      if (errors.length) throw new Error(errors.join('\n'));
      if (Date.now() > nextLog) { console.log('GAME progress:', await host.evaluate(() => ({round: G.turnNumber, actions: G.log.length})), 'UI actions', actions); nextLog = Date.now() + 20000; }
      await new Promise(r => setTimeout(r, 40));
    }
    assert.equal(await host.evaluate(() => G.gameOver), true, 'game must reach a normal end');
    await until(() => guest.evaluate(() => !!G?.gameOver));
    const scores = p => p.evaluate(() => G.players.map(x => x.vp + x.buildings.reduce((s, b) => s + BLD_BY_ID[b.bid].vp, 0) + G.getSpecialVPs(x)));
    assert.deepEqual(await scores(guest), await scores(host));
    assert.ok(reloadedGuest && reloadedHost && tookOver);
    assert.equal(errors.length, 0);
    fs.mkdirSync(artifacts, {recursive: true});
    await guest.screenshot({path: path.join(artifacts, 'cloudflare-game-complete.png'), fullPage: true});
    console.log('CLOUDFLARE GAME E2E OK:', {actions, scores: await scores(host), reloadedGuest, reloadedHost, tookOver});
    if (process.env.ROOM_TEST_FINISH === '1') {
      for (const p of [guest, host]) {
        await p.getByRole('button', {name: '返回大厅', exact: true}).click();
        await p.getByRole('button', {name: '创建房间', exact: true}).waitFor({state: 'visible'});
        assert.equal(new URL(p.url()).searchParams.has('room'), false);
        assert.equal(await p.evaluate(() => sessionStorage.getItem('prnet_room')), null);
        assert.equal(await p.locator('#game-screen').isVisible(), false);
      }
      await host.getByRole('button', {name: '创建房间', exact: true}).click();
      await host.locator('.lobby-code').waitFor({state: 'visible'});
      const nextCode = await host.locator('.lobby-code').innerText();
      assert.notEqual(nextCode, code);
      await guest.locator('.lobby-join-code').fill(nextCode);
      await guest.getByRole('button', {name: '加入', exact: true}).click();
      await until(() => host.evaluate(() => PR_SESSION.presence().length === 2));
      console.log('GAME FINISH E2E OK: both players returned to lobby and joined a fresh room');
    }
  } catch (e) {
    fs.mkdirSync(artifacts, {recursive: true});
    await host.screenshot({path: path.join(artifacts, 'cloudflare-game-failure.png'), fullPage: true}).catch(() => {});
    throw e;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
