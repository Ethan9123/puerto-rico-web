const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function findChrome(chromium) {
  const candidates = [process.env.CHROME_PATH, chromium.executablePath(),
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'];
  const roots = ['/opt/pw-browsers', path.join(os.homedir(), 'AppData/Local/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')];
  for (const root of roots) if (fs.existsSync(root)) {
    for (const dir of fs.readdirSync(root)) {
      for (const suffix of ['chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-linux64/chrome']) candidates.push(path.join(root, dir, suffix));
    }
  }
  return candidates.find(p => p && fs.existsSync(p));
}
async function assertRoomSite(base) {
  const res = await fetch(base, {signal: AbortSignal.timeout(15000)});
  if (new URL(res.url).hostname.endsWith('.cloudflareaccess.com')) throw new Error('游戏被 Cloudflare Access 登录拦截，朋友无法直接访问');
  if (!res.ok || !(await res.text()).includes('room-transport.js')) throw new Error('游戏页面未正常加载（HTTP ' + res.status + '）');
}
module.exports = {findChrome, assertRoomSite};
