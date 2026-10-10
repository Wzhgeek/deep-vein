/* =====================================================================
 * 点阵字体渲染器（由 tools/build_font.py 内联进 src/pixfont.js）
 * 全部是 1-bit 点阵，按整数倍放大绘制 —— 和像素画面同一种语言。
 * 两种字号：c16 = 16px 全字符（基准，汉字与拉丁都在里面）· s8 = 8px 小号读数（仅拉丁/数字）
 * ===================================================================== */
/* 数据是紧凑数组 [宽,高,步进,[十六进制行...]]，这里一次性展开成对象并解析成整数，
   之后渲染就是纯位运算 —— 每帧画几百个字符也不会有压力。 */
function _norm(t) {
  for (var k in t) {
    var a = t[k];
    var rows = new Array(a[3].length);
    for (var i = 0; i < a[3].length; i++) rows[i] = parseInt(a[3][i], 16);
    t[k] = { w: a[0], h: a[1], adv: a[2], rows: rows };
  }
  return t;
}
_norm(C16); _norm(S8);
var FONT_TABLES = { c16: C16, s8: S8 };

/* 缺字自检：渲染时把"字库里没有"的字符记下来。
   这是渲染路径上最容易静默失败的地方 —— 屏幕上就是一块空白，不报错、不崩溃。
   自动化测试会渲染全部界面后检查这个集合必须为空。 */
var _missing = {};
function glyph(ch, size) {
  var t = FONT_TABLES[size] || C16;
  if (t[ch]) return t[ch];
  if (ch !== ' ' && ch !== '\n') _missing[(FONT_TABLES[size] ? size : 'c16') + ':' + ch] = 1;
  if (C16[ch]) return C16[ch];
  if (C16['?']) return C16['?'];
  return { w: 1, h: 1, adv: 4, rows: [0] };
}

function measure(str, size, scale) {
  scale = scale || 1;
  var w = 0;
  for (var i = 0; i < str.length; i++) w += glyph(str[i], size || 'c16').adv * scale;
  return w;
}

/** 把一段文字画到 2D context 上。y 是文字盒的顶部。 */
function draw(ctx, str, x, y, opt) {
  opt = opt || {};
  var size = opt.size || 'c16';
  var scale = opt.scale || 1;
  var color = opt.color || '#e8edf5';
  var sp = opt.spacing || 0;
  var w = measure(str, size, scale) + sp * Math.max(0, str.length - 1);
  var ox = x;
  if (opt.align === 'center') ox = Math.round(x - w / 2);
  else if (opt.align === 'right') ox = Math.round(x - w);
  // 自报"我实际画在哪" —— 自动化断言必须基于真实绘制结果，
  // 而不是调用方声称的对齐方式（否则断言只会验证代码意图）。
  root.PixFont.lastBox = { x: ox, y: y, w: w, h: (size === 's8' ? 8 : 16) * scale };
  ctx.fillStyle = color;
  var cx = ox;
  for (var i = 0; i < str.length; i++) {
    var g = glyph(str[i], size);
    for (var r = 0; r < g.rows.length; r++) {
      var bits = g.rows[r];
      if (!bits) continue;
      var c = 0;
      while (c < g.w) {
        if (!((bits >> c) & 1)) { c++; continue; }
        var e = c;
        while (e < g.w && ((bits >> e) & 1)) e++;
        ctx.fillRect(cx + c * scale, y + r * scale, (e - c) * scale, scale);
        c = e;
      }
    }
    cx += (g.adv + sp) * scale;
  }
  return w;
}

/** 按最大宽度折行；返回行数组。中英文都能断（中文逐字断，英文尽量按空格断） */
function wrap(str, maxW, size, scale) {
  scale = scale || 1;
  var lines = [], line = '';
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
    if (ch === '\n') { lines.push(line); line = ''; continue; }
    var t = line + ch;
    if (measure(t, size, scale) > maxW && line) {
      // 英文单词尽量整词换行
      var sp = line.lastIndexOf(' ');
      if (sp > 0 && /[A-Za-z0-9]/.test(ch)) { lines.push(line.slice(0, sp)); line = line.slice(sp + 1) + ch; }
      else { lines.push(line); line = ch; }
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** 画多行（自动折行），返回占用高度 */
function para(ctx, str, x, y, maxW, opt) {
  opt = opt || {};
  var size = opt.size || 'c16', scale = opt.scale || 1;
  var lh = (size === 's8' ? 10 : 16) * scale + (opt.leading || 0);
  var lines = wrap(str, maxW, size, scale);
  for (var i = 0; i < lines.length; i++) {
    var lx = x;
    if (opt.align === 'center') lx = x + maxW / 2;
    draw(ctx, lines[i], lx, y + i * lh, { size: size, scale: scale, color: opt.color, align: opt.align });
  }
  return lines.length * lh;
}

root.PixFont = {
  measure: measure, draw: draw, wrap: wrap, para: para,
  height: function (size, scale) { return (size === 's8' ? 8 : 16) * (scale || 1); },
  missing: function () { return Object.keys(_missing); },
  resetMissing: function () { _missing = {}; },
  chars: function () { return Object.keys(C16).length; }
};
