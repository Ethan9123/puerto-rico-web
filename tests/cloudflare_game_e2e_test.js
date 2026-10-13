const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {findChrome} = require('./browser_runtime.js');
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
  try { await fetch(base + '/', {signal: AbortSignal.timeout(2000)}); }
  catch (e) { if (!process.env.ROOMS_TEST_BASE) { console.log('skipped: 本机房间服务未启动'); process.exit(2); } throw e; }
  const browser = await chromium.launch({executablePath});
  const contexts = [await browser.newContext(), await browser.newContext()];
  const [host, guest] = await Promise.all(contexts.map(c => c.newPage()));
  const errors = [];
  for (const p of [host, guest]) p.on('pageerror', e => errors.push(e.message));
  await contexts[0].addInitScript(() => { window._netGraceMs = 1500; window._netIdleMs = 180000; window._fastSpectator = true; });
  let reloadedGuest = false, reloadedHost = false, tookOver = false, actions = 0;
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
    await host.getByRole('button', {name: '▶ 开始对战（房主）', exact: true}).click();
    await fast(host);
    await until(() => guest.locator('#game-screen').isVisible());
    console.log('GAME: independent browser contexts created/joined the Cloudflare room');
    const deadline = Date.now() + 240000;
    let nextLog = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (await host.evaluate(() => !!G?.gameOver)) break;
      if (!reloadedGuest && await onClock(guest)) {
        await guest.reload();
        await until(() => guest.locator('#game-screen').isVisible());
        await until(() => onClock(guest));
        assert.equal(await guest.evaluate(() => PRNetPlay.mySeat()), 1);
        reloadedGuest = true;
        console.log('GAME: invitation reload recovered seat and pending input');
      }
      if (reloadedGuest && !reloadedHost && await host.evaluate(() => G.turnNumber >= 2)) {
        await host.reload();
        await until(() => host.evaluate(() => typeof G !== 'undefined' && !!G && PRNetPlay.role() === 'host' && !!G._resumed));
        await fast(host);
        reloadedHost = true;
        console.log('GAME: host reload recovered room and saved game');
      }
      if (reloadedHost && !tookOver && await onClock(guest)) {
        await guest.evaluate(() => PR_SESSION.close());
        await until(() => host.evaluate(() => !!G._takenOverSeats?.[1]));
        const originalToken = await guest.evaluate(() => PR_SESSION.token);
        await host.evaluate(() => saveGame());
        await host.reload();
        await until(() => host.evaluate(() => typeof G !== 'undefined' && !!G && PRNetPlay.role() === 'host' && !!G._resumed));
        await fast(host);
        assert.equal(await host.evaluate(() => PRNetPlay._debug()._seatTokens[1]), originalToken, 'original owner must survive host reload during takeover');
        await guest.reload();
        await until(() => guest.locator('#game-screen').isVisible());
        await until(() => host.evaluate(() => !G._takenOverSeats?.[1]));
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
  } catch (e) {
    fs.mkdirSync(artifacts, {recursive: true});
    await host.screenshot({path: path.join(artifacts, 'cloudflare-game-failure.png'), fullPage: true}).catch(() => {});
    throw e;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
