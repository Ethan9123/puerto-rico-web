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
module.exports = {findChrome};
