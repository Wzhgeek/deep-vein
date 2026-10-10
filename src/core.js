/* =====================================================================
 * 矿脉 Deep Vein — 核心逻辑 v0.1
 * 纯逻辑，无 DOM 依赖：可在浏览器和 Node 里同时运行（用于无头模拟）。
 * 规则要点：
 *   - 盘面 7x9 全是矿。盘面上方是一条"虚拟平巷"，所以第 0 行永远可挖。
 *   - 只能挖「与矿道(空格)4-邻接」的格子 —— 矿道的形状就是你挖出来的地图。
 *   - 同色 4-连通 >= 2 块：免费挖矿，得分。
 *   - 孤块 / 沼气泡 / 岩浆 / 坚岩：只能「镐击」，消耗空气。
 *   - 矿石不下落（矿道永久保留），新矿从盘面底部随下潜长出来 —— 向下滚动的矿脉剖面。
 * ===================================================================== */
'use strict';
(function (root) {

  /* ---------------- 常量 ---------------- */
  const COLS = 7, ROWS = 9;
  const T = { ORE: 0, POISON: 1, LAVA: 2, BEDROCK: 3, HEART: 4, FOSSIL: 5,
              DEEPSTONE: 6, CRYSTAL: 7, GASVEIN: 8, MAGNET: 9 };
  const TNAME = ['矿石', '沼气泡', '岩浆', '坚岩', '矿脉之心', '化石', '深岩', '晶簇', '毒气矿脉', '磁石'];
  /* 精英危险矿（深度 6+ 才出现）。
     设计意图：普通危险矿只是"绕开就行"的路障，精英必须让玩家做选择——
       深岩  ：挖不掉且每层向下生长，会永久改变矿道走向（改道成本 vs 绕路成本）
       晶簇  ：凿开 +30 晶尘 +2 空气，是"补给点"，值得绕路去拿
       毒气矿脉：凿开 -2 空气，且每层把相邻矿石变成沼气泡（越拖越糟） */
  const ELITE = { 6: 1, 7: 1, 8: 1 };
  const isElite = t => t >= 6;
  const COLORS = [
    { name: '赤铁', hex: '#c0392b' },
    { name: '苍铜', hex: '#16a085' },
    { name: '蓝荧', hex: '#2f6fd0' },
    { name: '紫晶', hex: '#8e44ad' },
    { name: '硫金', hex: '#d4a017' },
    { name: '银砂', hex: '#c9d4e0' }     // 只在深渊出现：高对比的浅色，视觉上就是"另一个世界"
  ];
  const RARITY = ['普通', '稀有', '传说'];

  /* ---------------- 矿层（Strata）：每 5 层换一次"地方" ----------------
   * 加这一层的目的：原来每层手感完全一样，玩家只感到"数字在涨"。
   * 每层的**危险矿总量与原来的深度曲线对齐**，只在种类之间重新分配 ——
   * 这样既换出了面目，又不会悄悄改掉已经验证过的难度曲线。
   *   crystalPerLevel / heartPerLevel 是补给配额（见 enforceQuota）。 */
  const STRATA = [
    { id: 'surface', name: '表层矿脉', from: 1, to: 5, colors: 4,
      brief: '松软的浅层，还闻得到地面的味道。',
      crystalPerLevel: 1, heartPerLevel: 1, tint: 'rgba(40,52,72,0.16)',
      hazard: { fossil: 0.030, heart: 0.006, bedrock: 0.034, lava: 0, poison: 0.044,
                crystal: 0.004, deepstone: 0, gasvein: 0, magnet: 0 } },

    { id: 'geode', name: '晶洞层', from: 6, to: 10, colors: 4,
      brief: '晶簇成片 —— 但深岩也密，能挖的路比别处窄。',
      crystalPerLevel: 2, heartPerLevel: 0, tint: 'rgba(70,90,140,0.18)',
      // 富矿要配拥挤：晶簇多（补给）但深岩也多（挖不动的永久障碍），
      // 于是"要不要来晶洞层"变成一个真实的取舍，而不是白送空气。
      // 总量仍与原曲线对齐（.342），只换种类。
      hazard: { fossil: 0.030, heart: 0.000, bedrock: 0.052, lava: 0.062, poison: 0.090,
                crystal: 0.024, deepstone: 0.064, gasvein: 0.020, magnet: 0 } },

    { id: 'magma', name: '熔岩层', from: 11, to: 15, colors: 5,
      brief: '岩浆顶替了沼气：踩错一步，代价翻三倍。',
      crystalPerLevel: 1, heartPerLevel: 1, tint: 'rgba(120,50,40,0.20)',
      hazard: { fossil: 0.030, heart: 0.011, bedrock: 0.070, lava: 0.160, poison: 0.040,
                crystal: 0.020, deepstone: 0.060, gasvein: 0.034, magnet: 0.020 } },

    { id: 'deeprock', name: '深岩层', from: 16, to: 20, colors: 5,
      brief: '深岩密布，矿道被迫拐弯 —— 空间本身成了敌人。',
      crystalPerLevel: 1, heartPerLevel: 1, tint: 'rgba(60,66,86,0.22)',
      hazard: { fossil: 0.030, heart: 0.011, bedrock: 0.080, lava: 0.090, poison: 0.060,
                crystal: 0.014, deepstone: 0.110, gasvein: 0.030, magnet: 0.028 } },

    { id: 'abyss', name: '深渊', from: 21, to: 999, colors: 6,
      brief: '没有安全的地方。收益也是全程最高的。',
      crystalPerLevel: 1, heartPerLevel: 1, tint: 'rgba(90,60,120,0.22)',
      hazard: { fossil: 0.030, heart: 0.014, bedrock: 0.090, lava: 0.100, poison: 0.080,
                crystal: 0.010, deepstone: 0.100, gasvein: 0.040, magnet: 0.040 } }
  ];
  function stratumOf(depth) {
    for (const st of STRATA) if (depth >= st.from && depth <= st.to) return st;
    return STRATA[STRATA.length - 1];
  }

  const CFG = {
    cols: COLS, rows: ROWS,
    colorRamp: [4, 4, 5, 5, 5],        // 按深度决定颜色数量
    startAir: 10, maxAir: 10,
    // 下潜所需挖掘量：**不设实际上限**（只留一个防溢出的 999）。
    // 早期封顶 30/40 格，于是把折减类词条堆起来之后"每层净赚氧气"，
    // 模拟器实测能挖到 53 层、单局带走 20 万晶尘 —— 一局就把长期目标买光。
    // 现在由 15 层之后的二次项负责收口，把长局压在 20~30 层。
    descendBase: 12, descendPerDepth: 2, descendCap: 999,
    healDescend: 3,
    thinAirFromDepth: 15,              // 深度 >= 15 起空气稀薄：下潜恢复减半（收口，防止滚雪球）
    bedrockCost: 2,                    // 坚岩只能镐击，消耗 2 点空气（需【硬头】词条）
    digCostEvery: 6,                   // 每挖这么多格消耗 1 点空气（软计时器/体力）
    poisonDamage: 1, lavaDamage: 3,
    lavaFromDepth: 5,                  // 深度 >= 5 出现岩浆
    hazardMulCap: 1.6,                 // 危险矿加成上限：防止贪婪类词条互相叠成必死局
    thresholdMulFloor: 0.5,            // 下潜阈值折减下限（乘算叠加的封底）
    digCostCap: 12,                    // 每 N 格耗 1 点空气的上限（省力类叠加的封顶）
    defaultMaxStack: 3,                // 非 unique 词条的默认叠加上限（淘金曾被抽到 25 份）
    // 晶簇的身份是"补给"（+1 空气），不是收入来源。
    // 晶洞层把配额提到 2 之后，实测它贡献了中位 +98 晶尘、把长线从 9 局压到 6 局；
    // 所以把它的晶尘价值调低，保留"值得绕路"的手感但不让它撑起经济。
    crystalDust: 22,
    magnetDust: 90,
    crystalPerLevel: 1,                // 每层最多刷出的晶簇数（空气补给配额，可按矿层覆盖）
    heartPerLevel: 1,                  // 每层最多刷出的矿脉之心数
    lavaSpread: (d) => d >= 15 ? 3 : (d >= 10 ? 2 : (d >= 5 ? 1 : 0)),
    collapseDustLoss: 0.5,             // 塌方丢掉本局一半晶尘
    // 单格生成危险矿的概率：按矿层给（每层的总量与原曲线对齐，只换种类）
    hazard: (d) => stratumOf(d).hazard
  };

  /* ---------------- 深渊等级（Ascension）：无限难度天梯 ----------------
   * 长期留存的真正来源不是"把商店买光"，而是**一直有下一级可打**。
   * 每一级同时加压（危险矿/下潜阈值/起始空气）和加价（晶尘收益），
   * 解锁条件是"在上一级里升井达到指定深度"—— 逼你变强，而不是逼你刷钱。 */
  const ASCENSION = {
    max: 20,
    unlockDepth: (lv) => 10 + lv * 2,          // 要解锁 lv+1 级，需要在 lv 级升井时到达这个深度
    rewardMul: (lv) => 1 + 0.15 * lv,          // 晶尘收益
    hazardAdd: (lv) => 0.06 * lv,              // 新矿石的危险矿概率加成
    thresholdAdd: (lv) => 0.04 * lv,           // 下潜所需挖掘量
    airPenalty: (lv) => Math.min(3, Math.floor(lv / 3)),
    name: (lv) => lv === 0 ? '标准' : '深渊 ' + lv
  };
  /** 词条解锁价（按稀有度） */
  const UNLOCK_COST = [60, 180, 320];

  /* 永久强化（元进程商店） */
  const UPGRADES = [
    { id: 'air', name: '强化气瓶', desc: '起始空气 +1', maxLevel: 5, cost: (l) => [30, 70, 150, 320, 650][l] || 999 },
    { id: 'pickaxe', name: '耐磨镐头', desc: '挖矿更省力：每 8 格才消耗 1 点空气', maxLevel: 2, cost: (l) => [60, 240][l] || 999 },
    { id: 'veteran', name: '老练矿工', desc: '每次下潜多恢复 1 点空气', maxLevel: 3, cost: (l) => [50, 120, 280][l] || 999 },
    { id: 'survey', name: '勘探术', desc: '开局多 1 次三选一', maxLevel: 2, cost: (l) => [45, 110][l] || 999 },
    { id: 'luck', name: '矿脉之眼', desc: '稀有/传说词条出现率 +50%', maxLevel: 3, cost: (l) => [55, 130, 300][l] || 999 },
    { id: 'slot', name: '出发装备槽', desc: '下井前可以带 1 条已解锁的词条', maxLevel: 2, cost: (l) => [200, 600][l] || 999 },
    { id: 'lamp', name: '矿灯', desc: '永久高亮可挖的最大矿组（省眼睛）', maxLevel: 1, cost: () => 35 }
  ];

  /* ---------------- 随机数（可复现） ---------------- */
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    const f = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next: f,
      int: (n) => Math.floor(f() * n),
      pick: (arr) => arr[Math.floor(f() * arr.length)],
      chance: (p) => f() < p,
      shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
    };
  }
  function hash2(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }

  /* ---------------- 盘面 ---------------- */
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const inB = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

  function colorCount(depth) { return stratumOf(depth).colors; }

  function rollCell(depth, rng, mult) {
    const p = CFG.hazard(depth), k = mult == null ? 1 : mult;
    let x = rng.next(), a = 0;
    if ((a += p.fossil * k) > x) return { t: T.FOSSIL };
    if ((a += p.heart * k) > x) return { t: T.HEART };
    if ((a += p.crystal * k) > x) return { t: T.CRYSTAL };
    if ((a += p.deepstone * k) > x) return { t: T.DEEPSTONE };
    if ((a += p.gasvein * k) > x) return { t: T.GASVEIN };
    if ((a += p.bedrock * k) > x) return { t: T.BEDROCK };
    if ((a += p.lava * k) > x) return { t: T.LAVA };
    if ((a += p.poison * k) > x) return { t: T.POISON };
    return { t: T.ORE, c: rng.int(colorCount(depth)) };
  }

  /** 空气补给配额：晶簇/矿脉之心按"生成格数百分比"刷新，而玩家挖得越深、经手的格子越多，
   *  补给收入就跟着涨 —— 于是"挖矿耗氧"被补给完全抵消，变成永动局（模拟器实测：
   *  累计扣氧 65、累计回氧 66，一路挖到 35 层）。改成**每层限额**之后，
   *  补给收入被钉死在 2 点/层，深层必然入不敷出。 */
  function enforceQuota(s, row) {
    s._quota = s._quota || { crystal: 0, heart: 0 };
    for (let c = 0; c < COLS; c++) {
      const t = row[c] && row[c].t;
      if (t === T.CRYSTAL) {
        if (s._quota.crystal >= stratumOf(s.depth).crystalPerLevel) row[c] = { t: T.ORE, c: s.rng.int(colorCount(s.depth)) };
        else s._quota.crystal++;
      } else if (t === T.HEART) {
        if (s._quota.heart >= stratumOf(s.depth).heartPerLevel) row[c] = { t: T.ORE, c: s.rng.int(colorCount(s.depth)) };
        else s._quota.heart++;
      }
    }
    return row;
  }

  function newRow(s) {
    const row = [];
    // 深渊等级直接把危险矿概率抬上去（天梯的主要压力来源）
    const m = ((s.relicFlags && s.relicFlags.hazardMul) || 1) + (s.ascHazard || 0);
    for (let c = 0; c < COLS; c++) row.push(rollCell(s.depth, s.rng, m));
    return enforceQuota(s, row);
  }

  function newBoard(s) {
    const b = [];
    for (let r = 0; r < ROWS; r++) {
      const row = [];
      for (let c = 0; c < COLS; c++) {
        // 上半部分给玩家留一点安全的起手空间
        const mult = r < 3 ? 0 : Math.min(1, 0.35 + 0.22 * (r - 3));
        row.push(rollCell(s.depth, s.rng, r < 4 ? mult * 0.6 : 1));
      }
      b.push(row);
    }
    // 开局保证有可挖的同色对，避免"上手只能镐击"
    for (let k = 0; k < 3; k++) {
      const r = s.rng.int(5), c = s.rng.int(COLS - 1);
      b[r][c] = { t: T.ORE, c: s.rng.int(colorCount(s.depth)) };
      b[r][c + 1] = { t: T.ORE, c: b[r][c].c };
    }
    return b;
  }

  const cellAt = (s, r, c) => inB(r, c) ? s.board[r][c] : null;
  const isEmpty = (s, r, c) => inB(r, c) && s.board[r][c] === null;

  function isFrontier(s, r, c) {
    if (!inB(r, c) || s.board[r][c] === null) return false;
    if (r === 0) return true;                       // 贴着上方平巷
    for (const d of DIRS) if (isEmpty(s, r + d[0], c + d[1])) return true;
    return false;
  }

  function sameGroup(s, r, c) {
    const cell = s.board[r][c];
    if (!cell || cell.t !== T.ORE) return [];
    const col = cell.c, seen = {}, out = [], st = [[r, c]];
    seen[r * COLS + c] = 1;
    while (st.length) {
      const cur = st.pop(); out.push({ r: cur[0], c: cur[1] });
      for (const d of DIRS) {
        const nr = cur[0] + d[0], nc = cur[1] + d[1], k = nr * COLS + nc;
        if (!inB(nr, nc) || seen[k]) continue;
        const n = s.board[nr][nc];
        if (n && n.t === T.ORE && n.c === col) { seen[k] = 1; st.push([nr, nc]); }
      }
    }
    return out;
  }

  /* ---------------- 可执行动作 ---------------- */
  function actionFor(s, r, c) {
    if (!inB(r, c)) return { kind: 'invalid', reason: '' };
    const cell = s.board[r][c];
    if (!cell) return { kind: 'invalid', reason: '这里已经是矿道' };
    if (!isFrontier(s, r, c)) return { kind: 'invalid', reason: '够不着：只能挖贴着矿道的格子' };
    const f = s.relicFlags;

    if (cell.t === T.ORE) {
      const g = sameGroup(s, r, c);
      if (g.length >= 2) return { kind: 'dig', group: g, cost: 0, dmg: 0, label: '挖矿' };
      // 孤块「开凿」是免费的：它不给进度、不给分，只用来把矿道往前推、把矿脉切出新的面。
      // （早期版本让开凿也扣空气，结果后期边界全是单块，玩家被"千刀万剐"耗死，模拟器实测过。）
      return { kind: 'pick', group: g, cost: 0, dmg: 0, label: '开凿', reason: '孤块', score: f.singleScore ? 1 : 0 };
    }
    if (cell.t === T.POISON) return { kind: 'pick', group: [{ r, c }], cost: 0, dmg: f.poisonImmune ? 0 : CFG.poisonDamage, label: '凿开沼气泡' };
    if (cell.t === T.LAVA) return { kind: 'pick', group: [{ r, c }], cost: 0, dmg: f.lavaToGold ? 0 : Math.max(0, CFG.lavaDamage - (f.lavaArmor || 0)), label: f.lavaToGold ? '熔炼岩浆' : '凿开岩浆' };
    if (cell.t === T.BEDROCK) {
      if (!f.bedrockDig) return { kind: 'invalid', reason: '坚岩：挖不动（需要【硬头】）' };
      return { kind: 'pick', group: [{ r, c }], cost: f.bedrockFree ? 0 : CFG.bedrockCost, dmg: 0, label: '镐击·坚岩' };
    }
    if (cell.t === T.DEEPSTONE) return { kind: 'invalid', reason: '深岩：镐头崩了，只能绕开' };
    if (cell.t === T.GASVEIN) return { kind: 'pick', group: [{ r, c }], cost: 0, dmg: f.poisonImmune ? 0 : 2, label: '凿开毒气矿脉' };
    if (cell.t === T.MAGNET) return { kind: 'pick', group: [{ r, c }], cost: 0, dmg: 2, label: '凿开磁石' };
    if (cell.t === T.CRYSTAL) return { kind: 'bonus', group: [{ r, c }], cost: 0, dmg: 0, label: '开采晶簇' };
    if (cell.t === T.HEART || cell.t === T.FOSSIL) return { kind: 'bonus', group: [{ r, c }], cost: 0, dmg: 0, label: '拾取' };
    return { kind: 'invalid', reason: '' };
  }

  function hasFreeDig(s) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = s.board[r][c];
      if (cell && cell.t === T.ORE && isFrontier(s, r, c) && sameGroup(s, r, c).length >= 2) return true;
    }
    return false;
  }

  /** 供 UI 高亮：当前最大可挖矿组 */
  function bestGroup(s) {
    let best = null;
    const seen = {};
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = s.board[r][c];
      if (!cell || cell.t !== T.ORE || seen[r * COLS + c] || !isFrontier(s, r, c)) continue;
      const g = sameGroup(s, r, c);
      for (const p of g) seen[p.r * COLS + p.c] = 1;
      if (g.length >= 2 && (!best || g.length > best.length)) best = g;
    }
    return best;
  }

  /** 全部可挖矿组（用于提示高亮） */
  function allFrontierGroups(s) {
    const out = [], seen = {};
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = s.board[r][c];
      const k = r * COLS + c;
      if (!cell || cell.t !== T.ORE || seen[k] || !isFrontier(s, r, c)) continue;
      const g = sameGroup(s, r, c);
      for (const p of g) seen[p.r * COLS + p.c] = 1;
      if (g.length >= 2) out.push(g);
    }
    return out;
  }

  /* ---------------- 词条 flags 聚合 ----------------
   * 聚合规则必须显式声明，否则加词条时很容易叠出非预期数值：
   *   MUL 乘算（收益/阈值/危险矿/奖励）  MIN 取最小（阈值型：越小越强）  MAX 取最大  其余加算 */
  const AGG_MUL = { scoreMul: 1, thresholdMul: 1, hazardMul: 1, bonusMul: 1 };
  const AGG_MIN = ['resoEvery', 'doomEvery', 'extraDraftEvery', 'bloodlineEvery'];
  const AGG_MAX = ['digRadius', 'autoChain', 'digFreeChance', 'pulseEvery'];
  function recomputeFlags(s) {
    const f = {
      scoreMul: 1, thresholdMul: 1, hazardMul: 1, bonusMul: 1, digRadius: 0, autoChain: 0,
      bedrockDig: false, bedrockFree: false, poisonImmune: false, lavaSlow: false, lavaToGold: false,
      singleScore: false, healBonus: 0, extraDraft: 0, bigBonus: 0, echo: 0, digCostEvery: 0,
      pulseEvery: 0, convertChance: 0, heartPerDescend: 0, hint: false, pickProgress: false,
      revive: false, deepMul: 0, goldRush: 0, lavaArmor: 0, airMaxB: 0, fog: false,
      minecartBonus: 0, precisionBonus: 0, digFreeChance: 0
    };
    for (const k of AGG_MIN) f[k] = Infinity;
    for (const id of s.relics) {
      const R = (root.Vein.RELICS || []).find(x => x.id === id);
      if (!R || !R.flags) continue;
      for (const k in R.flags) {
        const v = R.flags[k];
        if (typeof v === 'boolean') f[k] = f[k] || v;
        else if (k in AGG_MUL) f[k] *= v;
        else if (AGG_MIN.indexOf(k) >= 0) f[k] = Math.min(f[k], v);
        else if (AGG_MAX.indexOf(k) >= 0) f[k] = Math.max(f[k], v);
        else f[k] = (f[k] || 0) + v;
      }
    }
    for (const k of AGG_MIN) if (!isFinite(f[k])) f[k] = 0;   // Infinity 收回 0 = 未拥有
    // 危险矿概率是乘算叠加的，必须封顶：否则【富矿脉】+【贪婪】会叠成 ~1.9 倍，
    // 盘面被危险矿切碎，玩家被迫反复镐击，4 层就饿死（模拟器实测过）。
    f.hazardMul = Math.min(f.hazardMul, CFG.hazardMulCap);
    // 阈值也是乘算叠加的，必须封底：掘进 0.75 × 勘探 0.85² × 矿工之神 0.65 ≈ 0.35，
    // 会把深层下潜需求压到十几格 —— 于是每层只需不到 1 点空气，而恢复有 3 点，
    // 变成"每层净赚氧气"的永动机（模拟器实测能挖到 53 层、单局 20 万晶尘）。
    f.thresholdMul = Math.max(f.thresholdMul, CFG.thresholdMulFloor);
    s.relicFlags = f;
    return f;
  }

  /* ---------------- 新的一局 ---------------- */
  function newRun(seed, meta) {
    meta = meta || {};
    const lv = meta.upgrades || {};
    const asc = Math.max(0, Math.min(ASCENSION.max, meta.ascension || 0));
    const s = {
      seed: seed >>> 0, rng: makeRng(seed),
      board: null, depth: 1, air: 0, airMax: CFG.maxAir, dust: 0, runDust: 0,
      dugTotal: 0, dugInLevel: 0, dugOre: 0, collapses: 0, scrolls: 0,
      relics: [], relicFlags: {}, charges: {}, pulseCounter: 0, chainDepth: 0, airDebt: 0,
      pendingDraft: 0, phase: 'play', draft: [], events: [], log: [], dead: false,
      ascension: asc,
      ascHazard: ASCENSION.hazardAdd(asc),
      meta: { upgrades: lv, startAirBonus: (lv.air || 0) - ASCENSION.airPenalty(asc), healBonus: lv.veteran || 0,
              extraDraft: lv.survey || 0, luck: lv.luck || 0, lamp: !!lv.lamp, digCostBonus: (lv.pickaxe || 0) * 2,
              unlocked: meta.unlocked || null, startRelic: meta.startRelic || null },
      stats: { clicks: 0, invalid: 0, picks: 0, biggest: 0, hazards: 0, elites: 0 },
      _reso: {}, _blood: 0, _doom: 0, dugCrystal: 0, dugHeart: 0, dugFossil: 0
    };
    s.airMax = Math.max(4, CFG.maxAir + s.meta.startAirBonus);
    s.board = newBoard(s);
    recomputeFlags(s);
    syncAirMax(s);
    s.air = s.airMax;
    s.pendingDraft = s.meta.extraDraft;
    if (s.meta.lamp) s.relicFlags.hint = true;
    if (s.pendingDraft > 0) openDraft(s);
    if (s.meta.startRelic) {
      s.relics.push(s.meta.startRelic);
      const R = (root.Vein.RELICS || []).find(x => x.id === s.meta.startRelic);
      if (R && R.charges) s.charges[R.id] = R.charges;
      recomputeFlags(s); syncAirMax(s); s.air = s.airMax;
      log(s, '【出发装备】' + (R ? R.name : s.meta.startRelic));
    }
    for (let r = 0; r < ROWS; r++) enforceQuota(s, s.board[r]);
    ensurePlayable(s);
    s.log.push('下井。深度 1，空气 ' + s.air + '。');
    return s;
  }

  /* ---------------- 分数 ---------------- */
  function depthMul(d) { return 1 + 0.18 * (d - 1); }   // 越深越肥：给「再挖一层」一个真实的诱惑
  function groupDust(s, n) {
    const f = s.relicFlags;
    let v = (n + Math.max(0, n - 2)) * depthMul(s.depth) * f.scoreMul * ASCENSION.rewardMul(s.ascension || 0);
    if (n >= 6) v += f.bigBonus;
    if (f.deepMul && s.depth >= 8) v *= f.deepMul;
    if (f.goldRush) v += f.goldRush;
    return Math.max(1, Math.round(v));
  }

  function ev(s, e) { s.events.push(e); if (s.events.length > 200) s.events.shift(); }
  function log(s, m) { s.log.push(m); if (s.log.length > 120) s.log.shift(); }

  /* ---------------- 执行一次操作 ---------------- */
  function applyAction(s, r, c) {
    if (s.phase !== 'play') return { ok: false, reason: '先处理当前选择' };
    const a = actionFor(s, r, c);
    s.stats.clicks++;
    if (a.kind === 'invalid') { s.stats.invalid++; ev(s, { type: 'invalid', r, c, reason: a.reason }); return { ok: false, reason: a.reason }; }
    if (a.kind === 'pick' && (a.cost + a.dmg) >= s.air && hasFreeDig(s)) {
      s.stats.invalid++; ev(s, { type: 'invalid', r, c, reason: '空气不够了' });
      return { ok: false, reason: '空气不够了：先挖点免费的矿撑到下潜' };
    }

    let cells = a.group.slice();
    let gain = 0;

    if (a.kind === 'dig') {
      const ctx = { s, rng: s.rng, cells, n: cells.length, gain: groupDust(s, cells.length), extraGain: 0, log: (m) => log(s, m) };
      for (const id of s.relics) {
        const R = (root.Vein.RELICS || []).find(x => x.id === id);
        if (R && R.onDig) { cells = R.onDig(ctx) || cells; }
      }
      cells = dedupe(cells);
      // 安全网：词条可以往挖掘集合里加格子，但绝不允许加入与主矿组不连通的格子
      // （否则会挖出与矿道断开的孤立空腔）。这里只保留与点击格 4-连通的格子。
      cells = keepConnected(cells, r, c);
      // 【共鸣】：同色累计挖满阈值后，本次挖掘波及整圈 4-邻接。
      // 注意必须用 4-邻接：8-邻接会挖到只与主矿组斜角相接的格子，造出与矿道断开的孤立空腔。
      if (s.relicFlags.resoEvery) {
        const first = cells.find(p => s.board[p.r][p.c]);
        if (first) {
          const color = s.board[first.r][first.c].c;
          s._reso[color] = (s._reso[color] || 0) + cells.length;
          if (s._reso[color] >= s.relicFlags.resoEvery) {
            s._reso[color] = 0;
            const ring = {};
            for (const p of cells) for (const d of DIRS) {
              const nr = p.r + d[0], nc = p.c + d[1];
              if (inB(nr, nc)) ring[nr * COLS + nc] = 1;
            }
            const inSet = {};
            for (const p of cells) inSet[p.r * COLS + p.c] = 1;
            for (const k in ring) {
              const rr = (k / COLS) | 0, cc = k % COLS;
              const cl = s.board[rr][cc];
              if (cl && cl.t === T.ORE && !inSet[k]) cells.push({ r: rr, c: cc });
            }
            cells = keepConnected(cells, r, c);
            log(s, '【共鸣】' + COLORS[color].name + '矿脉共振，波及整圈！');
          }
        }
      }
      // 【精准】：一次恰好挖 4 块时的额外奖励
      if (s.relicFlags.precisionBonus && cells.length === 4) ctx.extraGain += s.relicFlags.precisionBonus;
      gain = ctx.gain + ctx.extraGain;
      s.stats.biggest = Math.max(s.stats.biggest, cells.length);
    } else if (a.kind === 'pick') {
      s.stats.picks++;
      if (a.dmg) s.stats.hazards++;
      gain = 0;
      if (a.score) gain = Math.round(depthMul(s.depth) * s.relicFlags.scoreMul);
      if (a.group.length === 1 && s.board[r][c] && s.board[r][c].t === T.LAVA && s.relicFlags.lavaToGold) {
        gain += 12; log(s, '【熔炉】把岩浆炼成了 12 晶尘。');
      }
      s.air -= a.cost;
    } else if (a.kind === 'bonus') {
      const cell = s.board[r][c];
      if (cell.t === T.HEART) { gain = 12; s.air = Math.min(s.airMax, s.air + 1); log(s, '挖到矿脉之心：空气 +1。'); }
      else if (cell.t === T.CRYSTAL) { gain = CFG.crystalDust; s.air = Math.min(s.airMax, s.air + 1); s.dugCrystal++; log(s, '开采晶簇：空气 +1。'); }
      else if (cell.t === T.MAGNET) { gain = CFG.magnetDust; s.dugMagnet++; log(s, '拆掉磁石：+' + CFG.magnetDust + ' 晶尘，它不会再吞你的空间了。'); }
      else gain = 6;
      gain = Math.round(gain * s.relicFlags.scoreMul * (s.relicFlags.bonusMul || 1));
    }

    // 挖掘
    const dugCells = [];
    for (const p of cells) {
      const cell = s.board[p.r][p.c];
      if (!cell) continue;
      if (isElite(cell.t)) s.stats.elites++;
      if (cell.t === T.MAGNET && s.stats) s.stats.magnets = (s.stats.magnets || 0) + 1;
      if (cell.t === T.HEART) s.dugHeart++;
      if (cell.t === T.FOSSIL) s.dugFossil++;
      dugCells.push({ r: p.r, c: p.c, t: cell.t, col: cell.c });
      s.board[p.r][p.c] = null;
    }
    s.dugTotal += dugCells.length;
    // 下潜进度只认真正挖掉的矿脉：开凿(免费)不推进深度，否则可以零成本刷深度。
    // 例外是传说词条【点石成金】，它专门推翻这条规则。
    if (a.kind === 'dig') s.dugInLevel += dugCells.length;
    else if (s.relicFlags.pickProgress && a.score !== undefined) {
      // 【点石成金】：孤块开凿也能推进度，但不再是免费的（每次 1 点空气）。
      // 早期版本让开凿"既免费又推进度"，结果是可以零成本无限下潜（模拟器实测跑到 80 层）。
      s.dugInLevel += dugCells.length;
      s.air -= dugCells.length;
      ev(s, { type: 'breath', amount: dugCells.length });
    }
    // 体力（氧气）：挖掘本身是要花力气的 —— 这是整局的主要消耗来源
    const digEvery = Math.min(CFG.digCostCap,
      Math.max(3, CFG.digCostEvery + (s.relicFlags.digCostEvery || 0) + (s.meta.digCostBonus || 0)));
    const freeThisDig = a.kind === 'dig' && s.relicFlags.digFreeChance > 0 && s.rng.chance(s.relicFlags.digFreeChance);
    if (freeThisDig) log(s, '【双镐】这一镐没费力气。');
    if (!freeThisDig) s.airDebt += dugCells.length;
    let breath = 0;
    while (s.airDebt >= digEvery) { s.airDebt -= digEvery; breath++; }
    if (breath) { s.air -= breath; ev(s, { type: 'breath', amount: breath }); }
    if (a.kind === 'dig') s.dugOre += dugCells.length;
    s.dust += gain; s.runDust += gain;
    ev(s, { type: 'dig', cells: dugCells, gain, kind: a.kind });

    // 危险伤害
    let dmg = a.dmg || 0;
    if (a.kind === 'pick') dmg += 0;
    if (dmg > 0) {
      s.air -= dmg;
      ev(s, { type: 'damage', amount: dmg });
      log(s, '空气 -' + dmg + '（' + a.label + '）');
    }

    // 大地脉动 / 终焉：每累计挖 N 格自动引爆 K 处矿脉
    const f = s.relicFlags;
    if (f.pulseEvery || f.doomEvery) {
      const every = Math.min(f.pulseEvery || Infinity, f.doomEvery || Infinity);
      const times = f.doomEvery && every === f.doomEvery ? 3 : 1;
      s.pulseCounter += dugCells.length;
      if (s.pulseCounter >= every) {
        s.pulseCounter = 0;
        for (let i = 0; i < times && s.chainDepth < 3; i++) {
          const g = bestGroup(s);
          if (!g) break;
          log(s, '【' + (times > 1 ? '终焉' : '大地脉动') + '】自动引爆了一处矿脉');
          s.chainDepth++;
          const res = applyAction(s, g[0].r, g[0].c);
          s.chainDepth--;
          if (res && res.ok) return res;
        }
      }
    }
    // 【血脉】每累计挖 N 格，空气上限 +1（本局最多 +5）
    if (f.bloodlineEvery) {
      while (s.dugTotal >= (s._blood + 1) * f.bloodlineEvery && s._blood < 5) {
        s._blood++;
        s.airMax += 1;
        s.air += 1;
        log(s, '【血脉】空气上限 +1（本局已 +' + s._blood + '）。');
      }
    }

    // 自动连锁（塌方连锁）
    if (f.autoChain && s.chainDepth < 2) {
      const g = bestGroup(s);
      if (g && g.length >= f.autoChain) {
        log(s, '【连锁】矿脉自行崩落（' + g.length + ' 块）');
        s.chainDepth++;
        const res = applyAction(s, g[0].r, g[0].c);
        s.chainDepth--;
        if (res && res.ok) return res;
      }
    }

    if (s.air <= 0) {
      // doCollapse 返回 true 表示【时间倒流】救回来了，此时这一局还在继续，
      // 必须继续走 postDig（滚屏/下潜/死局保险），否则复活后可能停在一个被围死的盘面上。
      const revived = doCollapse(s);
      if (!revived) return { ok: true, collapsed: true, gain };
    }

    postDig(s);
    return { ok: true, gain, cells: dugCells.length };
  }

  function dedupe(cells) {
    const seen = {}, out = [];
    for (const p of cells) { const k = p.r * COLS + p.c; if (!seen[k]) { seen[k] = 1; out.push(p); } }
    return out;
  }

  /** 只保留与 (r0,c0) 4-连通的格子。保证任何一次挖掘留下的空腔都与矿道相连。 */
  function keepConnected(cells, r0, c0) {
    const set = {};
    for (const p of cells) set[p.r * COLS + p.c] = p;
    const seen = {}, out = [], st = [[r0, c0]];
    seen[r0 * COLS + c0] = 1;
    while (st.length) {
      const cur = st.pop();
      out.push({ r: cur[0], c: cur[1] });
      for (const d of DIRS) {
        const nr = cur[0] + d[0], nc = cur[1] + d[1];
        if (!inB(nr, nc)) continue;   // 必须先判界：否则 idx=nr*COLS+nc 会在网格边界环绕
        const k = nr * COLS + nc;
        if (seen[k] || !set[k]) continue;
        seen[k] = 1; st.push([nr, nc]);
      }
    }
    return out;
  }

  /** 盘面上是否存在至少一个合法操作 */
  function hasAnyAction(s) {
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = s.board[r][c];
      if (!cell || !isFrontier(s, r, c)) continue;
      if (actionFor(s, r, c).kind !== 'invalid') return true;
    }
    return false;
  }

  /** 死局保险：矿道被"不可挖"的图块（深岩 / 没【硬头】时的坚岩 / 以后扩展的图块）彻底围死时，
   *  用炸药在贴边处炸开一条路。
   *  两个关键点（都是实测踩出来的）：
   *    1. 只炸一块**不够** —— 如果炸掉的是第 0 行那种"四周本来就已经是空腔"的坚岩，
   *       炸了等于没炸，死局依旧。所以必须炸到 hasAnyAction 为真为止（上限 4 块，避免灾难性清盘）。
   *    2. 炸的一定是贴边格（4-邻接空腔或第 0 行），所以新空腔必然与矿道连通，
   *       不会破坏"矿道始终连通平巷"这条核心不变式。
   *  这条保险让"无死局"从"靠每个图块自觉"变成"由引擎保证"。 */
  function ensurePlayable(s) {
    if (hasAnyAction(s)) return false;
    const cand = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const cell = s.board[r][c];
      if (cell && isFrontier(s, r, c)) cand.push([r, c]);
    }
    if (!cand.length) return false;

    // 第一轮：**试炸再还原**，只炸"炸了确实能开出路"的那一块。
    // （早期版本是随机炸最多 4 格，实测会因为炸到第 0 行那种四周本来就是空腔的坚岩而白炸，
    //   9 个候选里漏掉唯一有效的那一块，死局照旧 —— 详见设计文档测试章节。）
    let pick = -1;
    for (let i = 0; i < cand.length; i++) {
      const p = cand[i], keep = s.board[p[0]][p[1]];
      s.board[p[0]][p[1]] = null;
      const ok = hasAnyAction(s);
      s.board[p[0]][p[1]] = keep;
      if (ok) { pick = i; break; }
    }
    const kinds = [];
    if (pick >= 0) {
      kinds.push(TNAME[s.board[cand[pick][0]][cand[pick][1]].t] || '岩层');
      s.board[cand[pick][0]][cand[pick][1]] = null;
      ev(s, { type: 'blast', r: cand[pick][0], c: cand[pick][1] });
      log(s, '⚠ 矿道被' + kinds[0] + '围死了，用炸药炸开了一条路。');
      return true;
    }
    // 第二轮：单炸一块怎么都没用（整片都是死块），那就从外往里连炸，直到能走。
    s.rng.shuffle(cand);
    let blasted = 0;
    for (const p of cand) {
      if (hasAnyAction(s)) break;
      kinds.push(TNAME[s.board[p[0]][p[1]].t] || '岩层');
      s.board[p[0]][p[1]] = null;
      ev(s, { type: 'blast', r: p[0], c: p[1] });
      blasted++;
    }
    if (!blasted) return false;
    log(s, '⚠ 矿道被' + kinds.join('/') + '整片围死，连炸 ' + blasted + ' 格才通。');
    return true;
  }

  function postDig(s) {
    // 挖到最底行 -> 盘面上滚，底部补新矿（下潜的视觉表现）
    let guard = 0;
    while (guard++ < 4 && s.board[ROWS - 1].some(x => x === null)) {
      s.board.shift();
      s.board.push(newRow(s));
      s.scrolls++;
      ev(s, { type: 'scroll' });
      if (s.relicFlags.minecartBonus) {
        const b = s.relicFlags.minecartBonus;
        s.dust += b; s.runDust += b;
        log(s, '【矿车】又往下推了一车，+' + b + ' 晶尘。');
      }
    }
    // 下潜判定
    const need = descendNeed(s);
    if (s.dugInLevel >= need) { s.dugInLevel -= need; doDescend(s); }
    ensurePlayable(s);                       // 死局保险（精英图块可能把矿道围死）
    if (s.phase === 'play' && s.pendingDraft > 0) openDraft(s);
  }

  function descendNeed(s) {
    // 15 层之后额外加二次项：早期的线性增长被词条折减抵消后依然能无限下潜，
    // 二次项保证"越深越挖不动"，把长局收敛在 20~30 层。
    const over = Math.max(0, s.depth - 15);
    const raw = Math.min(CFG.descendBase + CFG.descendPerDepth * (s.depth - 1) + 0.5 * over * over, CFG.descendCap);
    const ascT = 1 + ASCENSION.thresholdAdd(s.ascension || 0);
    return Math.max(6, Math.round(raw * s.relicFlags.thresholdMul * ascT));
  }

  function doDescend(s) {
    s.depth++;
    s._quota = { crystal: 0, heart: 0 };      // 新的一层，补给配额重置
    let heal = CFG.healDescend + s.relicFlags.healBonus + s.meta.healBonus;
    // 深处空气稀薄：越深恢复越少。没有这条，堆满回气词条后每层净收益为正，
    // 会滚成 80 层、20 分钟一局的怪物（模拟器实测），"消磨时光"就变成了"被时光消磨"。
    if (s.depth >= CFG.thinAirFromDepth) heal = Math.max(1, Math.floor(heal / 2));
    s.air = Math.min(s.airMax, s.air + heal);
    s.pendingDraft++;
    ev(s, { type: 'descend', depth: s.depth });
    log(s, '下潜至深度 ' + s.depth + '，空气 +' + heal + '。');

    // 岩浆扩散：压力来源
    const spread = s.relicFlags.lavaSlow ? 0 : CFG.lavaSpread(s.depth);
    let done = 0, guard = 0;
    while (done < spread && guard++ < 30) {
      const lava = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const cell = s.board[r][c];
        if (cell && cell.t === T.LAVA) lava.push([r, c]);
      }
      if (!lava.length) break;
      const src = s.rng.pick(lava), nb = [];
      for (const d of DIRS) {
        const nr = src[0] + d[0], nc = src[1] + d[1];
        if (!inB(nr, nc)) continue;
        const cell = s.board[nr][nc];
        if (cell && cell.t === T.ORE) nb.push([nr, nc]);
      }
      if (!nb.length) { break; }
      const t = s.rng.pick(nb);
      const oc = s.board[t[0]][t[1]].c;
      s.board[t[0]][t[1]] = { t: T.LAVA };
      ev(s, { type: 'lava', r: t[0], c: t[1] });
      done++;
    }
    if (done) log(s, '岩浆蔓延了 ' + done + ' 格。');

    // ---- 精英危险矿的蔓延：它们的威胁是"会变糟"，所以玩家必须主动处理 ----
    // 深岩：每列最深的那块向下生长一格（永久改变矿道走向，逼迫改道）
    let grew = 0, g2 = 0;
    for (let c = 0; c < COLS; c++) {
      let deepest = -1;
      for (let r = ROWS - 1; r >= 0; r--) { const x = s.board[r][c]; if (x && x.t === T.DEEPSTONE) { deepest = r; break; } }
      if (deepest < 0) continue;
      const nr = deepest + 1;
      if (nr >= ROWS || g2 >= 3) continue;
      const tgt = s.board[nr][c];
      if (tgt && (tgt.t === T.ORE || tgt.t === T.POISON || tgt.t === T.LAVA)) {
        s.board[nr][c] = { t: T.DEEPSTONE };
        ev(s, { type: 'elite', kind: 'deepstone', r: nr, c: c });
        grew++; g2++;
      }
    }
    if (grew) log(s, '深岩向下生长了 ' + grew + ' 格。');

    // 毒气矿脉：每处把 1 个相邻矿石污染成沼气泡（越拖越糟）
    let infected = 0, g3 = 0;
    for (let r = 0; r < ROWS && g3 < 3; r++) for (let c = 0; c < COLS && g3 < 3; c++) {
      const cell = s.board[r][c];
      if (!cell || cell.t !== T.GASVEIN) continue;
      const nb = [];
      for (const d of DIRS) {
        const nr = r + d[0], nc = c + d[1];
        if (!inB(nr, nc)) continue;
        const x = s.board[nr][nc];
        if (x && x.t === T.ORE) nb.push([nr, nc]);
      }
      if (!nb.length) continue;
      const t = s.rng.pick(nb);
      s.board[t[0]][t[1]] = { t: T.POISON };
      ev(s, { type: 'elite', kind: 'gasvein', r: t[0], c: t[1] });
      infected++; g3++;
    }
    if (infected) log(s, '毒气矿脉污染了 ' + infected + ' 格矿石。');

    // 磁石：每处把 1 个相邻矿石吞成坚岩 —— 它吃的是"空间"本身。
    // 这是第四个精英，设计上和深岩/毒气形成三角：
    //   深岩 = 挖不掉（改变路线）／毒气 = 会传染（变本加厉）／磁石 = 吃掉空间（地图缩小）
    // 玩家必须权衡：花 2 点空气 + 一格镐击拆掉它（还有 90 晶尘），还是绕开让它继续吃。
    let eaten = 0, g4 = 0;
    for (let r = 0; r < ROWS && g4 < 2; r++) for (let c = 0; c < COLS && g4 < 2; c++) {
      const cell = s.board[r][c];
      if (!cell || cell.t !== T.MAGNET) continue;
      const nb = [];
      for (const d of DIRS) {
        const nr = r + d[0], nc = c + d[1];
        if (!inB(nr, nc)) continue;
        const x = s.board[nr][nc];
        if (x && x.t === T.ORE) nb.push([nr, nc]);
      }
      if (!nb.length) continue;
      const t = s.rng.pick(nb);
      s.board[t[0]][t[1]] = { t: T.BEDROCK };
      ev(s, { type: 'elite', kind: 'magnet', r: t[0], c: t[1] });
      eaten++; g4++;
    }
    if (eaten) log(s, '磁石吞掉了 ' + eaten + ' 格矿石（变成坚岩）。');

    // 【通风井】：每下潜 N 层额外弹一次三选一
    if (s.relicFlags.extraDraftEvery && s.depth % s.relicFlags.extraDraftEvery === 0) {
      s.pendingDraft++;
      log(s, '【通风井】又送来一次选择。');
    }

    // 词条钩子
    for (const id of s.relics) {
      const R = (root.Vein.RELICS || []).find(x => x.id === id);
      if (R && R.onDescend) R.onDescend({ s, rng: s.rng, log: (m) => log(s, m) });
    }
  }

  function openDraft(s) {
    if (s.phase === 'draft') return;
    s.pendingDraft = Math.max(0, s.pendingDraft - 1);
    s.phase = 'draft';
    s.draft = draftOptions(s, 3);
    if (!s.draft.length) { s.phase = 'play'; }
  }

  function draftOptions(s, n) {
    const pool = root.Vein.RELICS || [];
    const owned = {};
    for (const id of s.relics) owned[id] = 1;
    const luck = 1 + 0.5 * (s.meta.luck || 0);
    const weight = (R) => (R.rarity === 2 ? 8 * luck : R.rarity === 1 ? 26 * luck : 66) * (R.minDepth && s.depth < R.minDepth ? 0 : 1);
    const unl = s.meta && s.meta.unlocked;
    const cand = pool.filter(R =>
      (!unl || unl[R.id]) &&                                   // 只抽已解锁的词条
      !(R.unique && owned[R.id]) &&
      (s.relics.filter(x => x === R.id).length < (R.maxStack == null ? (R.unique ? 1 : CFG.defaultMaxStack) : R.maxStack)));
    const out = [];
    while (out.length < n && cand.length) {
      let total = 0; for (const R of cand) total += weight(R);
      let x = s.rng.next() * total, chosen = cand[cand.length - 1];
      for (const R of cand) { x -= weight(R); if (x <= 0) { chosen = R; break; } }
      out.push(chosen.id);
      cand.splice(cand.indexOf(chosen), 1);
    }
    return out;
  }

  function takeRelic(s, id) {
    if (s.phase === 'draft' && s.draft.indexOf(id) < 0) return false;
    const R = (root.Vein.RELICS || []).find(x => x.id === id);
    if (!R) return false;
    s.relics.push(id);
    if (R.charges) s.charges[id] = (s.charges[id] || 0) + R.charges;
    recomputeFlags(s);
    syncAirMax(s);
    log(s, '获得词条【' + R.name + '】');
    ev(s, { type: 'relic', id });
    if (R.onAcquire) R.onAcquire({ s, rng: s.rng, log: (m) => log(s, m) });
    s.phase = 'play'; s.draft = [];
    if (s.pendingDraft > 0) openDraft(s);
    return true;
  }

  function skipDraft(s) {
    const gold = Math.round(10 * depthMul(s.depth));
    s.dust += gold; s.runDust += gold;
    log(s, '跳过词条，换取 ' + gold + ' 晶尘。');
    s.phase = 'play'; s.draft = [];
    if (s.pendingDraft > 0) openDraft(s);
  }

  function useActive(s, id, arg) {
    const R = (root.Vein.RELICS || []).find(x => x.id === id);
    if (!R || !R.active) return { ok: false, reason: '不可主动使用' };
    if ((s.charges[id] || 0) <= 0) return { ok: false, reason: '次数已用尽' };
    if (s.phase !== 'play') return { ok: false, reason: '先处理当前选择' };
    const res = R.active({ s, rng: s.rng, arg, log: (m) => log(s, m), ev: (e) => ev(s, e) });
    if (res === false) return { ok: false, reason: '无法使用' };
    s.charges[id]--;
    recomputeFlags(s);
    return { ok: true };
  }

  /** 空气上限 = 基础 + 永久强化 + 词条修正 */
  function syncAirMax(s) {
    const max = Math.max(3, CFG.maxAir + (s.meta.startAirBonus || 0) + (s.relicFlags.airMaxB || 0));
    s.airMax = max;
    if (s.air > max) s.air = max;
  }

  /* ---------------- 塌方 ---------------- */
  function doCollapse(s) {
    const f = s.relicFlags;
    if (f.revive && !s._revived) {
      s._revived = true;
      s.air = Math.max(3, Math.round(s.airMax * 0.5));
      log(s, '【时间倒流】矿洞塌了，但你活了下来。');
      ev(s, { type: 'revive' });
      return true;                 // 救回来了：本局继续
    }
    const lost = Math.floor(s.runDust * CFG.collapseDustLoss);
    s.runDust -= lost; s.dust = Math.max(0, s.dust - lost);
    s.collapses++;
    s.air = 0;
    s.dead = true;
    s.phase = 'over';          // 塌方 = 本局结束。带走一半晶尘，剩下的一半埋在矿里。
    s.draft = [];
    ev(s, { type: 'collapse', lost, depth: s.depth });
    log(s, '⚠ 塌方！你被埋在深度 ' + s.depth + '。损失 ' + lost + ' 晶尘。');
    return false;                  // 本局结束
  }

  /* ---------------- 升井结算 ---------------- */
  function ascend(s) {
    const banked = s.runDust;
    ev(s, { type: 'ascend' });
    return {
      depth: s.depth, dust: s.dust, banked, dugTotal: s.dugTotal, dugOre: s.dugOre,
      collapses: s.collapses, relics: s.relics.slice(), scrolls: s.scrolls, dead: !!s.dead,
      clicks: s.stats.clicks, biggest: s.stats.biggest, picks: s.stats.picks, hazards: s.stats.hazards,
      elites: s.stats.elites, hearts: s.dugHeart, fossils: s.dugFossil, crystals: s.dugCrystal,
      seed: s.seed
    };
  }

  /* ---------------- 导出 ---------------- */
  root.Vein = {
    COLS, ROWS, T, TNAME, COLORS, RARITY, CFG, UPGRADES, ASCENSION, UNLOCK_COST,
    STRATA, stratumOf,
    makeRng, hash2, colorCount,
    newRun, newBoard, cellAt, isEmpty, isFrontier, sameGroup, allFrontierGroups, bestGroup,
    actionFor, applyAction, ascend, takeRelic, skipDraft, useActive, descend: doDescend, syncAirMax,
    descendNeed, depthMul, groupDust, recomputeFlags, draftOptions, hasFreeDig,
    setRelics(list) { root.Vein.RELICS = list; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
