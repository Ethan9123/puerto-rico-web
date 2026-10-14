const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {findChrome} = require('./browser_runtime.js');
let chromium;
try { ({chromium} = require('playwright')); } catch { console.log('skipped: playwright 未安装'); process.exit(2); }
const executablePath = findChrome(chromium);
if (!executablePath) { console.log('skipped: Chromium 未安装'); process.exit(2); }
const base = process.env.ROOMS_TEST_BASE || 'http://127.0.0.1:8898';
async function until(fn) {
  const deadline = Date.now() + 20000;
  while (!await fn()) { if (Date.now() > deadline) throw new Error('lobby condition timed out'); await new Promise(r => setTimeout(r, 100)); }
}
(async () => {
  try { await fetch(base, {signal: AbortSignal.timeout(2000)}); }
  catch (e) { if (!process.env.ROOMS_TEST_BASE) { console.log('skipped: 本机房间服务未启动'); process.exit(2); } throw e; }
  const browser = await chromium.launch({executablePath});
  const hostContext = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage(), guest = await guestContext.newPage();
  const errors = [];
  for (const page of [host, guest]) page.on('pageerror', e => errors.push(e.message));
  const start = host.locator('.lobby-start-btn');
  let releaseConnect;
  try {
    await host.goto(base);
    await host.locator('#player-name').fill('等候室房主');
    const held = new Promise(r => { releaseConnect = r; });
    await host.route('**/rooms/*/connect', async route => { await held; await route.continue(); });
    await host.getByRole('button', {name: '创建房间', exact: true}).click();
    assert.ok(await host.getByRole('button', {name: '加入', exact: true}).isDisabled());
    assert.ok(await host.locator('#btn-start').isDisabled());
    releaseConnect();
    await host.locator('.lobby-code').waitFor({state: 'visible'});
    await host.unroute('**/rooms/*/connect');
    let code = await host.locator('.lobby-code').innerText();
    await host.locator('#room-bots').selectOption('0');
    assert.ok(await start.isDisabled());
    assert.match(await host.locator('.room-readiness').innerText(), /还需要/);
    assert.ok(await host.getByRole('button', {name: '− 移除机器人', exact: true}).isDisabled());
    assert.ok(await host.locator('#room-bot-level').isDisabled());
    await host.getByRole('button', {name: '＋ 添加机器人', exact: true}).click();
    assert.ok(await start.isEnabled());
    assert.equal(await host.locator('.lobby-bot').count(), 1);
    await host.locator('#player-count').selectOption('5');
    await host.locator('#room-bots').selectOption('auto');
    await host.locator('#room-random-seats').check();
    assert.equal(await host.locator('.lobby-bot').count(), 4);
    assert.ok(await host.getByRole('button', {name: '＋ 添加机器人', exact: true}).isDisabled());
    await host.reload();
    await host.locator('.lobby-code').waitFor({state: 'visible'});
    assert.equal(await host.locator('#player-name').inputValue(), '等候室房主');
    assert.equal(await host.locator('#player-count').inputValue(), '5');
    assert.equal(await host.locator('#room-bots').inputValue(), 'auto');
    assert.ok(await host.locator('#room-random-seats').isChecked());
    assert.equal(await host.locator('.lobby-bot').count(), 4);

    await guest.goto(base + '/?room=' + code);
    await guest.locator('#player-name').fill('键盘加入');
    await guest.locator('.lobby-join-code').press('Enter');
    await guest.locator('.lobby-code').waitFor({state: 'visible'});
    await until(() => guest.locator('.lobby-bot').count().then(n => n === 3));
    await until(() => host.locator('.lobby-bot').count().then(n => n === 3));
    assert.ok(await host.locator('#room-bots option[value="4"]').evaluate(option => option.disabled), 'four robots cannot fit alongside two humans');
    assert.match(await guest.locator('.lobby-guest-wait').innerText(), /轮到你/);
    assert.ok(!(await guest.locator('.lobby-guest-wait').innerText()).includes('<b>'));
    await host.locator('#room-bots').selectOption('3');
    const extras = [];
    for (let i = 0; i < 4; i++) {
      const res = await fetch(base + '/rooms/' + code + '/connect', {method: 'POST', body: JSON.stringify({meta: {role: 'guest', name: '额外玩家', clientId: 'extra' + i}})});
      assert.equal(res.status, 200);
      extras.push(await res.json());
    }
    await until(() => host.locator('.room-readiness').innerText().then(s => s.includes('真人超过 5 位')));
    assert.ok(await start.isDisabled());
    for (const extra of extras) await fetch(base + '/rooms/' + code + '/leave', {method: 'POST', body: JSON.stringify({auth: extra.auth})});
    await until(() => start.isEnabled());

    let blockPoll = true;
    await host.route('**/rooms/*/poll?*', route => blockPoll ? route.abort('connectionfailed') : route.continue());
    await hostContext.setOffline(true);
    await until(() => host.locator('.lobby-connection').innerText().then(s => s.includes('断开')));
    assert.ok(await start.isDisabled());
    await hostContext.setOffline(false);
    await until(() => host.locator('.lobby-connection').innerText().then(s => s.includes('重连')));
    assert.ok(await start.isDisabled(), 'browser online must not enable start before server confirmation');
    blockPoll = false;
    await until(() => host.locator('.lobby-connection').innerText().then(s => s.includes('已连接')));
    assert.ok(await start.isEnabled());
    await host.unroute('**/rooms/*/poll?*');
    for (const size of [320, 375, 390]) {
      await host.setViewportSize({width: size, height: 844});
      const width = await host.evaluate(() => ({page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth}));
      assert.equal(width.viewport, size);
      assert.ok(width.page <= width.viewport, `mobile waiting room must not overflow horizontally (${JSON.stringify(width)})`);
    }
    fs.mkdirSync(path.join(__dirname, 'artifacts'), {recursive: true});
    await host.evaluate(() => document.querySelector('#toast-stack')?.replaceChildren());
    await host.locator('#lobby-panel').screenshot({path: path.join(__dirname, 'artifacts', 'room-lobby-mobile.png')});

    await guest.getByRole('button', {name: '离开房间', exact: true}).click();
    await host.getByRole('button', {name: '离开房间', exact: true}).click();
    await host.getByRole('button', {name: '创建房间', exact: true}).click();
    await host.locator('.lobby-code').waitFor({state: 'visible'});
    code = await host.locator('.lobby-code').innerText();
    await guest.locator('.lobby-join-code').fill(code);
    await guest.locator('.lobby-join-code').press('Enter');
    await until(() => guest.locator('.room-settings').innerText().then(s => s.includes('2 位真人 + 3 个机器人')));
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('ROOM LOBBY E2E OK: mobile layout, capacity, bot roster, keyboard join, refresh persistence, verified reconnect, new room settings');
  } finally { releaseConnect?.(); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
