/* =====================================================================
 * 矿脉 Deep Vein — 元进程模拟器
 * 用法: node tools/meta-sim.js [局数]
 *
 * 它回答一个具体问题：**把长期目标买光要多少局？**
 * 单局模拟用的是 tools/sim.js 同一套机器人策略；局与局之间把晶尘存下来，
 * 按一个"理性玩家"的购买顺序消费（便宜的优先、先强化后解锁词条）。
 * ===================================================================== */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const sandbox = { console, Math, Date, JSON, Number, Array, Object, String, Boolean, isNaN, parseInt, parseFloat };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['src/core.js', 'src/relics.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const V = sandbox.Vein;

/* ---------- 机器人（与 sim.js 同策略） ---------- */
function botMove(s) {
  let best = null;
  for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) {
    const cell = s.board[r][c];
    if (!cell || !V.isFrontier(s, r, c)) continue;
    const a = V.actionFor(s, r, c);
    if (a.kind === 'invalid') continue;
    let score;
    if (a.kind === 'bonus') score = 900 + r * 3 + c;
    else if (a.kind === 'dig') score = 200 + a.group.length * 12 + r * 2;
    else score = 60 - a.cost * 12 - a.dmg * 40 + r * 2;
    if (a.dmg > 0 && s.air - a.dmg <= 2 && s.dugInLevel > 3) score -= 300;
    if (!best || score > best.score) best = { score, r, c };
  }
  return best;
}
const RELIC_PREF = ['tunnel', 'god', 'chain', 'deepdiver', 'airpocket', 'surveyor', 'lightpick', 'resonance', 'pulse', 'lamp'];
function botDraft(s) {
  if (!s.draft.length) return;
  const p = s.draft.find(id => RELIC_PREF.includes(id)) || s.draft[0];
  V.takeRelic(s, p);
}

/* ---------- 元进程状态（与 app.js 的 defaultMeta 对齐） ---------- */
function newMeta() {
  const up = {}; V.UPGRADES.forEach(u => up[u.id] = 0);
  const unlocked = {}; V.RELICS.forEach(r => { if (r.start) unlocked[r.id] = 1; });
  return { dust: 0, totalDust: 0, upgrades: up, unlocked, ascension: 0, ascMax: 0, runs: 0 };
}

/* ---------- 一局 ---------- */
function playRun(meta, seed, policy) {
  const s = V.newRun(seed, {
    upgrades: meta.upgrades, ascension: meta.ascension, unlocked: meta.unlocked, startRelic: null
  });
  let g = 0, lastD = 1, descends = 0, spentA = 0, gainA = 0, acts = 0, digCells = 0, pickCells = 0;
  const trace = process.env.TRACE_RUN === String(meta.runs + 1);
  if (trace) console.log('   [meta] 强化 ' + JSON.stringify(meta.upgrades) + ' 解锁 ' + Object.keys(meta.unlocked).length + ' 深渊 ' + meta.ascension + ' 晶尘 ' + Math.round(meta.dust));
  while (g++ < 6000) {
    if (s.phase === 'over') break;
    if (s.phase === 'draft') { botDraft(s); continue; }
    if (policy === 'safe' && s.air <= 3) break;          // 稳健：空气见底就走
    const mv = botMove(s);
    if (!mv) break;
    const airBefore = s.air, cellBefore = s.dugTotal, kind = V.actionFor(s, mv.r, mv.c).kind;
    if (!V.applyAction(s, mv.r, mv.c).ok) break;
    acts++;
    const dc = s.dugTotal - cellBefore;
    if (kind === 'dig') digCells += dc; else pickCells += dc;
    if (s.air < airBefore) spentA += airBefore - s.air;
    if (s.air > airBefore) gainA += s.air - airBefore;
    if (trace && s.depth >= 20 && acts % 30 === 0)
      console.log('   深' + s.depth + ' 动作' + acts + ' 空气' + s.air + '/' + s.airMax + ' 债' + s.airDebt +
        ' 挖矿格' + digCells + ' 开凿格' + pickCells + ' 累计扣' + spentA + ' 累计回' + gainA);
    if (s.depth !== lastD) {
      descends++;
      if (trace && s.depth >= 18) console.log('   →下潜 深' + s.depth + ' 需挖' + V.descendNeed(s) + ' 层进度' + s.dugInLevel + ' 空气' + s.air + ' 挖矿格' + digCells + ' 开凿格' + pickCells + ' 动作' + acts);
      if (trace && (descends <= 12 || descends % 5 === 0 || s.depth > 28))
        console.log('   深度 ' + String(s.depth).padStart(2) + ' 空气 ' + String(s.air).padStart(3) + '/' + s.airMax +
          ' 需挖 ' + String(V.descendNeed(s)).padStart(3) + ' 已挖 ' + String(s.dugTotal).padStart(5) +
          ' 词条 ' + String(s.relics.length).padStart(2) + ' 晶尘 ' + s.dust + ' 步数 ' + g);
      lastD = s.depth;
    }
  }
  const sum = V.ascend(s);
  meta.totalDust += sum.banked;
  meta.dust += sum.banked;
  meta.runs++;
  // 深渊解锁
  if (!sum.dead && sum.depth >= V.ASCENSION.unlockDepth(meta.ascension) &&
      meta.ascMax <= meta.ascension && meta.ascension < V.ASCENSION.max) {
    meta.ascMax = meta.ascension + 1;
    // 解锁后自动往上走一级（模拟"想挑战更高难度"的玩家）
    meta.ascension = meta.ascMax;
  }
  return sum;
}

/* ---------- 理性玩家的消费顺序 ---------- */
function shopPriority(meta) {
  // 先买便宜的强化（收益立竿见影），再把词条一条条解锁，最后补贵的强化
  const list = [];
  for (const u of V.UPGRADES) {
    const lv = meta.upgrades[u.id] || 0;
    if (lv < u.maxLevel) list.push({ kind: 'up', id: u.id, cost: u.cost(lv), name: u.name });
  }
  for (const r of V.RELICS) {
    if (!meta.unlocked[r.id]) list.push({ kind: 'rel', id: r.id, cost: V.UNLOCK_COST[r.rarity], name: '词条 ' + r.name });
  }
  list.sort((a, b) => a.cost - b.cost);
  return list;
}
function spend(meta, log) {
  let bought = true;
  while (bought) {
    bought = false;
    for (const it of shopPriority(meta)) {
      if (it.cost <= meta.dust) {
        meta.dust -= it.cost;
        if (it.kind === 'up') meta.upgrades[it.id] = (meta.upgrades[it.id] || 0) + 1;
        else meta.unlocked[it.id] = 1;
        log.push({ run: meta.runs, what: it.name, cost: it.cost });
        bought = true;
      }
    }
  }
}

/* ---------- 主流程 ---------- */
const N = parseInt(process.argv[2] || '40', 10);
const policy = process.argv[3] || 'safe';
const meta = newMeta();
const log = [];
const rows = [];
let allBoughtAt = null;
const target = (() => {                       // 长期目标总量
  let t = 0;
  for (const u of V.UPGRADES) for (let l = 0; l < u.maxLevel; l++) t += u.cost(l);
  for (const r of V.RELICS) if (!r.start) t += V.UNLOCK_COST[r.rarity];
  return t;
})();

for (let i = 0; i < N; i++) {
  const before = meta.dust;
  const sum = playRun(meta, 20261010 + i * 7919, policy);
  const earned = meta.dust - before;
  spend(meta, log);
  const left = shopPriority(meta).length;
  rows.push({ run: i + 1, depth: sum.depth, earned, dust: meta.dust, asc: meta.ascension, left });
  if (left === 0 && allBoughtAt === null) allBoughtAt = i + 1;
}

console.log('\n===== 矿脉 · 元进程模拟（' + N + ' 局，打法：' + (policy === 'safe' ? '稳健' : '贪心') + '）=====');
console.log('长期目标总量: ' + target + ' 晶尘（强化 ' + V.UPGRADES.length + ' 项 + 词条解锁 ' + V.RELICS.filter(r => !r.start).length + ' 条）');
console.log('');
console.log(' 局  深度  本局晶尘   余额  深渊  剩余可买');
console.log(' ──  ────  ────────  ─────  ────  ────────');
for (const r of rows) {
  if (r.run <= 12 || r.run % 5 === 0 || r.left === 0)
    console.log(String(r.run).padStart(3) + '  ' + String(r.depth).padStart(4) + '  ' +
      String(r.earned).padStart(8) + '  ' + String(Math.round(r.dust)).padStart(5) + '  ' +
      String(r.asc).padStart(4) + '  ' + String(r.left).padStart(8));
}
console.log('');
const first = rows.slice(0, 3).reduce((a, b) => a + b.earned, 0) / 3;
const last = rows.slice(-3).reduce((a, b) => a + b.earned, 0) / 3;
console.log('前 3 局平均收入: ' + first.toFixed(0) + ' 晶尘/局');
console.log('后 3 局平均收入: ' + last.toFixed(0) + ' 晶尘/局（深渊 ' + meta.ascension + ' 级加成下）');
console.log('累计带回: ' + Math.round(meta.totalDust) + ' 晶尘 / ' + N + ' 局');
console.log('买光全部长期目标用了: ' + (allBoughtAt ? allBoughtAt + ' 局' : '>' + N + ' 局（还没买完）'));
console.log('最终深渊等级: ' + meta.ascension + ' / ' + V.ASCENSION.max);
console.log('');
console.log('购物流水（前 10 笔）:');
for (const l of log.slice(0, 10)) console.log('  第' + String(l.run).padStart(2) + '局  ' + l.what + '  ' + l.cost + ' 尘');
console.log('  …共 ' + log.length + ' 笔');
