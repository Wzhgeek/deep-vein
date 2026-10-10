/* =====================================================================
 * 矿脉 Deep Vein — 成就系统
 * 设计：
 *   - 成就分两类：live（对局中即时判定）与 final（结算时判定）
 *   - 每个成就一次性发放晶尘奖励，奖励直接进地面商店的余额 —— 让"刷成就"和"变强"是同一条线
 *   - 全部判定都是纯函数，方便无头测试
 * 加一条成就 = 加一个对象。
 * ===================================================================== */
'use strict';
(function (root) {
  const A = [
    /* ---------------- 对局中即时达成 ---------------- */
    { id: 'first_dig', name: '第一镐', desc: '挖掉第一片矿石。', reward: 20, live: s => s.dugOre >= 1 },
    { id: 'dig10', name: '一网打尽', desc: '一次挖掉 10 块以上。', reward: 60, live: s => s.stats.biggest >= 10 },
    { id: 'dig15', name: '雪崩', desc: '一次挖掉 15 块以上。', reward: 140, live: s => s.stats.biggest >= 15 },
    { id: 'dig20', name: '地动山摇', desc: '一次挖掉 20 块以上。', reward: 300, live: s => s.stats.biggest >= 20 },
    { id: 'heart3', name: '拾心者', desc: '单局捡到 3 颗矿脉之心。', reward: 80, live: s => s.dugHeart >= 3 },
    { id: 'fossil5', name: '考古学家', desc: '单局捡到 5 块化石。', reward: 80, live: s => s.dugFossil >= 5 },
    { id: 'crystal2', name: '晶簇猎手', desc: '单局开采 2 处晶簇。', reward: 120, live: s => s.dugCrystal >= 2 },
    { id: 'lava5', name: '玩火', desc: '单局凿开 5 处岩浆。', reward: 80, live: s => s.stats.hazards >= 5 },
    { id: 'elite5', name: '精英猎人', desc: '单局处理掉 5 处精英矿（深岩/晶簇/毒气矿脉）。', reward: 150, live: s => s.stats.elites >= 5 },
    { id: 'depth10', name: '十层', desc: '到达深度 10。', reward: 100, live: s => s.depth >= 10 },
    { id: 'depth20', name: '二十层', desc: '到达深度 20。', reward: 320, live: s => s.depth >= 20 },
    { id: 'depth30', name: '深渊行者', desc: '到达深度 30。', reward: 700, live: s => s.depth >= 30 },
    { id: 'relic12', name: '法则收藏家', desc: '单局拿到 12 条词条。', reward: 200, live: s => s.relics.length >= 12 },
    { id: 'legend3', name: '三重传说', desc: '单局同时拥有 3 条传说词条。', reward: 300, live: s => legendCount(s) >= 3 },

    /* ---------------- 结算时判定 ---------------- */
    { id: 'first_ascend', name: '满载而归', desc: '第一次成功升井。', reward: 50, final: (sum) => !sum.dead },
    { id: 'bank1000', name: '千金', desc: '单局带回 1000 以上晶尘。', reward: 250, final: (sum) => sum.banked >= 1000 },
    { id: 'steady10', name: '稳如老狗', desc: '零塌方，且到达深度 10 以上后主动升井。', reward: 260, final: (sum) => !sum.dead && sum.collapses === 0 && sum.depth >= 10 },
    { id: 'first_collapse', name: '吃一堑', desc: '第一次被埋在矿里。', reward: 30, final: (sum) => !!sum.dead },
    { id: 'deep_greed', name: '不知死活', desc: '带着 8 条以上词条死在深度 15 以下。', reward: 60, final: (sum) => !!sum.dead && sum.relics.length >= 8 && sum.depth < 15 },
    { id: 'runs10', name: '老矿工', desc: '累计下井 10 次。', reward: 100, final: (sum, meta) => meta.runs >= 10 },
    { id: 'runs50', name: '矿脉常客', desc: '累计下井 50 次。', reward: 450, final: (sum, meta) => meta.runs >= 50 },
    { id: 'total10k', name: '万贯家财', desc: '累计带回 10000 晶尘。', reward: 300, final: (sum, meta) => (meta.totalDust || 0) >= 10000 },
    { id: 'all_relics', name: '图鉴全开', desc: '见过全部词条。', reward: 1000, final: (sum, meta) => Object.keys(meta.relicSeen || {}).length >= root.Vein.RELICS.length },
    { id: 'daily5', name: '每日打卡', desc: '完成 5 次每日挑战。', reward: 300, final: (sum, meta) => (meta.dailyCount || 0) >= 5 }
  ];

  function legendCount(s) {
    let n = 0;
    for (const id of s.relics) {
      const R = (root.Vein.RELICS || []).find(x => x.id === id);
      if (R && R.rarity === 2) n++;
    }
    return n;
  }

  /** 判定是否有新成就达成。返回新解锁的成就数组（已完成的不重复发放）。 */
  function check(list, ctx, kind) {
    const unlocked = [];
    const done = ctx.meta.achievements || (ctx.meta.achievements = {});
    for (const a of A) {
      if (done[a.id]) continue;
      const fn = a[kind];
      if (!fn) continue;
      let ok = false;
      try { ok = !!fn(ctx.s, ctx.meta); } catch (e) { ok = false; }
      if (ok) { done[a.id] = Date.now(); unlocked.push(a); }
    }
    return unlocked;
  }

  root.VeinAchievements = {
    ALL: A,
    count: () => A.length,
    /** 对局中每个动作后调用 */
    live(s, meta) { return check(A, { s, meta }, 'live'); },
    /** 结算时调用 */
    final(sum, meta) { return check(A, { s: sum, meta }, 'final'); },
    unlockedCount: meta => Object.keys(meta.achievements || {}).length
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
