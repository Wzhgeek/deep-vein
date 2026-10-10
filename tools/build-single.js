/* =====================================================================
 * 把整个游戏打包成单个 HTML 文件（方便直接发给朋友 / 丢到任何静态托管）
 * 用法: node tools/build-single.js
 * 产出: dist/矿脉.html
 * ===================================================================== */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
fs.mkdirSync(OUT, { recursive: true });

const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
const ORDER = ['src/version.js', 'src/update.js', 'src/core.js', 'src/relics.js', 'src/achievements.js', 'src/pixfont.js', 'src/art.js', 'src/audio.js', 'src/app.js'];
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const scripts = ORDER.map(f => {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (code.includes('</script')) throw new Error(f + ' 里含有 </script，内联会破坏 HTML');
  return '<script>/* ===== ' + f + ' ===== */\n' + code + '\n</script>';
}).join('\n');

// 用内联脚本替换掉原来的 5 个 <script src=...>
const before = html;
html = html.replace(/(<script src="src\/[^"]+"><\/script>\s*)+/,
  scripts + '\n');
if (html === before) throw new Error('没能找到 <script src="src/..."> 序列，index.html 结构变了？');

const out = path.join(OUT, '矿脉.html');
fs.writeFileSync(out, html, 'utf8');
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('✓ dist/矿脉.html  ' + kb + ' KB  单文件、零依赖、双击即玩  (v' + v.version + ')');
