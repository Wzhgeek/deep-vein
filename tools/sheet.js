/* =====================================================================
 * 矿脉 Deep Vein — 素材表 / 效果图导出
 * 用法: node tools/sheet.js
 * 产出: assets/ores-sheet.png   (8x8 精灵表，8 倍放大，可直接拿去做素材)
 *       assets/mock-board.png   (用真实渲染代码画的盘面效果预览)
 * 关键点: 用一个"假 canvas"喂给真实的 art.js，所以导出的图与实际游戏渲染一致。
 * ===================================================================== */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets');
fs.mkdirSync(OUT, { recursive: true });

/* ---------------- 极简 PNG 编码器（zlib 内置，无第三方依赖） ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}

/* ---------------- 假 canvas：让真实渲染代码能在 Node 里跑 ---------------- */
function hex2rgb(h) {
  if (h[0] === '#') return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
  return [255, 0, 255, 255];
}
function makeCanvas(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  const ctx = {
    _w: w, _h: h, _buf: buf, fillStyle: '#000000', globalAlpha: 1, _stack: [],
    save() { this._stack.push([this.fillStyle, this.globalAlpha]); },
    restore() { const s = this._stack.pop(); if (s) { this.fillStyle = s[0]; this.globalAlpha = s[1]; } },
    clearRect(x, y, ww, hh) { this.fillStyle = '#000000'; this.globalAlpha = 0; this.fillRect(x, y, ww, hh); this.globalAlpha = 1; },
    fillRect(x, y, ww, hh) {
      const [r, g, b, a] = hex2rgb(this.fillStyle);
      const al = (a / 255) * this.globalAlpha;
      x = Math.round(x); y = Math.round(y); ww = Math.round(ww); hh = Math.round(hh);
      for (let yy = y; yy < y + hh; yy++) {
        if (yy < 0 || yy >= this._h) continue;
        for (let xx = x; xx < x + ww; xx++) {
          if (xx < 0 || xx >= this._w) continue;
          const i = (yy * this._w + xx) * 4;
          if (al >= 0.999) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; }
          else { buf[i] = Math.round(buf[i] * (1 - al) + r * al); buf[i + 1] = Math.round(buf[i + 1] * (1 - al) + g * al); buf[i + 2] = Math.round(buf[i + 2] * (1 - al) + b * al); buf[i + 3] = 255; }
        }
      }
    },
    strokeRect() { }, beginPath() { }, fill() { }, arc() { }, fillText() { }, drawImage() { }
  };
  return { ctx, buf, w, h };
}
/** 整数倍放大（最近邻），保持像素锐利 */
function upscale(cv, k) {
  const out = Buffer.alloc(cv.w * k * cv.h * k * 4);
  for (let y = 0; y < cv.h * k; y++) for (let x = 0; x < cv.w * k; x++) {
    const si = (Math.floor(y / k) * cv.w + Math.floor(x / k)) * 4, di = (y * cv.w * k + x) * 4;
    out[di] = cv.buf[si]; out[di + 1] = cv.buf[si + 1]; out[di + 2] = cv.buf[si + 2]; out[di + 3] = 255;
  }
  return { buf: out, w: cv.w * k, h: cv.h * k };
}

/* ---------------- 载入真实素材代码 ---------------- */
const sandbox = { console, Math, JSON, Number, Array, Object, String, Boolean };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/art.js'), 'utf8'), sandbox, { filename: 'art.js' });
const A = sandbox.VeinArt;

/* ---------------- 1. 精灵表 ---------------- */
const items = [];
for (let i = 0; i < 5; i++) items.push([A.ORE_STYLE[i].shape, A.ORE_STYLE[i].pal]);
for (const k of [1, 2, 3, 4, 5, 6, 7, 8]) items.push([A.HAZARD_STYLE[k].shape, A.HAZARD_STYLE[k].pal]);
items.push(['miner', 'steel']);

const CELL = 64, GAP = 12, PAD = 16, COLS = 6;
const rows = Math.ceil(items.length / COLS);
const SW = PAD * 2 + COLS * CELL + (COLS - 1) * GAP;
const SH = PAD * 2 + rows * CELL + (rows - 1) * GAP;
const sheet = makeCanvas(SW, SH);
sheet.ctx.fillStyle = '#0b0d14'; sheet.ctx.fillRect(0, 0, SW, SH);
items.forEach((it, i) => {
  const cx = PAD + (i % COLS) * (CELL + GAP), cy = PAD + Math.floor(i / COLS) * (CELL + GAP);
  sheet.ctx.fillStyle = '#191d2a'; sheet.ctx.fillRect(cx, cy, CELL, CELL);
  A.drawSprite(sheet.ctx, it[0], it[1], cx, cy, 8);
});
const sheetBig = upscale(sheet, 2);
writePng(path.join(OUT, 'ores-sheet.png'), sheetBig.w, sheetBig.h, sheetBig.buf);
console.log('✓ assets/ores-sheet.png  ' + sheetBig.w + 'x' + sheetBig.h + '  (' + items.length + ' 个精灵)');

/* ---------------- 2. 盘面效果预览（用真实 drawSprite 渲染） ---------------- */
const TILE = 24, COLS_B = 7, ROWS_B = 9, HUD = 40, PADX = 16;
const BW = PADX * 2 + COLS_B * TILE;
const BH = HUD + ROWS_B * TILE + 16;
const mock = makeCanvas(BW, BH);
const hash2 = (x, y) => { let h = x * 374761393 + y * 668265263; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };

// 背景：岩层
mock.ctx.fillStyle = '#15100e'; mock.ctx.fillRect(0, 0, BW, BH);
// HUD
mock.ctx.fillStyle = '#0b0d14'; mock.ctx.fillRect(0, 0, BW, HUD);
mock.ctx.fillStyle = '#2a3140'; mock.ctx.fillRect(0, HUD - 2, BW, 2);
// 平巷（矿道入口横梁）
mock.ctx.fillStyle = '#0a0c12'; mock.ctx.fillRect(PADX, HUD, COLS_B * TILE, TILE * 0.6);
mock.ctx.fillStyle = '#4a3520'; mock.ctx.fillRect(PADX, HUD, COLS_B * TILE, 3);
for (let c = 0; c < COLS_B; c++) { mock.ctx.fillStyle = '#5c4227'; mock.ctx.fillRect(PADX + c * TILE + 2, HUD, 4, TILE * 0.6); }

// 一个"挖出来的洞穴"形状（手工摆一个：左上角挖开、往下延伸）
const cavity = {};
const shape = ['#######', '#######', '##...##', '#.....#', '#.....#', '##...##', '###.###', '#######', '#######'];
// 用真实规则重算：只保留与顶部连通的空格
const raw = shape.map(r => r.split('').map(ch => ch === '.'));
const seen = {}; const q = [];
for (let c = 0; c < COLS_B; c++) if (raw[0][c]) { seen[c] = 1; q.push([0, c]); }
while (q.length) {
  const [r, c] = q.pop(); cavity[r * COLS_B + c] = 1;
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const nr = r + dr, nc = c + dc, k = nr * COLS_B + nc;
    if (nr < 0 || nr >= ROWS_B || nc < 0 || nc >= COLS_B || seen[k]) continue;
    if (raw[nr][nc]) { seen[k] = 1; q.push([nr, nc]); }
  }
}
const demo = [
  [null, null, null, null, null, null, null],
  [null, null, null, null, null, null, null],
  [null, null, { t: 0, c: 0 }, { t: 0, c: 0 }, { t: 0, c: 1 }, null, null],
  [null, { t: 0, c: 2 }, null, null, { t: 0, c: 3 }, null, null],
  [{ t: 0, c: 4 }, { t: 0, c: 4 }, { t: 0, c: 0 }, { t: 0, c: 0 }, null, { t: 1 }, null],
  [{ t: 0, c: 3 }, { t: 0, c: 3 }, { t: 2 }, null, { t: 0, c: 2 }, { t: 0, c: 2 }, { t: 0, c: 0 }],
  [{ t: 0, c: 0 }, { t: 3 }, { t: 0, c: 4 }, { t: 0, c: 0 }, { t: 0, c: 0 }, { t: 0, c: 0 }, { t: 0, c: 0 }],
  [{ t: 0, c: 1 }, { t: 0, c: 1 }, { t: 0, c: 0 }, { t: 0, c: 4 }, { t: 0, c: 0 }, { t: 0, c: 3 }, { t: 0, c: 3 }],
  [{ t: 0, c: 2 }, { t: 0, c: 2 }, { t: 0, c: 1 }, { t: 4 }, { t: 0, c: 1 }, { t: 0, c: 4 }, { t: 0, c: 4 }]
];
for (let r = 0; r < ROWS_B; r++) for (let c = 0; c < COLS_B; c++) {
  const x = PADX + c * TILE, y = HUD + Math.round(TILE * 0.6) + r * TILE;
  const isCav = cavity[r * COLS_B + c];
  // 岩层底色：噪声 + 空腔处压暗
  const n = hash2(c + 1, r + 3);
  if (isCav) {
    mock.ctx.fillStyle = n > 0.85 ? '#0d1017' : '#0a0c11';
  } else {
    mock.ctx.fillStyle = n > 0.72 ? '#2b2119' : (n > 0.4 ? '#241c16' : '#1d1712');
  }
  mock.ctx.fillRect(x, y, TILE, TILE);
  if (isCav) {
    // 空腔边缘高光：贴着岩石的那一侧画一条亮边，读起来才像"洞"
    const edge = [[-1, 0, 0, 0, TILE, 2], [1, 0, 0, TILE - 2, TILE, 2], [0, -1, 0, 0, 2, TILE], [0, 1, TILE - 2, 0, 2, TILE]];
    for (const [dr, dc, ox, oy, w2, h2] of edge) {
      const nr = r + dr, nc = c + dc;
      const nb = (nr < 0 || nr >= ROWS_B || nc < 0 || nc >= COLS_B) ? null : cavity[nr * COLS_B + nc];
      if (!nb) { mock.ctx.fillStyle = '#3a2d22'; mock.ctx.fillRect(x + ox, y + oy, w2, h2); }
    }
  }
  const cell = demo[r][c];
  if (cell && !isCav) {
    const st = A.cellStyle(cell);
    A.drawSprite(mock.ctx, st.shape, st.pal, x, y, 3);
  }
}
// 光标高亮：模拟"悬停在一个 5 连矿组上"的预览
mock.ctx.fillStyle = '#ffffff';
const hl = [[4, 3], [4, 4], [5, 3]];
// 用一个 1px 白框表示高亮（真实游戏里是描边 + 计数）
for (const [r, c] of [[3, 1], [3, 2]]) { }
mock.ctx.globalAlpha = 0.35; mock.ctx.fillStyle = '#ffe89a';
mock.ctx.fillRect(PADX + 3 * TILE, HUD + 8 + 4 * TILE, TILE, TILE);
mock.ctx.fillRect(PADX + 4 * TILE, HUD + 8 + 4 * TILE, TILE, TILE);
mock.ctx.globalAlpha = 1;
const mockBig = upscale(mock, 2);
writePng(path.join(OUT, 'mock-board.png'), mockBig.w, mockBig.h, mockBig.buf);
console.log('✓ assets/mock-board.png ' + mockBig.w + 'x' + mockBig.h);
