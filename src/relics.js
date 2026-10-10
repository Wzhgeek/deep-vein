/* =====================================================================
 * 矿脉 Deep Vein — 词条库
 * 加一条词条 = 加一个对象。flags 是静态加成，onDig/onDescend/onAcquire/active 是行为。
 * 设计原则：词条改写「规则」，不改数值堆叠。
 * ===================================================================== */
'use strict';
(function () {
  const V = globalThis.Vein;
  const T = V.T;

  /** 把一块矿石变成指定颜色（双生用） */
  function recolor(s, r, c, col) { const x = s.board[r][c]; if (x && x.t === T.ORE) { x.c = col; return true; } return false; }
  function placeInFrontier(s, rng, make) {
    const cand = [];
    for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) {
      const cell = s.board[r][c];
      if (cell && cell.t === T.ORE && V.isFrontier(s, r, c)) cand.push([r, c]);
    }
    if (!cand.length) return null;
    const p = rng.pick(cand);
    s.board[p[0]][p[1]] = make();
    return p;
  }

  V.setRelics([
    /* ---------------- 普通 ---------------- */
    {
      id: 'resonance', start: 1, name: '共鸣', rarity: 0, unique: true,
      desc: '同一种矿石累计挖满 8 块后，下次挖它时会波及整圈邻格并清零。',
      flags: { resoEvery: 8 }
    },
    {
      id: 'handy', start: 1, name: '顺手', rarity: 0, maxStack: 3,
      desc: '一次挖掉 6 块以上时，额外获得 3 晶尘。',
      onDig(ctx) { if (ctx.cells.length >= 6) ctx.extraGain += 3; return ctx.cells; }
    },
    {
      id: 'richvein', name: '富矿脉', rarity: 0, unique: true,
      desc: '晶尘收益 +40%，但新生成的矿石里危险矿多 25%。',
      flags: { scoreMul: 1.4, hazardMul: 1.2 }
    },
    {
      id: 'airpocket', start: 1, name: '空气囊', rarity: 0, maxStack: 3,
      desc: '每次下潜额外恢复 1 点空气。',
      flags: { healBonus: 1 }
    },
    {
      id: 'goldpan', start: 1, name: '淘金', rarity: 0,
      desc: '镐击孤块也能获得晶尘（双倍）。',
      flags: { singleScore: true }
    },
    {
      id: 'echo', name: '回声', rarity: 0, maxStack: 3,
      desc: '一次挖掘中，超过 3 块的部分每块额外 +1 晶尘。',
      flags: { echo: 1 },
      onDig(ctx) { ctx.extraGain += Math.max(0, ctx.cells.length - 3); return ctx.cells; }
    },
    {
      id: 'mask', name: '防尘面罩', rarity: 0, unique: true,
      desc: '沼气泡不再造成伤害。',
      flags: { poisonImmune: true }
    },
    {
      id: 'surveyor', start: 1, name: '勘探', rarity: 0, maxStack: 2,
      desc: '下潜所需挖掘量 -15%。',
      flags: { thresholdMul: 0.85 }
    },
    {
      id: 'lamp', name: '矿灯', rarity: 0, unique: true,
      desc: '持续高亮场上最大的一处矿脉（省眼睛）。',
      flags: { hint: true }
    },
    {
      id: 'lightpick', start: 1, name: '轻镐', rarity: 0, maxStack: 2,
      desc: '挖掘更省力：每挖 9 格才消耗 1 点空气（原本 6 格）。',
      flags: { digCostEvery: 3 }
    },
    {
      id: 'glove', start: 1, name: '厚手套', rarity: 0, maxStack: 2,
      desc: '岩浆造成的伤害 -1。',
      flags: { lavaArmor: 1 }
    },

    /* ---------------- 稀有 ---------------- */
    {
      id: 'chain', start: 1, name: '塌方连锁', rarity: 1, unique: true,
      desc: '每次挖掘后，若暴露出 3 块以上的同色矿脉，会自动再崩落一次。',
      flags: { autoChain: 3 }
    },
    {
      id: 'swap', name: '换色', rarity: 1, unique: true, charges: 2,
      desc: '主动（2 次）：把场上某一种颜色的矿石全部变成另一种颜色。',
      active(ctx) {
        const a = ctx.arg;
        if (!a || a.from == null || a.to == null || a.from === a.to) return false;
        let n = 0;
        for (let r = 0; r < V.ROWS; r++) for (let c = 0; c < V.COLS; c++) {
          const cell = ctx.s.board[r][c];
          if (cell && cell.t === T.ORE && cell.c === a.from) { cell.c = a.to; n++; }
        }
        if (!n) return false;
        ctx.log('【换色】' + V.COLORS[a.from].name + ' → ' + V.COLORS[a.to].name + '（' + n + ' 块）');
        ctx.ev({ type: 'swap', from: a.from, to: a.to });
        return true;
      }
    },
    {
      id: 'greed', name: '贪婪', rarity: 1, unique: true,
      desc: '晶尘收益 +60%，但新矿石中危险矿多 50%。',
      flags: { scoreMul: 1.6, hazardMul: 1.4 }
    },
    {
      id: 'tunnel', start: 1, name: '掘进', rarity: 1, unique: true,
      desc: '下潜所需挖掘量 -25%。',
      flags: { thresholdMul: 0.75 }
    },
    {
      id: 'hardhead', start: 1, name: '硬头', rarity: 1, unique: true,
      desc: '可以镐击坚岩（消耗 2 点空气）。',
      flags: { bedrockDig: true }
    },
    {
      id: 'shortcut', name: '捷径', rarity: 1, unique: true, charges: 3,
      desc: '主动（3 次）：打一口直井，立刻下潜 1 层。',
      active(ctx) {
        const s = ctx.s;
        const c = ctx.rng.int(V.COLS);
        for (let r = 0; r < V.ROWS; r++) if (s.board[r][c]) { s.board[r][c] = null; }
        ctx.log('【捷径】打穿一口直井，直接下潜。');
        ctx.ev({ type: 'shaft', c });
        V.descend(s);
        return true;
      }
    },
    {
      id: 'twin', start: 1, name: '双生', rarity: 1, unique: true,
      desc: '挖矿时，30% 概率把紧邻的异色矿石染成同色并一起挖掉。',
      flags: { convertChance: 0.3 },
      onDig(ctx) {
        const s = ctx.s;
        const first = ctx.cells.find(p => s.board[p.r][p.c]);
        if (!first) return ctx.cells;
        const color = s.board[first.r][first.c].c;
        const out = ctx.cells.slice(), seen = {};
        for (const p of ctx.cells) seen[p.r * V.COLS + p.c] = 1;
        for (const p of ctx.cells) {
          for (const d of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nr = p.r + d[0], nc = p.c + d[1];
            if (nr < 0 || nr >= V.ROWS || nc < 0 || nc >= V.COLS) continue;
            const k = nr * V.COLS + nc;
            if (seen[k]) continue;
            const cell = s.board[nr][nc];
            if (cell && cell.t === T.ORE && cell.c !== color && ctx.rng.chance(0.3)) {
              seen[k] = 1; recolor(s, nr, nc, color); out.push({ r: nr, c: nc });
            }
          }
        }
        if (out.length > ctx.cells.length) ctx.log('【双生】矿脉蔓延，多挖了 ' + (out.length - ctx.cells.length) + ' 块。');
        return out;
      }
    },
    {
      id: 'deepdiver', name: '深潜者', rarity: 1, unique: true,
      desc: '深度达到 8 之后，所有晶尘收益 ×1.5。',
      flags: { deepMul: 1.5 }
    },
    {
      id: 'steam', start: 1, name: '冷却液', rarity: 1, unique: true,
      desc: '岩浆不再蔓延。',
      flags: { lavaSlow: true }
    },
    {
      id: 'ferment', name: '发酵', rarity: 1, unique: true,
      desc: '每次下潜，在可挖位置生成 1 块化石。',
      onDescend(ctx) {
        const p = placeInFrontier(ctx.s, ctx.rng, () => ({ t: T.FOSSIL }));
        if (p) ctx.log('【发酵】矿层里长出了一块化石。');
      }
    },

    /* ---------------- 传说 ---------------- */
    {
      id: 'pulse', start: 1, name: '大地脉动', rarity: 2, unique: true,
      desc: '每累计挖掉 12 格，自动引爆场上最大的一处矿脉。',
      flags: { pulseEvery: 12 }
    },
    {
      id: 'lavaheart', start: 1, name: '熔心', rarity: 2, unique: true,
      desc: '每次下潜，在可挖位置生成 1 颗矿脉之心（额外一次三选一）。',
      onDescend(ctx) {
        const p = placeInFrontier(ctx.s, ctx.rng, () => ({ t: T.HEART }));
        if (p) ctx.log('【熔心】一颗矿脉之心浮出矿层。');
      }
    },
    {
      id: 'rewind', name: '时间倒流', rarity: 2, unique: true,
      desc: '本局第一次塌方不会造成任何损失，你会在原地活下来。',
      flags: { revive: true }
    },
    {
      id: 'god', name: '矿工之神', rarity: 2, unique: true,
      desc: '下潜所需挖掘量 -35%，且每次下潜额外恢复 1 点空气。',
      flags: { thresholdMul: 0.65, healBonus: 1 }
    },
    {
      id: 'gomine', name: '竭泽而渔', rarity: 2, unique: true,
      desc: '晶尘收益 ×2，但空气上限 -3。',
      flags: { scoreMul: 2.0, airMaxB: -3 }
    },

    /* ---------------- 扩充包：14 条新词条（总计 40 条） ---------------- */

    /* 普通 5 */
    {
      id: 'precision', start: 1, name: '精准', rarity: 0, maxStack: 2,
      desc: '一次恰好挖掉 4 块时，额外获得 10 晶尘。',
      flags: { precisionBonus: 10 }
    },
    {
      id: 'helmet', start: 1, name: '安全帽', rarity: 0, maxStack: 2,
      desc: '空气上限 +2。',
      flags: { airMaxB: 2 }
    },
    {
      id: 'scavenger', name: '拾荒者', rarity: 0, unique: true,
      desc: '矿脉之心 / 化石 / 晶簇 的晶尘翻倍。',
      flags: { bonusMul: 2 }
    },
    {
      id: 'minecart', start: 1, name: '矿车', rarity: 0, maxStack: 2,
      desc: '矿脉每上滚一行（你每往下推进一次），+4 晶尘。',
      flags: { minecartBonus: 4 }
    },
    {
      id: 'prospector', name: '探矿锤', rarity: 0, maxStack: 2,
      desc: '开凿孤块时有 35% 概率白捡 5 晶尘。',
      flags: { pickGoldChance: 0.35, pickGold: 5 }
    },

    /* 稀有 5 */
    {
      id: 'resocore', name: '共振腔', rarity: 1, unique: true,
      desc: '自带共鸣，且阈值从 8 块降到 5 块（与【共鸣】同时持有取更低的）。',
      flags: { resoEvery: 5 }
    },
    {
      id: 'icepick', start: 1, name: '冰镐', rarity: 1, unique: true,
      desc: '凿开坚岩不再消耗空气。',
      flags: { bedrockFree: true }
    },
    {
      id: 'furnace', name: '熔炉', rarity: 1, unique: true,
      desc: '岩浆不再烫伤你，反而每凿开一处 +12 晶尘。',
      flags: { lavaToGold: true }
    },
    {
      id: 'vent', name: '通风井', rarity: 1, unique: true,
      desc: '每下潜 2 层，额外弹一次三选一。',
      flags: { extraDraftEvery: 2 }
    },
    {
      id: 'doublepick', name: '双镐', rarity: 1, maxStack: 2,
      desc: '挖矿时有 25% 概率这一镐不费力气。',
      flags: { digFreeChance: 0.25 }
    },

    /* 传说 4 */
    {
      id: 'bloodline', name: '血脉', rarity: 2, unique: true,
      desc: '每累计挖掉 20 格，空气上限 +1（本局最多 +5）—— 越挖越强。',
      flags: { bloodlineEvery: 20 }
    },
    {
      id: 'abyss', name: '深渊契约', rarity: 2, unique: true,
      desc: '每次下潜都额外弹一次三选一，但空气上限 -2。',
      flags: { extraDraftEvery: 1, airMaxB: -2 }
    },
    {
      id: 'doom', name: '终焉', rarity: 2, unique: true,
      desc: '每累计挖掉 30 格，自动引爆场上最大的 3 处矿脉。',
      flags: { doomEvery: 30 }
    },
    {
      id: 'alchemy', name: '点石成金', rarity: 2, unique: true,
      desc: '推翻核心规则：开凿孤块也能推进下潜进度，但每次开凿要花 1 点空气（原本免费且不计进度）。',
      flags: { pickProgress: true }
    }
  ]);
})();
