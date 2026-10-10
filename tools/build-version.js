/* 从 version.json 生成 src/version.js —— 让开发模式（index.html）与单文件构建都能拿到同一个版本号 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
const out = '/* 自动生成，请勿手改 —— 见 tools/build-version.js */\n' +
  "globalThis.VEIN_VERSION = '" + v.version + "';\n" +
  "globalThis.VEIN_RELEASED = '" + (v.released || '') + "';\n";
fs.writeFileSync(path.join(ROOT, 'src/version.js'), out);
console.log('✓ src/version.js  ->  v' + v.version);
