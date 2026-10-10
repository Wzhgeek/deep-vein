/* =====================================================================
 * 矿脉 Deep Vein — 无头模拟器 / 自动验收
 * 用法:  node tools/sim.js [局数]
 * 作用:  在不打开浏览器的情况下跑几百局机器人对局，
 *         (1) 断言核心不变式（矿道连通性、空气/晶尘边界、无 NaN）
 *         (2) 输出平衡统计，用来调数值
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
if (!V || !V.RELICS) { console.error('加载失败：Vein 未导出或词条库为空'); process.exit(1); }

/* ---------------- 不变式 ---------------- */
const problems = [];
function fail(msg) { if (problems.length < 20) problems.push(msg); }

function checkInvariants(s, tag) {
  if (s.board.length !== V.ROWS) fail(tag + ': 行数 ' + s.board.length);
  for (let r = 0; r < V.ROWS; r++) {
    if (s.board[r].length !== V.COLS) fail(tag + ': 第' + r + '行列数异常');
    for (let c = 0; c < V.COLS; c++) {
      const cell = s.board[r][c];
      if (cell && (cell.t == null || !isFinite(cell.t))) fail(tag + ': 非法格子 @' + r + ',' + c);
      if (cell && cell.t === V.T.ORE && !(cell.c >= 0 && cell.c < V.COLORS.length)) fail(tag + ': 非法颜色 @' + r + ',' + c);
    }
  }
  // 空气 / 晶尘边界
  if (s.air > s.airMax) fail(tag + ': 空气超上限 ' + s.air + '>' + s.airMax);
  if (!isFinite(s.air) || isNaN(s.air)) fail(tag + ': 空气 NaN');
  if (!isFinite(s.dust) || s.dust < 0) fail(tag + ': 晶尘异常 ' + s.dust);
  if (s.depth < 1) fail(tag + ': 深度异常 ' + s.depth);
  // 矿道连通性：每个空格都必须能顺着空格走到第 0 行（矿道从上方的平巷长出来）
  const seen = {}, q = [];
  for (let c = 0; c < V.COLS; c++) if (s.board[0][c] === null) { seen[c] = 1; q.push([0, c]); }
  let nulls = 0;
  for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) if (s.board[r][c] === null) nulls++;
  while (q.length) {
    const cur = q.pop();
    for (const d of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = cur[0] + d[0], nc = cur[1] + d[1], k = nr * V.COLS + nc;
      if (nr < 0 || nr >= V.ROWS || nc < 0 || nc >= V.COLS || seen[k]) continue;
      if (s.board[nr][nc] === null) { seen[k] = 1; q.push([nr, nc]); }
    }
  }
  let reached = 0; for (const k in seen) reached++;
  if (reached !== nulls) fail(tag + ': 矿道断裂！空腔 ' + nulls + ' 格，其中 ' + reached + ' 格与平巷连通');
  // 不允许出现"完全无路可走"
  const acts = [];
  for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) {
    const a = V.actionFor(s, r, c);
    if (a.kind !== 'invalid') acts.push(a.kind);
  }
  if (!acts.length) fail(tag + ': 无任何可用操作（死局）');
}

/* ---------------- 机器人 ---------------- */
function botMove(s) {
  let best = null;
  for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) {
    const cell = s.board[r][c];
    if (!cell || !V.isFrontier(s, r, c)) continue;
    const a = V.actionFor(s, r, c);
    if (a.kind === 'invalid') continue;
    let score;
    if (a.kind === 'bonus') score = 900 + r * 3 + c;                  // 顺手捡走
    else if (a.kind === 'dig') score = 200 + a.group.length * 12 + r * 2;
    else score = 60 - a.cost * 12 - a.dmg * 40 + r * 2;               // 开凿/镐击是下策，受伤更是
    if (a.dmg > 0 && s.air - a.dmg <= 2 && s.dugInLevel > 3) score -= 300; // 保命
    if (!best || score > best.score) best = { score, r, c, kind: a.kind };
  }
  return best;
}

const RELIC_PREF = ['tunnel', 'god', 'greed', 'richvein', 'chain', 'deepdiver', 'airpocket', 'surveyor', 'pulse', 'resonance'];
function botDraft(s) {
  if (!s.draft.length) return;
  let pick = s.draft.find(id => RELIC_PREF.includes(id));
  if (!pick) pick = s.draft[0];
  V.takeRelic(s, pick);
}

/* ---------------- 跑一局 ---------------- */
function runOne(seed, opt) {
  opt = opt || {};
  const s = V.newRun(seed, { upgrades: opt.upgrades || {} });
  let guard = 0;
  const maxSteps = opt.maxSteps || 4000;
  while (guard++ < maxSteps && s.phase !== 'over') {
    if (s.phase === 'draft') { botDraft(s); continue; }
    checkInvariants(s, 'seed' + seed + '#step' + guard);
    // 撤退策略：空气见底就走人（稳健玩家的行为）
    if (opt.retreat && s.air <= 3) break;
    if (guard > (opt.maxClicks || 900)) break;
    const mv = botMove(s);
    if (!mv) break;
    const res = V.applyAction(s, mv.r, mv.c);
    if (!res.ok) { fail('seed' + seed + ': 合法动作被拒绝 ' + res.reason); break; }
  }
  const sum = V.ascend(s);
  return { s, sum, steps: guard };
}

/* ---------------- 主流程 ---------------- */
const N = parseInt(process.argv[2] || '300', 10);

function measure(label, opt) {
  const st = { depth: [], dust: [], clicks: [], biggest: [], collapses: 0, relics: 0, hazards: 0, scrolls: [], nulls: [], deaths: 0, picks: 0, ore: [] };
  for (let i = 0; i < N; i++) {
    const { s, sum } = runOne(1000 + i * 7919, Object.assign({}, opt, { upgrades: i % 4 === 0 ? { air: 1, survey: 1 } : {} }));
    st.depth.push(sum.depth); st.dust.push(sum.banked); st.clicks.push(sum.clicks);
    st.biggest.push(sum.biggest); st.collapses += sum.collapses; st.relics += sum.relics.length;
    st.hazards += sum.hazards; st.scrolls.push(sum.scrolls); st.deaths += sum.dead ? 1 : 0;
    st.picks += sum.picks; st.ore.push(sum.dugOre);
    st.elites = (st.elites || 0) + (sum.elites || 0);
    st.crystals = (st.crystals || 0) + (sum.crystals || 0);
    let nulls = 0; for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) if (s.board[r][c] === null) nulls++;
    st.nulls.push(nulls);
    if (sum.depth < 1) fail('seed' + i + ': 深度 <1');
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const pc = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))]; };
  console.log('\n--- ' + label + ' ---');
  console.log('  深度      平均 ' + avg(st.depth).toFixed(2) + '   中位 ' + pc(st.depth, 0.5) + '   p25 ' + pc(st.depth, 0.25) + '   p90 ' + pc(st.depth, 0.9) + '   最大 ' + Math.max.apply(null, st.depth));
  console.log('  单局晶尘  平均 ' + avg(st.dust).toFixed(0) + '   中位 ' + pc(st.dust, 0.5) + '   p90 ' + pc(st.dust, 0.9));
  console.log('  点击      平均 ' + avg(st.clicks).toFixed(0) + '   中位 ' + pc(st.clicks, 0.5) + '   (推算单局时长 ≈ ' + (avg(st.clicks) * 1.5 / 60).toFixed(1) + ' 分钟 @1.5s/次)');
  console.log('  挖矿格数  平均 ' + avg(st.ore).toFixed(0) + '   开凿/镐击 ' + (st.picks / N).toFixed(1) + ' 次/局   最大连块 ' + avg(st.biggest).toFixed(1) + ' (峰值 ' + Math.max.apply(null, st.biggest) + ')');
  console.log('  词条      平均 ' + (st.relics / N).toFixed(1) + ' 条/局   (池子 ' + V.RELICS.length + ' 条)');
  console.log('  危险矿    凿开 ' + (st.hazards / N).toFixed(1) + ' 次/局   滚屏 ' + avg(st.scrolls).toFixed(0) + ' 格/局');
  console.log('  精英矿    处理 ' + ((st.elites || 0) / N).toFixed(1) + ' 处/局   晶簇 ' + ((st.crystals || 0) / N).toFixed(2) + ' 处/局');
  console.log('  结束方式  塌方 ' + (100 * st.deaths / N).toFixed(0) + '%   主动升井 ' + (100 * (N - st.deaths) / N).toFixed(0) + '%');
  return st;
}

const t0 = Date.now();
console.log('\n===== 矿脉 Deep Vein · 无头模拟 (' + N + ' 局 × 2 种打法) =====');
const greedy = measure('贪心打法：一路挖到底，不主动撤退', { retreat: false });
const safe = measure('稳健打法：空气 <=3 就升井', { retreat: true });
console.log('\n耗时 ' + (Date.now() - t0) + 'ms');

if (problems.length) {
  console.log('\n❌ 不变式失败 ' + problems.length + ' 例:');
  for (const p of problems.slice(0, 12)) console.log('   - ' + p);
  process.exit(1);
} else {
  console.log('✅ 全部不变式通过（矿道始终连通平巷 / 无死局 / 数值无 NaN）');
}
