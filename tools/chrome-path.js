/* 三平台通用的 Chrome 查找（本地 macOS 与 CI 的 ubuntu 都能认） */
'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

function findChrome() {
  const cands = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) { } }
  for (const n of ['google-chrome', 'chromium', 'chrome']) {
    try { return execFileSync('which', [n], { encoding: 'utf8' }).trim(); } catch (e) { }
  }
  throw new Error('找不到 Chrome，请用 CHROME=/path/to/chrome 指定');
}
module.exports = { findChrome };
