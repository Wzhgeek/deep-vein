#!/usr/bin/env node
/* =====================================================================
 * 矿脉 Deep Vein — 自动截图
 *
 *   node tools/screenshot.js [场景名...]      # 不传就全拍
 *
 * 做三件事：
 *   1. 找到本机的 Chrome（macOS / Linux / CI 都认）
 *   2. 逐场景无头渲染 tools/shots.html#场景名 -> assets/screenshots/场景.png
 *   3. **校验每张图不是空白** —— 自带一个极小的 PNG 解码器，统计颜色数与亮度。
 *      只比较文件大小是不够的：一张纯色图也可能有好几 KB。
 * ===================================================================== */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets/screenshots');
const W = 640, H = 360;

const SCENES = [
  ['title', '标题页'],
  ['play', '对局中'],
  ['tutorial', '新手教学'],
  ['draft', '三选一词条'],
  ['shop', '词条研究'],
  ['ascension', '深渊天梯'],
  ['settle', '升井结算'],
  ['achievements', '成就'],
  ['deep', '深层精英矿'],
];

const { findChrome } = require('./chrome-path');

/* ---------- 极简 PNG 解码：只做"这张图有没有内容"的判断 ---------- */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let pos = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error('只支持 8 位深');
  if (interlace) throw new Error('不支持隔行扫描');
  const ch = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 0 ? 1 : 0;
  if (!ch) throw new Error('不支持的颜色类型 ' + ctype);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[rp++];
    const line = raw.slice(rp, rp + stride); rp += stride;
    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= ch) ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, ch, px: out };
}

/**
 * 统计图像内容。
 *
 * 判据不能只看"颜色数"：商店/深渊/成就这类**文字型界面**本来就只有几种颜色
 * （深色面板 + 一两档字色），颜色数少但内容完全正常。真正该测的是
 * **"有多少像素不是背景色"** —— 空白图的非背景像素接近于 0。
 */
function stats(img) {
  const hist = new Map();
  let sum = 0, n = 0;
  const px = [];
  for (let y = 0; y < img.h; y += 2) {
    for (let x = 0; x < img.w; x += 2) {
      const i = (y * img.w + x) * img.ch;
      const r = img.px[i], g = img.px[i + 1] || r, b = img.px[i + 2] || r;
      const key = (r >> 2 << 12) | (g >> 2 << 6) | (b >> 2);   // 量化到 64 级
      hist.set(key, (hist.get(key) || 0) + 1);
      px.push(key);            // 必须和 hist 的键同一套取值，否则比较永远不相等
      sum += (r * 0.299 + g * 0.587 + b * 0.114); n++;
    }
  }
  let mode = 0, modeN = 0;
  for (const [k, v] of hist) if (v > modeN) { modeN = v; mode = k; }
  // "墨水占比"：不是最常见颜色的像素比例
  let ink = 0;
  for (const k of px) if (k !== mode) ink++;
  return { colors: hist.size, brightness: sum / n, ink: ink / px.length, modeN: modeN / px.length };
}

/* ---------- 主流程 ---------- */
function main() {
  const want = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const list = want.length ? SCENES.filter(s => want.includes(s[0])) : SCENES;
  if (!list.length) { console.error('没有匹配的场景。可选：' + SCENES.map(s => s[0]).join(', ')); process.exit(1); }

  const chrome = findChrome();
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-shot-'));
  const page = 'file://' + path.join(ROOT, 'tools/shots.html');
  let bad = 0;

  console.log('Chrome: ' + chrome);
  console.log('输出:   assets/screenshots/\n');

  for (const [name, label] of list) {
    const out = path.join(OUT, name + '.png');
    try {
      execFileSync(chrome, [
        '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--user-data-dir=' + path.join(tmp, name),
        '--allow-file-access-from-files',
        '--window-size=' + W + ',' + H,
        '--virtual-time-budget=2500',
        '--screenshot=' + out,
        page + '#' + name,
      ], { stdio: 'ignore', timeout: 90000 });
    } catch (e) { /* Chrome 有时以非 0 退出但图已经写了 */ }

    if (!fs.existsSync(out)) { console.log('  ❌ ' + name.padEnd(13) + ' 没生成'); bad++; continue; }
    let st;
    try {
      const img = decodePng(fs.readFileSync(out));
      if (img.w !== W || img.h !== H) { console.log('  ❌ ' + name.padEnd(13) + ' 尺寸 ' + img.w + 'x' + img.h + '，应为 ' + W + 'x' + H); bad++; continue; }
      st = stats(img);
    } catch (e) { console.log('  ❌ ' + name.padEnd(13) + ' 解码失败: ' + e.message); bad++; continue; }

    // 空白 = 几乎全是同一种颜色（墨水占比接近 0）。文字型界面虽然颜色少，
    // 但每个字都是"非背景像素"，占比轻松超过 1%。
    const ok = st.ink >= 0.01 && st.brightness > 3;
    if (!ok) bad++;
    console.log('  ' + (ok ? '✅' : '❌') + ' ' + name.padEnd(13) + label.padEnd(7) +
      '  墨水占比 ' + (st.ink * 100).toFixed(1).padStart(5) + '%  颜色 ' + String(st.colors).padStart(4) +
      '  亮度 ' + st.brightness.toFixed(1).padStart(5) +
      '  ' + (fs.statSync(out).size / 1024).toFixed(1) + ' KB');
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }

  console.log('\n' + (bad ? '❌ ' + bad + ' 张有问题（可能是空白/尺寸不对/页面报错）' : '✅ ' + list.length + ' 张截图全部正常'));
  process.exit(bad ? 1 : 0);
}
main();
