#!/usr/bin/env node
/* =====================================================================
 * 跑 tools/browser-smoke.html 的全套断言，并把结果变成退出码。
 * 本地和 CI 用同一条命令： node tools/smoke.js
 * ===================================================================== */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const { execFileSync } = require('child_process');
const { findChrome } = require('./chrome-path');

const ROOT = path.join(__dirname, '..');
const chrome = findChrome();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-smoke-'));
const url = 'file://' + path.join(ROOT, 'tools/browser-smoke.html');

let dom = '';
try {
  dom = execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--user-data-dir=' + tmp, '--allow-file-access-from-files',
    '--virtual-time-budget=20000', '--dump-dom', url,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000 });
} catch (e) {
  dom = (e.stdout || '') + (e.stderr || '');
}
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }

const m = dom.match(/<pre id="out">([\s\S]*?)<\/pre>/);
if (!m) { console.error('❌ 没拿到断言输出（页面可能崩了）'); process.exit(1); }
const text = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
console.log(text.trim());

const failed = /❌/.test(text);
const done = /SMOKE_DONE/.test(text);
console.log('\n' + (done && !failed ? '✅ 浏览器断言全部通过' : '❌ 有断言失败或没跑完'));
process.exit(done && !failed ? 0 : 1);
