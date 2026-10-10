/* =====================================================================
 * 矿脉 Deep Vein — 渲染 / 交互 / 元进程
 * 双画布：下层像素画布（480x270，最近邻放大）画世界；上层 UI 画布画文字，
 * 这样中文在放大后依然清晰。
 * ===================================================================== */
'use strict';
(function () {
  const V = globalThis.Vein, A = globalThis.VeinArt, S = globalThis.VeinAudio;

  const W = 640, H = 360;
  const BOARD_X = 16, BOARD_Y = 64, TILE = 32, PX = 4;
  const PANEL_X = 252, PANEL_Y = 56, PANEL_W = 372;

  /* ---------------- 画布 ---------------- */
  const cv = document.getElementById('game'), ctx = cv.getContext('2d');
  const ui = document.getElementById('ui'), uctx = ui.getContext('2d');
  let SCALE = 1;
  cv.width = W; cv.height = H;
  ctx.imageSmoothingEnabled = false;

  function resize() {
    const pad = 24;
    SCALE = Math.max(1, Math.min(4, Math.floor(Math.min((innerWidth - pad) / W, (innerHeight - pad) / H))));
    const dw = W * SCALE, dh = H * SCALE;
    cv.style.width = dw + 'px'; cv.style.height = dh + 'px';
    ui.style.width = dw + 'px'; ui.style.height = dh + 'px';
    ui.width = dw; ui.height = dh;
    uctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    uctx.textBaseline = 'alphabetic';
  }
  addEventListener('resize', resize); resize();

  /* ---------------- 元进程存档 ---------------- */
  const SAVE_KEY = 'deepvein.meta.v1';
  const memStore = {};
  function loadRaw(k) { try { return localStorage.getItem(k); } catch (e) { return memStore[k] || null; } }
  function saveRaw(k, v) { try { localStorage.setItem(k, v); } catch (e) { memStore[k] = v; } }
  function defaultMeta() {
    const up = {}; V.UPGRADES.forEach(u => up[u.id] = 0);
    const unlocked = {}; V.RELICS.forEach(r => { if (r.start) unlocked[r.id] = 1; });
    return {
      dust: 0, upgrades: up, bestDepth: 0, bestDust: 0, runs: 0, totalDust: 0, muted: false,
      achievements: {},          // id -> 解锁时间戳
      relicSeen: {},             // id -> 1（"图鉴全开"成就用）
      daily: null,               // { date, bestDepth, bestDust, tries }
      dailyCount: 0,             // 完成过的每日挑战次数
      unlocked: unlocked,        // 已解锁（可出现在三选一里）的词条
      ascension: 0,              // 本次下井选择的深渊等级
      ascMax: 0,                 // 已解锁的最高深渊等级
      tutorialDone: false,       // 新手教学是否已完成
      shopTab: 'up'              // 商店当前页签
    };
  }

  /* ---------------- 每日种子 ----------------
   * 用当天日期派生一个固定种子，所有人当天玩到的是同一座矿（可以互相报成绩、比谁挖得深）。
   * 先做一次混淆，否则相邻日期的矿会长得很像。 */
  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function dailySeed() {
    let x = todayKey() >>> 0;
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return (x % 900000) + 100000;    // 6 位种子，方便口头/截图分享
  }
  function todayLabel() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  let meta = defaultMeta();
  try {
    const raw = loadRaw(SAVE_KEY);
    if (raw) {
      const d = defaultMeta(), saved = JSON.parse(raw);
      meta = Object.assign(d, saved);
      // 老存档没有 unlocked：按已见到的词条 + 起步集合补齐，避免把玩家的词条池清空
      if (!saved.unlocked) { meta.unlocked = d.unlocked; for (const id in (saved.relicSeen || {})) meta.unlocked[id] = 1; }
    }
  } catch (e) { }
  function save() { saveRaw(SAVE_KEY, JSON.stringify(meta)); }
  S.setMuted(!!meta.muted);

  /* ---------------- 应用状态 ---------------- */
  const App = {
    mode: 'title', run: null, hover: null, hoverGroup: null,
    particles: [], floats: [], shake: 0, flash: 0, flashColor: '#ff2a2a',
    swapFrom: null, selRelic: null, t: 0, lastResult: null, hoverBtn: null, msg: null, msgT: 0
  };
  let buttons = {};     // 每帧重建的点击热区（注意是 let：每帧会被整体替换）
  /** 侧栏/盘面这类「基础层」控件用这个注册；弹窗打开时它什么都不注册。
   *  原因见 renderFrame 里的 App.modal 注释：曾经「说明页的返回」被底下的「升井」吃掉。 */
  const regBase = (k, v) => { if (!App.modal) buttons[k] = v; };

  /** 启动时静默检查更新：失败/离线一律忽略，绝不打扰玩家 */
  function checkUpdate(force) {
    const U = globalThis.VeinUpdate;
    if (!U) return Promise.resolve(null);
    return U.check({ force: !!force }).then(r => {
      App.updateResult = r;
      if (force) {
        if (!r.ok) toast(r.error === 'timeout' ? '检查超时，稍后再试' : '检查失败：可能没联网');
        else if (r.hasNew) toast('发现新版本 v' + r.latest);
        else toast('已是最新版本 v' + U.VERSION);
      }
      return r;
    });
  }

  function toast(t) { App.msg = t; App.msgT = 2.2; }
  function newSeed() { return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0; }

  /** 出发装备：从已解锁词条里随机 3 条供选择 */
  function pickStartOffer() {
    const pool = V.RELICS.filter(r => meta.unlocked[r.id]);
    const out = [];
    while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0].id);
    return out;
  }

  function startRun(opts) {
    opts = opts || {};
    const daily = !!opts.daily;
    // 买了「出发装备槽」就先进选择界面（每日挑战不带装备，保证同一天条件一致）
    if (!daily && !opts.noPick && (meta.upgrades.slot || 0) > 0) {
      const offer = pickStartOffer();
      if (offer.length) {
        App.startOffer = offer;
        App.pendingRun = { daily: daily };
        App.mode = 'startpick';
        return;
      }
    }
    beginRun(daily, null);
  }

  function beginRun(daily, startRelic) {
    App.daily = daily;
    const seed = daily ? dailySeed() : newSeed();
    App.startOffer = null; App.pendingRun = null;
    App.run = V.newRun(seed, { upgrades: meta.upgrades, ascension: meta.ascension || 0,
                              unlocked: meta.unlocked, startRelic: startRelic || null });
    App.mode = App.run.phase === 'draft' ? 'draft' : 'play';
    App.particles.length = 0; App.floats.length = 0;
    App.cave = {};
    App.achBanner = null;
    meta.runs++;
    // 第一次下井自动进入教学（每日挑战不教学）
    if (!meta.tutorialDone && !daily && !opts0SkipTut()) { App.tut = { on: true, step: 0 }; prepTutorialBoard(App.run); }
    if (daily) {
      const key = todayKey();
      if (!meta.daily || meta.daily.date !== key) meta.daily = { date: key, bestDepth: 0, bestDust: 0, tries: 0 };
      meta.daily.tries++;
    }
    save();
    S.unlock(); S.startDrone();
  }

  function opts0SkipTut() { return App.skipTutorialOnce === true; }

  /** 教学首局：把盘面改成"一定有东西可教"的样子（4 连块 / 孤块 / 沼气泡各一处） */
  function prepTutorialBoard(s) {
    s.rng2 = null;
    // 第 0 行：一条 4 连的赤铁，保证第一步能教"整片挖掉"
    for (let c = 1; c <= 4; c++) s.board[0][c] = { t: V.T.ORE, c: 0 };
    // 第 1 行：一个孤块（周围都是不同色），教"开凿"
    s.board[1][5] = { t: V.T.ORE, c: 1 };
    if (s.board[0][5] && s.board[0][5].t === V.T.ORE) s.board[0][5] = { t: V.T.ORE, c: 2 };
    if (s.board[2][5] && s.board[2][5].t === V.T.ORE) s.board[2][5] = { t: V.T.ORE, c: 2 };
    if (s.board[1][4] && s.board[1][4].t === V.T.ORE) s.board[1][4] = { t: V.T.ORE, c: 3 };
    if (s.board[1][6] && s.board[1][6].t === V.T.ORE) s.board[1][6] = { t: V.T.ORE, c: 3 };
    // 第 2 行：一个沼气泡守在必经之路上，教"危险矿要付代价"
    s.board[2][2] = { t: V.T.POISON };
    s.board[2][1] = { t: V.T.ORE, c: 4 };
    s.board[2][3] = { t: V.T.ORE, c: 4 };
  }

  const TUT = [
    { text: '点亮的那 4 块是同一色 —— 点一下，整片一起挖掉。', pick: s => largestGroup(s), done: s => s.dugOre >= 4 },
    { text: '孤块没有同色邻居，只能「开凿」：不费力气，也不推进度。', pick: s => loneOre(s), done: s => s.stats.picks >= 1 },
    { text: '沼气泡是危险矿：凿开它要付出代价（空气 -1）。', pick: s => firstOfType(s, V.T.POISON), done: s => s.stats.hazards >= 1 },
    { text: '空气就是命 —— 挖矿每 6 格耗 1 点，空气见底就是塌方。', pick: s => null, done: s => s.dugTotal >= 30 },
    { text: '挖够进度就下潜一层，并三选一条「矿脉法则」。', pick: s => null, done: s => s.relics.length >= 1 },
    { text: '随时可以「升井」把晶尘带回地面，换永久强化。贪心会死。', pick: s => null, focus: 'btn:ascend', done: () => false }
  ];
  function largestGroup(s) { const g = V.bestGroup(s); return g && g.length >= 3 ? g : null; }
  function loneOre(s) {
    for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) {
      const x = s.board[r][c];
      if (x && x.t === V.T.ORE && V.isFrontier(s, r, c) && V.sameGroup(s, r, c).length === 1) return [{ r, c }];
    }
    return null;
  }
  function firstOfType(s, t) {
    for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) {
      const x = s.board[r][c];
      if (x && x.t === t && V.isFrontier(s, r, c)) return [{ r, c }];
    }
    return null;
  }

  function tutStep() {
    if (!App.tut || !App.tut.on || !App.run) return null;
    return TUT[Math.min(App.tut.step, TUT.length - 1)];
  }
  /** 每个动作后推进教学；某一步的目标已经不存在时也自动跳过，避免卡住 */
  function tutAdvance() {
    const st = tutStep(); if (!st) return;
    if (st.done(App.run)) { App.tut.step++; if (App.tut.step >= TUT.length) endTutorial(true); return; }
    if (st.pick && !st.pick(App.run)) {
      App.tut.step++;
      if (App.tut.step >= TUT.length) endTutorial(true);   // 老版本这里漏了结束判断，步数会无限涨
    }
  }
  function endTutorial(finished) {
    App.tut = null;
    meta.tutorialDone = true;
    if (finished) { meta.dust += 120; save(); toast('教学完成，+120 晶尘'); }
    else save();
  }

  /** 教学覆盖层：把注意力聚到一处，其余压暗。文案一次只说一件事。 */
  function drawTutorial() {
    // 只在"正在下井"时显示：打开商店/说明/成就时不该还压着一层教学提示
    const st = tutStep(); if (!st || App.mode !== 'play') return;
    const s = App.run; if (!s) return;
    let box = null;
    if (st.focus === 'btn:ascend') {
      const b = buttons['btn:ascend'];
      if (b) box = { x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 };
    } else {
      const cells = st.pick(s);
      if (cells && cells.length) {
        let r0 = 99, c0 = 99, r1 = -1, c1 = -1;
        for (const p of cells) { r0 = Math.min(r0, p.r); c0 = Math.min(c0, p.c); r1 = Math.max(r1, p.r); c1 = Math.max(c1, p.c); }
        box = { x: BOARD_X + c0 * TILE - 3, y: BOARD_Y + r0 * TILE - 3,
                w: (c1 - c0 + 1) * TILE + 6, h: (r1 - r0 + 1) * TILE + 6 };
      }
    }
    // 压暗：只在"洞"的四周画四块暗色，中间保持原样
    uctx.fillStyle = 'rgba(4,5,9,0.60)';
    if (box) {
      uctx.fillRect(0, 0, W, Math.max(0, box.y));
      uctx.fillRect(0, box.y + box.h, W, H - box.y - box.h);
      uctx.fillRect(0, box.y, Math.max(0, box.x), box.h);
      uctx.fillRect(box.x + box.w, box.y, W - box.x - box.w, box.h);
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(App.t * 3));
      uctx.globalAlpha = 0.45 + 0.55 * pulse;
      uctx.fillStyle = C.gold;
      uctx.fillRect(box.x, box.y, box.w, 2); uctx.fillRect(box.x, box.y + box.h - 2, box.w, 2);
      uctx.fillRect(box.x, box.y, 2, box.h); uctx.fillRect(box.x + box.w - 2, box.y, 2, box.h);
      uctx.globalAlpha = 1;
    } else {
      uctx.fillRect(0, 0, W, H);
    }
    // 文案框放在**顶部**：底部右侧是侧栏按钮区，之前把提示和「跳过」放在那里，
    // 会正压在「升井 / 音效」上（热区重叠断言抓到的）。顶部除 HUD 外没有任何热区。
    const txtW = tw(st.text) + 58;
    const bx = Math.max(8, Math.min(W - txtW - 96, W / 2 - txtW / 2));
    frame(bx, 8, txtW, 30, 'rgba(10,12,18,0.96)', C.gold);
    tx((App.tut.step + 1) + '/' + TUT.length, bx + 10, 16, { c: C.dim2 });
    tx(st.text, bx + 48, 16, { c: C.ink });
    btn('btn:tutskip', W - 88, 12, 76, 22, '跳过', { center: 1 });
  }

  /** 对局中即时判定成就 */
  function checkLive() {
    const run = App.run; if (!run) return;
    for (const id of run.relics) meta.relicSeen[id] = 1;
    const got = globalThis.VeinAchievements.live(run, meta);
    if (got.length) {
      let sum = 0;
      for (const a of got) { meta.dust += a.reward; sum += a.reward; }
      meta.dust += 0;
      save();
      App.achBanner = { list: got.map(a => a.name + '  +' + a.reward), t: 4.0 };
      S.relic();
    }
  }

  /** 结算时判定成就 + 记录每日成绩 */
  function checkFinal(sum) {
    // 深渊天梯解锁：在 N 级升井达到指定深度，才允许选 N+1 级
    if (!sum.dead) {
      const need = V.ASCENSION.unlockDepth(meta.ascension || 0);
      if (sum.depth >= need && (meta.ascMax || 0) <= (meta.ascension || 0) && (meta.ascension || 0) < V.ASCENSION.max) {
        meta.ascMax = (meta.ascension || 0) + 1;
        App.ascUnlocked = meta.ascMax;
      }
    }
    const got = globalThis.VeinAchievements.final(sum, meta);
    for (const a of got) meta.dust += a.reward;
    if (got.length) App.achBanner = { list: got.map(a => a.name + '  +' + a.reward), t: 4.5 };
    if (App.daily && meta.daily && meta.daily.date === todayKey()) {
      if (sum.depth > (meta.daily.bestDepth || 0)) meta.daily.bestDepth = sum.depth;
      if (sum.banked > (meta.daily.bestDust || 0)) meta.daily.bestDust = sum.banked;
      meta.dailyCount = (meta.dailyCount || 0) + 1;
    }
    save();
  }

  /* ---------------- 粒子 / 飘字 ---------------- */
  function burst(r, c, color, n) {
    const x = BOARD_X + c * TILE + TILE / 2, y = BOARD_Y + r * TILE + TILE / 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 18 + Math.random() * 62;
      App.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 18, life: 0.35 + Math.random() * 0.35, max: 0.7, col: color, sz: 1 + Math.random() * 2 });
    }
  }
  function float(x, y, text, col) { App.floats.push({ x, y, text, col, life: 0.9, max: 0.9 }); }

  function handleEvents() {
    const s = App.run; if (!s) return;
    const evs = s.events.splice(0);
    for (const e of evs) {
      if (e.type === 'dig') {
        const st = A.ORE_STYLE;
        for (const c of e.cells) {
          const col = c.t === 0 ? st[c.col % 5].pal : (A.HAZARD_STYLE[c.t] ? A.HAZARD_STYLE[c.t].pal : 'bedrock');
          burst(c.r, c.c, A.P[col][2], c.t === 0 ? 5 : 8);
        }
        addCave(e.cells);
        if (e.gain) float(BOARD_X + (e.cells[0] ? e.cells[0].c : 0) * TILE + TILE / 2, BOARD_Y + (e.cells[0] ? e.cells[0].r : 0) * TILE, '+' + e.gain, '#ffe89a');
        App.shake = Math.min(7, App.shake + e.cells.length * 0.35);
        if (e.kind === 'dig') S.dig(e.cells.length); else S.pick();
      } else if (e.type === 'damage') {
        App.flash = 0.5; App.flashColor = '#ff3b30'; App.shake = 6; S.hurt();
        float(BOARD_X + 60, BOARD_Y + 30, '-' + e.amount + ' 空气', '#ff7b6b');
      } else if (e.type === 'breath') { S.breath(); }
      else if (e.type === 'descend') { App.flash = 0.35; App.flashColor = '#9ff0d0'; S.descend(); }
      else if (e.type === 'collapse') {
        App.shake = 16; App.flash = 0.9; App.flashColor = '#c0392b'; S.collapse();
        App.mode = 'over'; App.lastResult = V.ascend(App.run); checkFinal(App.lastResult);
      }
      else if (e.type === 'relic') { S.relic(); }
      else if (e.type === 'lava') { App.shake = 2; S.lava(); }
      else if (e.type === 'invalid') { S.deny(); App.shake = 2; }
    }
  }

  /* =====================================================================
   * 渲染层 v2 —— 640x360 内部画布 · 点阵字体 · 图标驱动
   * 设计原则（参考 HUD 设计的三条基本功：清晰 / 层级 / 克制）：
   *   1. 能用图标和数字说清楚的，绝不用文字。
   *   2. 每块信息只出现一次，不重复。
   *   3. 正文最小 16px 点阵 —— 这条硬约束逼着文案变短（老版本 9px 的小字能塞下，
   *      于是侧栏就变成了一堵字墙）。
   * ===================================================================== */
  const C = {
    bg: '#0a0c12', ink: '#e8edf5', dim: '#98a2b8', dim2: '#5f6980',
    gold: '#f0c04a', gold2: '#7a5c1c', green: '#7ee0a8', blue: '#7ec8ff',
    red: '#ff7b6b', purple: '#c79bff',
    panel: '#151a26', panel2: '#1e2434', line: '#333d54', line2: '#232b3d'
  };
  const P = globalThis.PixFont;

  /** 跳过三选一的补偿（与 core.skipDraft 的公式保持一致） */
  function skipGold(s) { return Math.round(10 * V.depthMul(s.depth)); }

  /* ---------------- 文字（全部走点阵字库） ---------------- */
  /** 字号策略：**统一 16px，不再用 8px 小号字表。**
   *  8px 的拉丁在 640×360 里放大后发虚、看不清（实测就是"生命数字太小"的元凶）。
   *  16px 是这套点阵字库的基准尺寸，一笔一画都清晰；需要强调就整体 ×2 或 ×3。 */
  function pick() { return 'c16'; }
  function tx(s, x, y, opt) {
    opt = opt || {};
    return P.draw(uctx, String(s), x, y, {
      size: pick(s, opt.small), scale: opt.k || 1,
      color: opt.c || C.ink, align: opt.a || opt.align || 'left', spacing: opt.sp || 0
    });
  }
  function tw(s, small, k) { return P.measure(String(s), pick(s, small), k || 1); }
  function para(s, x, y, maxW, opt) {
    opt = opt || {};
    return P.para(uctx, String(s), x, y, maxW, { size: pick(s, opt.small), scale: opt.k || 1, color: opt.c || C.ink, align: opt.a || opt.align, leading: opt.lead || 0 });
  }

  /** 像素描边框：四角缺一格，看起来像一整块矿石切出来的面板 */
  function frame(x, y, w, h, fill, border) {
    uctx.fillStyle = fill; uctx.fillRect(x, y, w, h);
    if (!border) return;
    uctx.fillStyle = border;
    uctx.fillRect(x + 2, y, w - 4, 1); uctx.fillRect(x + 2, y + h - 1, w - 4, 1);
    uctx.fillRect(x, y + 2, 1, h - 4); uctx.fillRect(x + w - 1, y + 2, 1, h - 4);
    uctx.fillRect(x + 1, y + 1, 1, 1); uctx.fillRect(x + w - 2, y + 1, 1, 1);
    uctx.fillRect(x + 1, y + h - 2, 1, 1); uctx.fillRect(x + w - 2, y + h - 2, 1, 1);
  }

  /** 按钮：图标 + 短标签。accent 决定描边色。 */
  function btn(id, x, y, w, h, label, opt) {
    opt = opt || {};
    const hov = App.hoverBtn === id;
    const accent = opt.accent || C.line;
    uctx.fillStyle = hov ? C.panel2 : C.panel; uctx.fillRect(x, y, w, h);
    uctx.fillStyle = hov ? accent : (opt.dim ? C.line2 : C.line);
    uctx.fillRect(x + 2, y, w - 4, 1); uctx.fillRect(x + 2, y + h - 1, w - 4, 1);
    uctx.fillRect(x, y + 2, 1, h - 4); uctx.fillRect(x + w - 1, y + 2, 1, h - 4);
    const ty = y + Math.floor((h - 16) / 2);
    const k = opt.k || 1;
    if (opt.icon) {
      A.drawSprite(uctx, opt.icon.shape, opt.icon.pal, x + 6, y + Math.floor((h - 8) / 2), 1, 1);
      if (label) tx(label, x + 18, ty, { c: hov ? C.gold : C.dim, k: k });
    } else if (label) {
      tx(label, opt.center ? x + w / 2 : x + 8, ty,
        { c: hov ? C.gold : C.dim, k: k, a: opt.center ? 'center' : 'left' });
    }
    // 适配自检：用渲染器回报的**实绘包围盒**判断有没有画出按钮。
    // （早期版本按"意图"推算，于是断言验证的是代码意图而不是渲染结果 —— 同一个 bug 两边一起错。）
    if (label && P.lastBox) {
      const lb = P.lastBox;
      if (lb.x < x + 3 || lb.x + lb.w > x + w - 3) {
        App.fitIssues = App.fitIssues || [];
        App.fitIssues.push(label + ' 实绘 ' + Math.round(lb.x) + '..' + Math.round(lb.x + lb.w) + '，按钮 ' + x + '..' + Math.round(x + w));
      }
    }
    // base = 属于"游戏进行中"的基础层控件：弹窗打开时不许注册热区，
    // 否则会被底下没清掉的按钮吃掉点击（真实 bug，见设计文档测试章节）。
    if (!opt.base || !App.modal) buttons[id] = { x: x, y: y, w: w, h: h, label: label };
    return { x: x, y: y, w: w, h: h };
  }

  /* ---------------- 绘制：世界 ---------------- */
  function drawBoard() {
    const s = App.run;
    ctx.save();
    if (App.shake > 0.1) ctx.translate((Math.random() - 0.5) * App.shake, (Math.random() - 0.5) * App.shake);
    // 平巷（入口横梁）
    ctx.fillStyle = '#05070c'; ctx.fillRect(BOARD_X - 6, BOARD_Y - 18, V.COLS * TILE + 12, 18);
    ctx.fillStyle = '#4a3520'; ctx.fillRect(BOARD_X - 6, BOARD_Y - 5, V.COLS * TILE + 12, 5);
    for (let c = 0; c < V.COLS + 1; c++) {
      ctx.fillStyle = c % 2 ? '#5c4227' : '#6b4c2e';
      ctx.fillRect(BOARD_X - 6 + c * TILE - 3, BOARD_Y - 18, 7, 15);
    }
    const res = s.relicFlags;
    const hintGroup = (res.hint && s.phase === 'play') ? V.bestGroup(s) : null;
    const hintSet = {};
    if (hintGroup) for (const p of hintGroup) hintSet[p.r * V.COLS + p.c] = 1;
    const hoverSet = {};
    if (App.hoverGroup) for (const p of App.hoverGroup) hoverSet[p.r * V.COLS + p.c] = 1;

    for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) {
      const x = BOARD_X + c * TILE, y = BOARD_Y + r * TILE;
      const cell = s.board[r][c];
      const n = V.hash2(c + 7, r + 3);
      if (cell === null) {
        ctx.fillStyle = n > 0.86 ? '#0c1120' : '#05070e';
        ctx.fillRect(x, y, TILE, TILE);
        if (n > 0.93) { ctx.fillStyle = '#1a2132'; ctx.fillRect(x + 4 + (n * 16 | 0), y + 5 + (n * 12 | 0), 3, 3); }
      } else {
        ctx.fillStyle = n > 0.72 ? '#3a2c1c' : (n > 0.38 ? '#31251a' : '#2a1f16');
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = '#170f0a';
        ctx.fillRect(x, y + TILE - 2, TILE, 2); ctx.fillRect(x + TILE - 2, y, 2, TILE);
        ctx.fillStyle = 'rgba(255,255,255,0.045)';
        ctx.fillRect(x, y, TILE, 2);
      }
    }
    for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) {
      if (s.board[r][c] !== null) continue;
      const x = BOARD_X + c * TILE, y = BOARD_Y + r * TILE;
      const solid = (rr, cc) => rr < 0 || rr >= V.ROWS || cc < 0 || cc >= V.COLS || s.board[rr][cc] !== null;
      ctx.fillStyle = '#6b5334';
      if (solid(r - 1, c)) ctx.fillRect(x, y, TILE, 3);
      if (solid(r + 1, c)) ctx.fillRect(x, y + TILE - 3, TILE, 3);
      if (solid(r, c - 1)) ctx.fillRect(x, y, 3, TILE);
      if (solid(r, c + 1)) ctx.fillRect(x + TILE - 3, y, 3, TILE);
    }
    for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) {
      const cell = s.board[r][c]; if (!cell) continue;
      const st = A.cellStyle(cell); if (!st) continue;
      const x = BOARD_X + c * TILE, y = BOARD_Y + r * TILE;
      const front = V.isFrontier(s, r, c);
      A.drawSprite(ctx, st.shape, st.pal, x, y, PX, front ? 1 : 0.30);
      if (front) {
        const k = r * V.COLS + c;
        if (hoverSet[k]) {
          ctx.fillStyle = '#fff4c2'; ctx.globalAlpha = 0.26; ctx.fillRect(x, y, TILE, TILE); ctx.globalAlpha = 1;
          ctx.fillStyle = '#ffe89a';
          ctx.fillRect(x, y, TILE, 2); ctx.fillRect(x, y + TILE - 2, TILE, 2);
          ctx.fillRect(x, y, 2, TILE); ctx.fillRect(x + TILE - 2, y, 2, TILE);
        } else if (hintSet[k]) {
          ctx.fillStyle = 'rgba(255,232,154,0.42)';
          ctx.fillRect(x + 2, y + 2, 3, 3); ctx.fillRect(x + TILE - 5, y + 2, 3, 3);
          ctx.fillRect(x + 2, y + TILE - 5, 3, 3); ctx.fillRect(x + TILE - 5, y + TILE - 5, 3, 3);
        }
        if (cell.t === 6 || cell.t === 7 || cell.t === 8) {
          ctx.globalAlpha = 0.10 + 0.10 * Math.sin(App.t * 3 + r * 0.7 + c);
          ctx.fillStyle = cell.t === 6 ? '#7d6ba3' : (cell.t === 7 ? '#5bd6f0' : '#63a82c');
          ctx.fillRect(x, y, TILE, TILE); ctx.globalAlpha = 1;
        }
        if (cell.t === 2) {
          ctx.globalAlpha = 0.12 + 0.10 * Math.sin(App.t * 4 + r + c);
          ctx.fillStyle = '#ff8b2b'; ctx.fillRect(x, y, TILE, TILE); ctx.globalAlpha = 1;
        }
      }
    }
    for (const p of App.particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.col; ctx.fillRect(p.x | 0, p.y | 0, p.sz, p.sz); }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ---------------- 绘制：顶部状态条（图标 + 数字，没有一个字） ---------------- */
  function drawHud() {
    const s = App.run;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, 52);
    ctx.fillStyle = C.line2; ctx.fillRect(0, 51, W, 1);

    // 深度：镐 + 大号数字（k=2 = 32px）
    A.drawSprite(uctx, 'pick', 'steel', 12, 10, 2);
    tx(String(s.depth), 38, 6, { k: 2, c: C.gold });
    tx('层', 38 + tw(String(s.depth), false, 2) + 5, 20, { c: C.dim2 });
    if (meta.bestDepth > 0) {
      A.drawSprite(uctx, 'star', 'steel', 12, 34, 1, 0.5);
      tx(meta.bestDepth, 24, 32, { c: C.dim2 });
    }

    // 空气：分段条 + 16px 数字
    A.drawSprite(uctx, 'heart', 'teal', 132, 12, 2);
    const seg = Math.min(s.airMax, 14), sw = 8, gap = 2;
    const airCol = s.air <= 3 ? C.red : (s.air <= 6 ? C.gold : C.green);
    const pulse = s.air <= 3 ? (0.45 + 0.55 * Math.abs(Math.sin(App.t * 3.4))) : 1;
    for (let i = 0; i < seg; i++) {
      const x = 154 + i * (sw + gap), on = i < s.air;
      uctx.fillStyle = on ? airCol : '#1b2130';
      uctx.globalAlpha = on ? pulse : 1;
      uctx.fillRect(x, 12, sw, 22);
      if (on) { uctx.globalAlpha = pulse * 0.32; uctx.fillStyle = '#ffffff'; uctx.fillRect(x, 12, sw, 5); uctx.globalAlpha = 1; }
    }
    uctx.globalAlpha = 1;
    tx(Math.max(0, s.air) + '/' + s.airMax, 154 + seg * (sw + gap) + 8, 16, { c: C.ink });

    // 晶尘
    A.drawSprite(uctx, 'gem', 'yellow', 432, 12, 2);
    tx(s.dust, 456, 16, { c: C.gold });

    // 下潜进度
    A.drawSprite(uctx, 'ladder', 'steel', 540, 12, 2);
    tx(s.dugInLevel + '/' + V.descendNeed(s), 564, 16, { c: C.dim });
    const pw = 60;
    uctx.fillStyle = '#1b2130'; uctx.fillRect(540, 34, pw, 6);
    uctx.fillStyle = C.blue;
    uctx.fillRect(540, 34, Math.round(pw * Math.min(1, s.dugInLevel / V.descendNeed(s))), 6);

    // 每日徽标
    if (App.daily) {
      A.drawSprite(uctx, 'cal', 'blue', 300, 12, 2);
      tx('#' + s.seed, 324, 16, { c: C.blue });
      tx(todayLabel(), 324, 34, { c: C.dim2 });
    }
  }

  /* ---------------- 绘制：侧栏三张卡片 ---------------- */
  function drawPanel() {
    const s = App.run;
    frame(PANEL_X, PANEL_Y, PANEL_W, 130, C.panel, C.line2);          // 词条
    frame(PANEL_X, PANEL_Y + 138, PANEL_W, 100, C.panel, C.line2);    // 洞穴剖面
    frame(PANEL_X, PANEL_Y + 246, PANEL_W, 50, C.panel, C.line2);     // 按钮

    // --- 卡片 1：词条（符文网格，没有名字） ---
    A.drawSprite(uctx, 'rune', 'purple', PANEL_X + 8, PANEL_Y + 8, 1);
    tx('词条 ' + s.relics.length, PANEL_X + 22, PANEL_Y + 12, { c: C.dim });
    const perRow = 14, pitch = 25;
    s.relics.slice(0, 40).forEach((id, i) => {
      const R = V.RELICS.find(x => x.id === id); if (!R) return;
      const cx = PANEL_X + 9 + (i % perRow) * pitch, cy = PANEL_Y + 34 + Math.floor(i / perRow) * pitch;
      const cols = R.rarity === 2 ? ['#ffe9a8', '#e0b83a', '#7a5c1c']
        : R.rarity === 1 ? ['#cfe6ff', '#7ec8ff', '#2f5f8a'] : ['#dfe5f0', '#98a2b8', '#4a5261'];
      const hov = App.hoverRelic === id;
      if (hov) { uctx.fillStyle = C.panel2; uctx.fillRect(cx - 5, cy - 5, 22, 22); }
      A.drawRune(uctx, id, cx, cy, 2, cols);
      const ch = s.charges[id];
      if (ch > 0) { uctx.fillStyle = C.gold; uctx.fillRect(cx - 2, cy - 2, 2, 2); uctx.fillRect(cx + 16 - 2 + 2, cy - 2, 2, 2); }
      if (!App.modal) buttons['relic:' + id] = { x: cx - 5, y: cy - 5, w: 22, h: 22, relic: id };
    });
    if (s.relics.length === 0) tx('还没拿到词条', PANEL_X + 12, PANEL_Y + 50, { c: C.dim2 });

    // --- 卡片 2：洞穴剖面 + 上下文信息 ---
    const cy0 = PANEL_Y + 138;
    A.drawSprite(uctx, 'cart', 'steel', PANEL_X + 8, cy0 + 8, 1);
    tx('洞穴剖面', PANEL_X + 22, cy0 + 12, { c: C.dim });
    drawCave(PANEL_X + 12, cy0 + 34, 7, 10);
    // 右侧：悬停词条 -> 详情；否则 -> 最近两条事件
    const rx = PANEL_X + 120, rw = PANEL_W - 132;
    if (App.hoverRelic) {
      const R = V.RELICS.find(x => x.id === App.hoverRelic);
      if (R) {
        tx(R.name, rx, cy0 + 12, { c: R.rarity === 2 ? C.gold : (R.rarity === 1 ? C.blue : C.ink) });
        para(R.desc, rx, cy0 + 32, rw, { c: C.dim });
      }
    } else {
      const logs = s.log.slice(-2);
      logs.forEach((l, i) => para(l, rx, cy0 + 12 + i * 36, rw, { c: i === logs.length - 1 ? C.dim : C.dim2 }));
      if (!logs.length) tx('下井了。', rx, cy0 + 12, { c: C.dim2 });
    }

    // --- 卡片 3：按钮 ---
    const by = PANEL_Y + 250;
    // 「回地面」原来是这里的第 4 个按钮：它既没接上点击分支（点了没反应），
    // 功能又和「升井」后的结算页重复 —— 所以直接删掉，把主行动放大占满一行。
    const bw2 = Math.floor((PANEL_W - 16 - 4) / 2);
    btn('btn:ascend', PANEL_X + 8, by, PANEL_W - 16, 20, '升井结算  A', { base: 1, center: 1, icon: { shape: 'gem', pal: 'yellow' }, accent: C.gold });
    btn('btn:help', PANEL_X + 8, by + 22, bw2, 20, '说明 H', { base: 1, center: 1, icon: { shape: 'rune', pal: 'steel' } });
    btn('btn:mute', PANEL_X + 8 + bw2 + 4, by + 22, bw2, 20, meta.muted ? '音效 关 M' : '音效 开 M', { base: 1, center: 1, icon: { shape: 'star', pal: 'steel' } });
  }

  /** 洞穴剖面：每下潜一层记一行，记录这一层你挖开了哪几列。
   *  它既是"地图"也是"回忆"—— 一局挖完，这就是你亲手挖出来的那座矿。 */
  function drawCave(x, y, cols, maxRows) {
    const cave = App.cave || {};
    const depths = Object.keys(cave).map(Number).sort((a, b) => a - b);
    const list = depths.slice(-maxRows);
    const bs = 5, gap = 1;
    for (let i = 0; i < maxRows; i++) {
      const yy = y + i * (bs + gap);
      const dep = list.length - maxRows + i;
      const mask = dep >= 0 ? (cave[list[dep]] || 0) : 0;
      const isNow = dep >= 0 && list[dep] === App.run.depth - 1;
      for (let c = 0; c < cols; c++) {
        const xx = x + c * (bs + gap);
        const dug = (mask >> c) & 1;
        uctx.fillStyle = dug ? (isNow ? C.gold : '#6b5334') : '#12161f';
        uctx.fillRect(xx, yy, bs, bs);
        if (!dug) { uctx.fillStyle = '#1b2130'; uctx.fillRect(xx, yy, bs, 1); }
      }
      if (isNow) { uctx.fillStyle = C.gold; uctx.fillRect(x - 4, yy + 1, 2, bs - 2); }
    }
  }

  /* ---------------- 绘制：弹层与文字 ---------------- */
  function drawUi() {
    uctx.clearRect(0, 0, W, H);
    if (App.mode === 'title') { drawTitle(); return; }
    const s = App.run;
    if (!s) {
      if (App.mode === 'shop') drawShop();
      if (App.mode === 'help') drawHelp();
      if (App.mode === 'ach') drawAch();
      drawToast();
      return;
    }
    drawHud(); drawPanel();

    // 悬停预览
    if (App.hover && s.phase === 'play') {
      const a = V.actionFor(s, App.hover.r, App.hover.c);
      let label = '', col = C.dim;
      if (a.kind === 'dig') { label = a.group.length + ' 连块  +' + V.groupDust(s, a.group.length); col = C.gold; }
      else if (a.kind === 'pick') { label = a.label + (a.dmg ? '  -' + a.dmg : (a.cost ? '  -' + a.cost : '  0')); col = a.dmg ? C.red : C.green; }
      else if (a.kind === 'bonus') { label = a.label; col = C.purple; }
      else label = a.reason || '挖不了';
      if (label) {
        const px2 = BOARD_X + App.hover.c * TILE + TILE / 2, py = BOARD_Y + App.hover.r * TILE - 6;
        const w2 = tw(label) + 12;
        const bx = Math.max(4, Math.min(W - w2 - 4, px2 - w2 / 2));
        frame(bx, py - 20, w2, 22, 'rgba(6,8,14,0.94)', col);
        tx(label, bx + 6, py - 14, { c: col });
      }
    }
    for (const f of App.floats) {
      uctx.globalAlpha = Math.max(0, f.life / f.max);
      tx(f.text, f.x, f.y, { c: f.col, a: 'center' });
    }
    uctx.globalAlpha = 1;

    // 只在"对局中"画三选一：否则与商店/换色弹窗同时出现时，两套热区会互相重叠
    if (s.phase === 'draft' && (App.mode === 'play' || App.mode === 'draft')) drawDraft();
    if (App.mode === 'over') drawOver();
    if (App.mode === 'shop') drawShop();
    if (App.mode === 'help') drawHelp();
    if (App.mode === 'ach') drawAch();
    if (App.mode === 'swap') drawSwap();
    if (App.mode === 'startpick') drawStartPick();
    drawTutorial();
    drawToast();
    if (App.achBanner) drawAchBanner();
  }

  function drawToast() {
    if (App.msgT <= 0) return;
    const w3 = tw(App.msg) + 20;
    frame(W / 2 - w3 / 2, H - 34, w3, 24, 'rgba(8,10,16,0.94)', C.gold);
    tx(App.msg, W / 2, H - 26, { c: C.gold, a: 'center' });
  }

  function dimScreen(a) { uctx.fillStyle = 'rgba(4,5,9,' + a + ')'; uctx.fillRect(0, 0, W, H); }

  function drawDraft() {
    const s = App.run;
    dimScreen(0.74);
    tx('深度 ' + s.depth + ' · 选一条矿脉法则', W / 2, 26, { k: 2, c: C.gold, a: 'center' });
    tx('1 / 2 / 3 选择    空格跳过换 ' + skipGold(s), W / 2, 64, { c: C.dim2, a: 'center' });
    const cw = 186, ch = 208, gap = 15, x0 = (W - cw * 3 - gap * 2) / 2;
    s.draft.forEach((id, i) => {
      const R = V.RELICS.find(r => r.id === id); if (!R) return;
      const x = x0 + i * (cw + gap), y = 88;
      const hov = App.hoverBtn === 'draft:' + id;
      const acc = R.rarity === 2 ? C.gold : (R.rarity === 1 ? C.blue : C.line);
      frame(x, y, cw, ch, hov ? C.panel2 : C.panel, acc);
      uctx.fillStyle = acc; uctx.fillRect(x + 2, y + 2, cw - 4, 2);
      const cols = R.rarity === 2 ? ['#ffe9a8', '#e0b83a', '#7a5c1c']
        : R.rarity === 1 ? ['#cfe6ff', '#7ec8ff', '#2f5f8a'] : ['#dfe5f0', '#98a2b8', '#4a5261'];
      A.drawRune(uctx, id, x + 14, y + 16, 3, cols);
      tx(V.RARITY[R.rarity], x + cw - 12, y + 20, { c: acc, a: 'right' });
      tx(R.name, x + 14, y + 48, { k: 1, c: C.ink });
      uctx.fillStyle = C.line2; uctx.fillRect(x + 14, y + 72, cw - 28, 1);
      para(R.desc, x + 14, y + 84, cw - 28, { c: C.dim });
      tx('[' + (i + 1) + ']', x + 14, y + ch - 22, { c: C.dim2 });
      buttons['draft:' + id] = { x: x, y: y, w: cw, h: ch };
    });
    btn('btn:skip', W / 2 - 80, 306, 160, 22, '跳过换 ' + skipGold(s), { icon: { shape: 'gem', pal: 'yellow' } });
  }

  function drawOver() {
    const r = App.lastResult; if (!r) return;
    dimScreen(0.82);
    const px = 150, py = 40, pw = 340, ph = 250;
    frame(px, py, pw, ph, C.panel, r.dead ? C.red : C.gold);
    tx(r.dead ? '塌 方' : '升 井 结 算', W / 2, py + 20, { k: 2, c: r.dead ? C.red : C.gold, a: 'center' });
    const rows = [
      ['到达深度', r.depth + ' 层'], ['带走晶尘', '+' + r.banked], ['挖掉矿石', r.dugOre + ' 格'],
      ['获得词条', r.relics.length + ' 条'], ['最大连块', r.biggest + ' 块'], ['总点击', r.clicks + ' 次']
    ];
    rows.forEach((l, i) => {
      const y = py + 64 + i * 24;
      tx(l[0], px + 24, y, { c: C.dim2 });
      tx(l[1], px + pw - 24, y, { c: C.ink, a: 'right' });
    });
    if (App.daily) tx('每日 #' + (r.seed || 0) + '   今日最好 ' + ((meta.daily && meta.daily.bestDepth) || 0) + ' 层', W / 2, py + ph - 44, { c: C.blue, a: 'center' });
    btn('btn:again', px + 22, py + ph - 30, 138, 22, '再下一次 R', { accent: C.gold, icon: { shape: 'pick', pal: 'steel' } });
    btn('btn:home', px + pw - 160, py + ph - 30, 138, 22, '回地面 Esc', { icon: { shape: 'ladder', pal: 'steel' } });
  }

  /** 主页底部的装饰矿层带：用游戏自己的素材拼一幅"矿口"小景。
   *  设计要点（第一版做砸过一次）：**不能把矿石铺满** —— 30% 密度排成一条"糖果墙"，
   *  看起来像 bug 而不是风景。岩石要暗、矿石要稀、矿口要真的往下通。 */
  function drawTitleScene(y0) {
    const tile = 16, rows = Math.ceil((H - y0) / tile);
    for (let c = 0; c < W / tile; c++) for (let r = 0; r < rows; r++) {
      const x = c * tile, y = y0 + r * tile, n = V.hash2(c * 3 + 1, r * 7 + 2);
      const depth = r / rows;                       // 越靠下越暗，做出"往地下沉"的感觉
      ctx.fillStyle = n > 0.74 ? '#3a2c1d' : (n > 0.4 ? '#2f2418' : '#261d13');
      ctx.fillRect(x, y, tile, tile);
      if (depth > 0.25) { ctx.fillStyle = 'rgba(0,0,0,' + (depth * 0.26).toFixed(2) + ')'; ctx.fillRect(x, y, tile, tile); }
      ctx.fillStyle = '#120c07'; ctx.fillRect(x, y + tile - 1, tile, 1);
    }
    // 稀疏嵌入的矿石：整格只画 8px 的小晶体（密度约 8%），才像"岩壁里的矿脉"
    for (let c = 0; c < W / tile; c++) for (let r = 0; r < rows; r++) {
      const n = V.hash2(c * 11 + 5, r * 13 + 3);
      if (n > 0.86) {
        const ci = Math.floor(V.hash2(c * 7, r * 5) * 5) % 5, st = A.ORE_STYLE[ci];
        A.drawSprite(ctx, st.shape, st.pal, c * tile + 4, y0 + r * tile + 4, 1, 0.95);
      }
    }
    // 中央矿口：竖井 + 木支架（井口越往下越黑，读作"通到地下"）
    const ex = Math.round(W / 2 - 34), ew = 68;
    ctx.fillStyle = '#04060a'; ctx.fillRect(ex, y0 + 6, ew, rows * tile);
    for (let i = 0; i < rows * tile; i += 2) {
      ctx.fillStyle = 'rgba(0,0,0,' + Math.min(0.9, i / (rows * tile)).toFixed(2) + ')';
      ctx.fillRect(ex, y0 + 6 + i, ew, 2);
    }
    ctx.fillStyle = '#4a3520'; ctx.fillRect(ex - 7, y0 + 2, 7, rows * tile);
    ctx.fillStyle = '#5c4227'; ctx.fillRect(ex + ew, y0 + 2, 7, rows * tile);
    ctx.fillStyle = '#6b4c2e'; ctx.fillRect(ex - 7, y0, ew + 14, 7);
    ctx.fillStyle = '#8a6438'; ctx.fillRect(ex - 7, y0, ew + 14, 2);
    // 矿口暖光
    for (let i = 0; i < 4; i++) {
      ctx.globalAlpha = 0.045;
      ctx.fillStyle = '#ffd98a';
      ctx.fillRect(ex - 12 - i * 10, y0 - i * 4, ew + 24 + i * 20, rows * tile);
    }
    ctx.globalAlpha = 1;
    // 站在井口的矿工
    A.drawSprite(ctx, 'miner', 'steel', ex - 26, y0 + 4, 3);
    // 地表线：一条极暗的分界线，把装饰带和上面的菜单分开
    ctx.fillStyle = '#0a0d14'; ctx.fillRect(0, y0, W, 1);
  }

  function drawTitle() {
    // 背景：竖向渐变（上暗下更暗）+ 中央柔光，把视线压到中轴
    const g = ctx.createLinearGradient ? ctx.createLinearGradient(0, 0, 0, H) : null;
    if (g) { g.addColorStop(0, '#0c0f18'); g.addColorStop(0.55, '#080a11'); g.addColorStop(1, '#05060a'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    else { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); }
    for (let i = 0; i < 40; i++) {                        // 浮尘
      const n = V.hash2(i * 3, 7), y = ((n * H) + App.t * (4 + n * 10)) % (H - 60);
      ctx.fillStyle = n > 0.6 ? '#222a3a' : '#1a2130';
      ctx.fillRect((i * 61) % W, y, 2, 2);
    }

    // 标题：先画深色投影再画金色本体 —— 像素游戏最经典的双色标题处理
    tx('矿  脉', W / 2 + 3, 25, { k: 3, c: '#3d2c0a', a: 'center' });
    tx('矿  脉', W / 2, 22, { k: 3, c: C.gold, a: 'center' });
    tx('DEEP VEIN', W / 2, 78, { c: C.dim2, a: 'center', sp: 6 });
    tx('你消掉的不是方块，是空间。', W / 2, 100, { c: C.dim, a: 'center' });

    const dk = (meta.daily && meta.daily.date === todayKey()) ? meta.daily : null;
    const ascLv = meta.ascension || 0;
    const ascTxt = V.ASCENSION.name(ascLv) + (ascLv > 0 ? '（收益 ×' + V.ASCENSION.rewardMul(ascLv).toFixed(2) + '）' : '');
    tx(dk ? ('今日最好 ' + dk.bestDepth + ' 层 · ' + dk.bestDust + ' 晶尘 · 已试 ' + dk.tries + ' 次')
          : ('今日种子 #' + dailySeed() + '  ·  难度 ' + ascTxt),
      W / 2, 122, { c: C.blue, a: 'center' });
    if (!meta.tutorialDone) tx('首次下井会走一遍新手教学', W / 2, 142, { c: C.gold, a: 'center' });

    // 分隔线
    uctx.fillStyle = C.line2; uctx.fillRect(W / 2 - 130, 150, 260, 1);
    uctx.fillStyle = C.gold2; uctx.fillRect(W / 2 - 26, 150, 52, 1);

    // 主按钮
    btn('btn:start', W / 2 - 120, 162, 240, 28, '下 井   Enter', { accent: C.gold, center: 1, k: 1 });

    // 次级菜单：**整体居中**（老版本 60..420，在 640 宽里偏左 50px）
    const bw = 194, bh = 24, gap = 12, bx0 = W / 2 - (bw * 2 + gap) / 2;
    frame(bx0 - 14, 202, bw * 2 + gap + 28, 74, 'rgba(18,22,33,0.72)', C.line2);
    btn('btn:daily', bx0, 210, bw, bh, '每日挑战 D', { accent: C.blue, icon: { shape: 'cal', pal: 'blue' } });
    btn('btn:ach', bx0 + bw + gap, 210, bw, bh, '成就 ' + globalThis.VeinAchievements.unlockedCount(meta) + '/' + globalThis.VeinAchievements.count() + ' T', { accent: C.gold2, icon: { shape: 'star', pal: 'yellow' } });
    btn('btn:shop', bx0, 240, bw, bh, '地面商店 S', { accent: '#3f5f9f', icon: { shape: 'gem', pal: 'yellow' } });
    btn('btn:help', bx0 + bw + gap, 240, bw, bh, '玩法说明 H', { icon: { shape: 'rune', pal: 'steel' } });

    tx('晶尘 ' + meta.dust + '    最深 ' + meta.bestDepth + ' 层    下井 ' + meta.runs + ' 次    图鉴 '
      + Object.keys(meta.relicSeen || {}).length + '/' + V.RELICS.length, W / 2, 284, { c: C.dim2, a: 'center' });

    // 版本号常驻左上角（玩家反馈问题时能直接报版本）
    tx('v' + (globalThis.VeinUpdate ? globalThis.VeinUpdate.VERSION : '1.0.0'), 8, 8, { c: C.line2 });

    // 更新提示：两条来源 —— 远端有新版（去下载）/ Service Worker 已就绪（刷新即生效）
    const R = App.updateResult;
    if (globalThis.VeinSWWaiting) {
      btn('btn:reload', W / 2 - 130, 292, 260, 18, '新版本已就绪 · 点这里刷新', { center: 1, accent: C.green });
    } else if (R && R.ok && R.hasNew) {
      btn('btn:update', W / 2 - 130, 292, 260, 18,
          '新版本 v' + R.latest + ' 可用 · 点这里更新', { center: 1, accent: C.gold });
    }

    drawTitleScene(310);
    if (App.achBanner) drawAchBanner();
  }

  function drawAch() {
    dimScreen(0.95);
    // 按 16px 正文网格重排：标题 32px / 副标题 16px / 行距 20px。
    // 老版本把 16px 中文塞进 20px 行距还加了 2 倍缩放，直接叠成一团。
    frame(30, 12, 580, 336, C.panel, C.line);
    const list = globalThis.VeinAchievements.ALL;
    const n = globalThis.VeinAchievements.unlockedCount(meta);
    tx('成 就 ' + n + '/' + list.length, 50, 24, { k: 2, c: C.gold });
    tx('解锁即发晶尘，直接进商店余额', 50, 58, { c: C.dim2 });
    btn('btn:home', 520, 24, 80, 20, '返回 Esc');
    uctx.fillStyle = C.line2; uctx.fillRect(50, 78, 540, 1);
    const rows = Math.ceil(list.length / 2), hover = { v: '' };
    list.forEach((a, i) => {
      const col = Math.floor(i / rows), row = i % rows;
      const x = 50 + col * 276, y = 84 + row * 19;
      const got = !!meta.achievements[a.id];
      const b = { x: x - 4, y: y - 2, w: 268, h: 19 };
      buttons['ach:' + a.id] = b;
      if (App.hoverBtn === 'ach:' + a.id) { uctx.fillStyle = C.panel2; uctx.fillRect(b.x, b.y, b.w, b.h); hover.v = a.desc + '（+' + a.reward + '）'; }
      A.drawSprite(uctx, 'star', got ? 'yellow' : 'steel', x, y + 2, 1, got ? 1 : 0.35);
      tx(a.name, x + 12, y + 2, { c: got ? C.gold : C.dim2 });
      tx(got ? '已达成' : '+' + a.reward, x + 262, y + 3, { small: !got, k: got ? 1 : 2, c: got ? C.green : C.dim2, a: 'right' });
    });
    uctx.fillStyle = C.line2; uctx.fillRect(50, 314, 540, 1);
    tx(hover.v || '刷成就和变强是同一条线', 50, 320, { c: hover.v ? C.ink : C.dim2 });
  }

  function drawAchBanner() {
    const b = App.achBanner; if (!b) return;
    const h = 26 + b.list.length * 18, w = 300;
    const y0 = H - 14 - h;
    uctx.globalAlpha = Math.min(1, b.t * 1.4);
    frame(W / 2 - w / 2, y0, w, h, 'rgba(22,17,6,0.94)', C.gold);
    A.drawSprite(uctx, 'star', 'yellow', W / 2 - w / 2 + 10, y0 + 8, 1);
    tx('成就达成', W / 2 - w / 2 + 24, y0 + 8, { c: C.gold });
    b.list.forEach((t, i) => tx(t, W / 2 - w / 2 + 24, y0 + 28 + i * 18, { c: C.green }));
    uctx.globalAlpha = 1;
  }

  /** 商店：三个页签 —— 强化 / 词条研究 / 深渊天梯。
   *  一页放不下所有长期目标，所以分页；每页都只放"能立刻买的东西"。 */
  function drawShop() {
    dimScreen(0.93);
    frame(30, 12, 580, 336, C.panel, C.line);
    tx('地面商店', 50, 22, { k: 2, c: C.gold });
    A.drawSprite(uctx, 'gem', 'yellow', 420, 22, 2);
    tx(meta.dust, 446, 24, { c: C.gold });

    const tabs = [['up', '强化'], ['rel', '词条研究'], ['asc', '深渊天梯']];
    tabs.forEach((t, i) => {
      const x = 50 + i * 128, on = meta.shopTab === t[0];
      btn('tab:' + t[0], x, 50, 120, 22, t[1], { accent: on ? C.gold : C.line2, center: 1 });
      if (on) { uctx.fillStyle = C.gold; uctx.fillRect(x + 2, 73, 116, 2); }
    });
    btn('btn:home', 510, 22, 80, 20, '返回 Esc');

    if (meta.shopTab === 'rel') return drawShopRelics();
    if (meta.shopTab === 'asc') return drawShopAsc();

    // ---- 页签 1：强化 ----
    V.UPGRADES.forEach((u, i) => {
      const y = 84 + i * 36, lv = meta.upgrades[u.id] || 0, max = lv >= u.maxLevel;
      const cost = max ? 0 : u.cost(lv);
      frame(50, y, 540, 32, C.panel2, null);
      tx(u.name + (u.maxLevel > 1 ? '  ' + lv + '/' + u.maxLevel : (lv ? '  已购' : '')), 62, y + 4, { c: C.ink });
      tx(u.desc, 62, y + 17, { c: C.dim2, k: 1 });
      const afford = !max && meta.dust >= cost;
      btn('buy:' + u.id, 470, y + 5, 110, 22, max ? '已满' : cost + ' 尘', { accent: afford ? C.green : C.line2, center: 1 });
    });
  }

  /** 页签 2：词条研究 —— 花晶尘把还没解锁的词条打开（内容解锁，不只是数值） */
  function drawShopRelics() {
    const locked = V.RELICS.filter(r => !meta.unlocked[r.id]);
    tx('已解锁 ' + (V.RELICS.length - locked.length) + '/' + V.RELICS.length
      + '　　解锁后才会出现在三选一里', 50, 86, { c: C.dim2 });
    if (!locked.length) { tx('全部词条已解锁。', 50, 110, { c: C.green }); return; }
    const cw = 74, ch = 54, per = 7;      // 7 列 × 4 行 = 28 格，正好覆盖 22 条待解锁词条
    locked.slice(0, 28).forEach((R, i) => {
      const x = 50 + (i % per) * (cw + 4), y = 104 + Math.floor(i / per) * (ch + 6);
      const cost = V.UNLOCK_COST[R.rarity];
      const afford = meta.dust >= cost;
      const cols = R.rarity === 2 ? ['#ffe9a8', '#e0b83a', '#7a5c1c']
        : R.rarity === 1 ? ['#cfe6ff', '#7ec8ff', '#2f5f8a'] : ['#dfe5f0', '#98a2b8', '#4a5261'];
      const hov = App.hoverBtn === 'unlock:' + R.id;
      frame(x, y, cw, ch, hov ? C.panel2 : C.panel, afford ? (hov ? C.gold : C.line) : C.line2);
      A.drawRune(uctx, R.id, x + 8, y + 3, 3, afford ? cols : ['#3a4150', '#2c3240', '#22283a']);
      tx(R.name, x + 4, y + 29, { c: afford ? C.ink : C.dim2, k: 1 });
      tx(cost + ' 尘', x + cw - 4, y + 42, { c: afford ? C.green : C.dim2, a: 'right' });
      buttons['unlock:' + R.id] = { x, y, w: cw, h: ch };
    });
  }

  /** 页签 3：深渊天梯 —— 无限难度阶梯，选一级下井 */
  function drawShopAsc() {
    const A0 = V.ASCENSION;
    tx('每级：晶尘 ×' + A0.rewardMul(1).toFixed(2) + '／危险矿 +' + A0.hazardAdd(1).toFixed(2)
      + '／下潜阈值 +' + Math.round(A0.thresholdAdd(1) * 100) + '%', 50, 86, { c: C.dim2 });
    const maxShow = Math.min(A0.max, (meta.ascMax || 0) + 1);
    for (let lv = 0; lv <= maxShow; lv++) {
      const y = 108 + lv * 26, unlocked = lv <= (meta.ascMax || 0), sel = (meta.ascension || 0) === lv;
      frame(50, y, 540, 22, sel ? C.panel2 : C.panel, sel ? C.gold : (unlocked ? C.line : C.line2));
      tx(A0.name(lv), 62, y + 3, { c: unlocked ? (sel ? C.gold : C.ink) : C.dim2 });
      if (!unlocked) {
        // 锁定行**只显示解锁条件**。之前条件和解锁前的数值文字挤在一起，
        // 两段文字直接重叠成乱码（是靠看截图发现的，热区断言查不到文字压文字）。
        tx('在 ' + A0.name(lv - 1) + ' 升井达到 ' + A0.unlockDepth(lv - 1) + ' 层后解锁', 300, y + 3, { c: C.dim2 });
      } else {
        tx('收益 ×' + A0.rewardMul(lv).toFixed(2)
          + '   危险 +' + A0.hazardAdd(lv).toFixed(2)
          + '   阈值 +' + Math.round(A0.thresholdAdd(lv) * 100) + '%'
          + (A0.airPenalty(lv) ? '   起始空气 -' + A0.airPenalty(lv) : ''), 190, y + 3, { c: C.dim2 });
        if (sel) tx('已选择', 578, y + 3, { c: C.gold, a: 'right' });
      }
      if (unlocked) buttons['asc:' + lv] = { x: 50, y: y, w: 540, h: 22 };
    }
    tx('下井时会带上所选等级。', 50, 330, { c: C.dim2 });
  }

  /** 出发装备：买了"出发装备槽"之后，每次下井前从已解锁词条里挑一条带走 */
  function drawStartPick() {
    dimScreen(0.86);
    tx('带一条词条下井', W / 2, 30, { k: 2, c: C.gold, a: 'center' });
    tx('出发装备槽 ' + (meta.upgrades.slot || 0) + ' 个　·　三选一（可跳过）', W / 2, 62, { c: C.dim2, a: 'center' });
    (App.startOffer || []).forEach((id, i) => {
      const R = V.RELICS.find(r => r.id === id); if (!R) return;
      const cw = 186, ch = 180, gap = 15, x = (W - cw * 3 - gap * 2) / 2 + i * (cw + gap), y = 88;
      const acc = R.rarity === 2 ? C.gold : (R.rarity === 1 ? C.blue : C.line);
      frame(x, y, cw, ch, App.hoverBtn === 'start:' + id ? C.panel2 : C.panel, acc);
      uctx.fillStyle = acc; uctx.fillRect(x + 2, y + 2, cw - 4, 2);
      const cols = R.rarity === 2 ? ['#ffe9a8', '#e0b83a', '#7a5c1c']
        : R.rarity === 1 ? ['#cfe6ff', '#7ec8ff', '#2f5f8a'] : ['#dfe5f0', '#98a2b8', '#4a5261'];
      A.drawRune(uctx, id, x + 14, y + 14, 3, cols);
      tx(R.name, x + 14, y + 44, { c: C.ink });
      uctx.fillStyle = C.line2; uctx.fillRect(x + 14, y + 66, cw - 28, 1);
      para(R.desc, x + 14, y + 78, cw - 28, { c: C.dim });
      buttons['start:' + id] = { x, y, w: cw, h: ch };
    });
    btn('btn:startskip', W / 2 - 80, 288, 160, 24, '空手下去', { center: 1 });
  }

  function drawHelp() {
    dimScreen(0.94);
    frame(30, 14, 580, 318, C.panel, C.line);
    tx('怎 么 玩', W / 2, 20, { k: 2, c: C.gold, a: 'center' });
    const L = [
      ['1', '盘面是一整块矿脉。只有贴着矿道的矿石才能挖 —— 矿道形状由你决定。'],
      ['2', '点矿石：同色相连 ≥2 块整片挖掉（拿晶尘，费力气）。'],
      ['3', '孤块 / 沼气泡 / 岩浆 / 坚岩 只能「开凿」：不费力气、不给进度，但能开路。'],
      ['4', '挖矿耗空气（每 6 格 1 点）。沼气泡 -1、岩浆 -3。空气见底 = 塌方 = 本局结束。'],
      ['5', '每下潜一层回 3 点空气，并三选一条「矿脉法则」—— 改的是规则，不是数值。'],
      ['6', '随时可以「升井」把晶尘带回地面买永久强化。贪心会死，稳妥赚得慢。'],
      ['7', '深处有精英矿：晶簇是补给点，深岩挖不动还会生长，毒气矿脉会不断污染矿石。']
    ];
    let y = 54;
    for (const [k, v] of L) {
      tx(k, 48, y, { c: C.blue });
      const h = para(v, 66, y, 520, { c: C.dim });
      y += h + 6;                  // 老版本用 max(24, h+8)：七条描述直接挤出面板外
    }
    uctx.fillStyle = C.line2; uctx.fillRect(48, 292, 544, 1);
    tx('形状即身份：赤铁=圆 苍铜=三角 蓝荧=菱形 紫晶=星 硫金=方（色盲也能玩）', 48, 298, { c: C.dim2 });
    const UV = globalThis.VeinUpdate ? globalThis.VeinUpdate.VERSION : '1.0.0';
    const UR = App.updateResult;
    tx('当前版本 v' + UV + (UR && UR.ok ? (UR.hasNew ? '　·　有新版本 v' + UR.latest : '　·　已是最新') : ''),
      W / 2, 300, { c: C.dim2, a: 'center' });
    btn('btn:checkver', W / 2 - 270, 320, 130, 20, '检查更新', { center: 1, accent: C.green });
    btn('btn:retut', W / 2 - 130, 320, 120, 20, '重看教学', { center: 1 });
    btn('btn:home', W / 2, 320, 270, 20, '返回 Esc', { center: 1 });
  }

  function drawSwap() {
    dimScreen(0.88);
    frame(150, 70, 340, 220, C.panel, C.line);
    tx('换色：把哪种变成哪种？', W / 2, 82, { c: C.gold, a: 'center' });
    tx('先点左边，再点右边', W / 2, 104, { c: C.dim2, a: 'center' });
    const row = (label, y, pick) => {
      tx(label, 168, y + 6, { c: C.dim });
      for (let i = 0; i < 5; i++) {
        const b = { x: 224 + i * 50, y: y, w: 44, h: 28 };
        buttons['swap' + pick + ':' + i] = b;
        const sel = (pick === 'A' ? App.swapFrom : App.swapTo) === i;
        frame(b.x, b.y, b.w, b.h, sel ? C.panel2 : C.panel, sel ? C.gold : C.line2);
        A.drawSprite(uctx, A.ORE_STYLE[i].shape, A.ORE_STYLE[i].pal, b.x + 4, b.y + 2, 3);
        tx(V.COLORS[i].name, b.x + b.w - 4, b.y + 7, { c: C.ink, a: 'right' });
      }
    };
    row('变', 128, 'A');
    row('成', 172, 'B');
    const ok = App.swapFrom != null && App.swapTo != null && App.swapFrom !== App.swapTo;
    btn('btn:swapgo', W / 2 - 80, 236, 160, 24, ok ? '确认使用' : '选两个颜色', { accent: ok ? C.green : C.line2, dim: !ok });
    buttons['btn:swapgo'].ok = ok;
  }

  /* ---------------- 输入 ---------------- */
  function toInternal(ev) {
    const r = ui.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / SCALE, y: (ev.clientY - r.top) / SCALE };
  }
  const BASE_KEYS = k => k.startsWith('btn:ascend') || k.startsWith('btn:help') || k.startsWith('btn:mute') || k.startsWith('relic:');
  const MODAL_MODES = ['help', 'shop', 'over', 'swap', 'ach', 'startpick'];

  function hotzoneOverlaps() {
    const keys = Object.keys(buttons), bad = [];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const a = buttons[keys[i]], b = buttons[keys[j]];
      if (a.w <= 0 || a.h <= 0 || b.w <= 0 || b.h <= 0) continue;
      const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (ox > 0.5 && oy > 0.5) bad.push(keys[i] + ' ∩ ' + keys[j]);
    }
    return bad;
  }

  function hit(x, y) {
    for (const k in buttons) {
      const b = buttons[k];
      if (b.w <= 0 || b.h <= 0) continue;
      if (x < b.x || x > b.x + b.w || y < b.y || y > b.y + b.h) continue;
      if (App.modal && BASE_KEYS(k)) continue;
      return k;
    }
    return null;
  }
  function cellAt(x, y) {
    const c = Math.floor((x - BOARD_X) / TILE), r = Math.floor((y - BOARD_Y) / TILE);
    if (r < 0 || r >= V.ROWS || c < 0 || c >= V.COLS) return null;
    return { r: r, c: c };
  }

  function onMove(ev) {
    const p = toInternal(ev);
    App.hoverBtn = hit(p.x, p.y);
    App.hover = cellAt(p.x, p.y);
    App.hoverRelic = (App.hoverBtn && App.hoverBtn.indexOf('relic:') === 0) ? App.hoverBtn.slice(6) : null;
    const s = App.run;
    App.hoverGroup = null;
    if (App.hover && s && s.phase === 'play') {
      const a = V.actionFor(s, App.hover.r, App.hover.c);
      if (a.kind === 'dig') App.hoverGroup = a.group;
    }
    ui.style.cursor = (App.hoverBtn || (App.hover && s && s.phase === 'play')) ? 'pointer' : 'default';
  }

  function onClick(ev) {
    S.unlock();
    const p = toInternal(ev);
    const k = hit(p.x, p.y);
    if (k) {
      S.ui();
      if (k.indexOf('relic:') === 0) {
        const id = k.slice(6), R = V.RELICS.find(r => r.id === id);
        if (R && R.active) {
          if (id === 'swap') { App.mode = 'swap'; App.swapFrom = null; App.swapTo = null; }
          else { const res = V.useActive(App.run, id); if (!res.ok) toast(res.reason); }
        } else toast(R ? R.name + '：' + R.desc : '');
        return;
      }
      if (k.indexOf('draft:') === 0) { pickDraft(k.slice(6)); return; }
      if (k.indexOf('ach:') === 0) return;
      if (k.indexOf('tab:') === 0) { meta.shopTab = k.slice(4); save(); return; }
      if (k.indexOf('asc:') === 0) {
        const lv = parseInt(k.slice(4), 10);
        if (lv <= (meta.ascMax || 0)) { meta.ascension = lv; save(); }
        return;
      }
      if (k.indexOf('unlock:') === 0) {
        const id = k.slice(7), R = V.RELICS.find(r => r.id === id); if (!R) return;
        const cost = V.UNLOCK_COST[R.rarity];
        if (meta.dust < cost) { toast('晶尘不够，还差 ' + (cost - meta.dust)); S.deny(); return; }
        meta.dust -= cost; meta.unlocked[id] = 1; save(); S.coin();
        toast('已解锁词条 ' + R.name + ' —— 现在会出现在三选一里');
        return;
      }
      // 换色弹窗的两排色板（之前只注册了热区、没接处理 —— 死按钮断言抓到的）
      if (k.indexOf('swapA:') === 0) { App.swapFrom = parseInt(k.slice(6), 10); S.ui(); return; }
      if (k.indexOf('swapB:') === 0) { App.swapTo = parseInt(k.slice(6), 10); S.ui(); return; }
      if (k.indexOf('start:') === 0 && App.mode === 'startpick') {
        const id = k.slice(6);
        beginRun(App.pendingRun ? App.pendingRun.daily : false, id);
        App.mode = App.run.phase === 'draft' ? 'draft' : 'play';
        return;
      }
      if (k.indexOf('buy:') === 0) { buyUpgrade(k.slice(4)); return; }
      const b = k.slice(4);
      if (b === 'start' || b === 'again') { startRun(); App.mode = App.run.phase === 'draft' ? 'draft' : 'play'; return; }
      if (b === 'daily') { startRun({ daily: true }); App.mode = App.run.phase === 'draft' ? 'draft' : 'play'; return; }
      if (b === 'shop') { App.mode = 'shop'; return; }
      if (b === 'ach') { App.prevMode = App.mode; App.mode = 'ach'; return; }
      if (b === 'help') { App.prevMode = App.mode; App.mode = 'help'; return; }
      if (b === 'home') { App.mode = 'title'; S.stopDrone(); return; }
      if (b === 'mute') { meta.muted = !meta.muted; S.setMuted(meta.muted); save(); return; }
      if (b === 'ascend') { doAscend(); return; }
      if (b === 'skip') { V.skipDraft(App.run); App.mode = 'play'; S.coin(); return; }
      if (b === 'startskip') {
        beginRun(App.pendingRun ? App.pendingRun.daily : false, null);
        App.mode = App.run.phase === 'draft' ? 'draft' : 'play';
        return;
      }
      if (b === 'tutskip') { endTutorial(false); return; }
      if (b === 'update') {
        const R2 = App.updateResult;
        globalThis.VeinUpdate.open((R2 && R2.url) || globalThis.VeinUpdate.manifestUrl);
        return;
      }
      if (b === 'reload') {
        if (globalThis.VeinApplyUpdate) globalThis.VeinApplyUpdate(); else location.reload();
        return;
      }
      if (b === 'checkver') { checkUpdate(true); return; }
      if (b === 'retut') { meta.tutorialDone = false; save(); toast('下次下井会重新走一遍教学'); return; }
      if (b === 'swapgo') {
        if (!buttons['btn:swapgo'].ok) return;
        const res = V.useActive(App.run, 'swap', { from: App.swapFrom, to: App.swapTo });
        if (!res.ok) toast(res.reason); else App.mode = 'play';
        return;
      }
      return;
    }
    if (App.mode === 'swap') return;
    if (App.mode === 'title' || MODAL_MODES.indexOf(App.mode) >= 0) return;
    const s = App.run; if (!s) return;
    if (s.phase === 'draft' || s.phase === 'over') return;
    const c = cellAt(p.x, p.y); if (!c) return;
    const res = V.applyAction(s, c.r, c.c);
    if (!res.ok) toast(res.reason);
    else { App.hover = null; App.hoverGroup = null; checkLive(); tutAdvance(); }
  }

  function pickDraft(id) {
    const s = App.run;
    V.takeRelic(s, id);
    meta.relicSeen[id] = 1;
    checkLive(); tutAdvance();
    App.mode = s.phase === 'draft' ? 'draft' : 'play';
    S.draft();
  }

  function buyUpgrade(id) {
    const u = V.UPGRADES.find(x => x.id === id); if (!u) return;
    const lv = meta.upgrades[id] || 0;
    if (lv >= u.maxLevel) return;
    const cost = u.cost(lv);
    if (meta.dust < cost) { toast('晶尘不够，还差 ' + (cost - meta.dust)); S.deny(); return; }
    meta.dust -= cost; meta.upgrades[id] = lv + 1; save(); S.coin();
    toast('已购买 ' + u.name);
  }

  function doAscend() {
    if (App.tut && App.tut.on) endTutorial(true);      // 教学最后一步就是"升井"，照做即完成
    const s = App.run;
    App.lastResult = V.ascend(s);
    const r = App.lastResult;
    meta.dust += r.banked;
    meta.totalDust += r.banked;
    if (r.depth > meta.bestDepth) meta.bestDepth = r.depth;
    if (r.banked > meta.bestDust) meta.bestDust = r.banked;
    checkFinal(r);
    save(); S.ascend(); App.mode = 'over';
    S.stopDrone();
  }

  /** 洞穴剖面：把每次挖开的列记进当前深度那一行 */
  function addCave(cells) {
    const s = App.run; if (!s) return;
    if (!App.cave) App.cave = {};
    const k = s.depth - 1;
    App.cave[k] = App.cave[k] || 0;
    for (const c of cells) App.cave[k] |= (1 << c.c);
  }

  addEventListener('keydown', function (e) {
    const s = App.run;
    const k = e.key.toLowerCase();
    if (k === 'm') { meta.muted = !meta.muted; S.setMuted(meta.muted); save(); return; }
    if (k === 'escape') {
      if (App.mode === 'play' || App.mode === 'draft') { App.mode = 'title'; S.stopDrone(); }
      else App.mode = App.prevMode === 'play' ? 'play' : 'title';
      return;
    }
    if (App.mode === 'title') {
      if (k === 'enter' || k === ' ') startRun();
      else if (k === 'd') { startRun({ daily: true }); App.mode = App.run.phase === 'draft' ? 'draft' : 'play'; }
      else if (k === 's') App.mode = 'shop';
      else if (k === 't') { App.prevMode = 'title'; App.mode = 'ach'; }
      else if (k === 'h') { App.prevMode = 'title'; App.mode = 'help'; }
      return;
    }
    if (App.mode === 'ach') { if (k === 't' || k === 'escape' || k === 'enter') App.mode = 'title'; return; }
    if (App.mode === 'help' || App.mode === 'shop') { if (k === 'h' || k === 's' || k === 't' || k === 'enter') App.mode = 'title'; return; }
    if (App.mode === 'swap') return;
    if (!s) return;
    if (s.phase === 'draft') {
      if (k >= '1' && k <= '3') { const id = s.draft[parseInt(k, 10) - 1]; if (id) pickDraft(id); }
      else if (k === ' ') { V.skipDraft(s); App.mode = 'play'; S.coin(); }
      return;
    }
    if (k === 'a') doAscend();
    else if (k === 'h') { App.prevMode = 'play'; App.mode = 'help'; }
  });
  ui.addEventListener('mousemove', onMove);
  ui.addEventListener('click', onClick);
  ui.addEventListener('touchstart', function (e) { e.preventDefault(); const t = e.touches[0]; onMove(t); onClick(t); }, { passive: false });

  /* ---------------- 主循环 ---------------- */
  let last = performance.now();
  /** 渲染一帧（不调度下一帧）。抽出来是为了让自动化测试能同步驱动渲染。 */
  function renderFrame(dt) {
    dt = dt || 0.016;
    App.t += dt;
    if (App.msgT > 0) App.msgT -= dt;
    if (App.achBanner) { App.achBanner.t -= dt; if (App.achBanner.t <= 0) App.achBanner = null; }
    buttons = {}; // 重建热区
    // 模态判定：只要有一层弹窗开着（三选一/塌方结算/商店/说明/换色），
    // 底下的侧栏按钮就**不许注册热区**。否则 hit() 按插入顺序会先命中底层按钮：
    // 实测「说明页的返回」被底下的「升井」吃掉 → 点返回直接跳结算页。
    const R0 = App.run;
    App.modal = !!R0 && (R0.phase === 'draft' || App.mode === 'over' || App.mode === 'shop' || App.mode === 'help' || App.mode === 'swap' || App.mode === 'ach' || App.mode === 'startpick');
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#06080d'; ctx.fillRect(0, 0, W, H);

    if (R0) { handleEvents(); drawBoard(); drawHud(); drawPanel(); }

    // 粒子/飘字更新
    for (let i = App.particles.length - 1; i >= 0; i--) {
      const p = App.particles[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 260 * dt;
      if (p.life <= 0) App.particles.splice(i, 1);
    }
    for (let i = App.floats.length - 1; i >= 0; i--) {
      const f = App.floats[i]; f.life -= dt; f.y -= 22 * dt;
      if (f.life <= 0) App.floats.splice(i, 1);
    }
    App.shake *= Math.pow(0.001, dt);
    if (App.shake < 0.15) App.shake = 0;

    drawUi();
    uctx.clearRect(0, 0, 0, 0);
    if (App.flash > 0) {
      App.flash -= dt * 2.2;
      uctx.globalAlpha = Math.max(0, App.flash) * 0.35;
      uctx.fillStyle = App.flashColor; uctx.fillRect(0, 0, W, H);
      uctx.globalAlpha = 1;
    }
  }
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    renderFrame(dt);
    if (App.auto !== false) requestAnimationFrame(tick);
  }
  App.auto = true;
  requestAnimationFrame(tick);

  // 初始：若从"重开"回来，保证 title 态干净
  App.mode = 'title';

  // 开局静默检查一次更新（延迟 1.2s，别和首帧渲染抢时间；失败就算了）
  if (globalThis.VeinUpdate) {
    setTimeout(() => { checkUpdate(false); }, 1200);
  }
  // 暴露给自动化测试（tools/browser-smoke.html）用的接口
  Object.assign(App, {
    startRun, doAscend, pickDraft, buyUpgrade, renderFrame, checkLive, checkFinal,
    tutAdvance: () => tutAdvance(), endTutorial: (f) => endTutorial(f),
    checkUpdate: (f) => checkUpdate(f), getUpdateResult: () => App.updateResult,
    dailySeed, todayKey, todayLabel, hotzoneOverlaps,
    width: () => W, height: () => H,
    setAuto: (v) => { App.auto = !!v; },
    getMeta: () => meta, setMeta: (m) => { meta = m; }, saveMeta: save,
    buttons: () => buttons, resize
  });
  globalThis.VeinApp = App;
})();
