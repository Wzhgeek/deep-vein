/* =====================================================================
 * 矿脉 Deep Vein — 音效（WebAudio 实时合成，零音频文件）
 * 好处：没有版权问题、没有加载时间、参数可以随游戏状态变（挖得越多音越厚）
 * ===================================================================== */
'use strict';
(function (root) {
  let AC = null, master = null, muted = false, drone = null;

  function ensure() {
    if (AC) return AC;
    const Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return null;
    try {
      AC = new Ctx();
      master = AC.createGain();
      master.gain.value = 0.35;
      master.connect(AC.destination);
    } catch (e) { AC = null; }
    return AC;
  }
  function noiseBuf(sec) {
    const n = Math.floor(AC.sampleRate * sec), b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function env(node, t0, a, d, peak) {
    const g = AC.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
    node.connect(g); g.connect(master);
    return g;
  }
  function tone(type, f0, f1, a, d, peak, detune) {
    if (!ensure() || muted) return;
    const t = AC.currentTime;
    const o = AC.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
    if (detune) o.detune.value = detune;
    env(o, t, a, d, peak);
    o.start(t); o.stop(t + a + d + 0.05);
  }
  function noise(dur, f0, f1, peak, q) {
    if (!ensure() || muted) return;
    const t = AC.currentTime;
    const src = AC.createBufferSource(); src.buffer = noiseBuf(Math.max(0.05, dur));
    const bp = AC.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q || 1;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    src.connect(bp);
    env(bp, t, 0.004, dur, peak);
    src.start(t); src.stop(t + dur + 0.05);
  }

  const API = {
    get muted() { return muted; },
    setMuted(v) { muted = !!v; if (master) master.gain.value = muted ? 0 : 0.35; },
    unlock() { const a = ensure(); if (a && a.state === 'suspended') a.resume(); },
    /* 挖矿：音高随连块数上升，一次挖 12 块就是一段上行琶音 */
    dig(size) {
      const n = Math.min(size, 10);
      for (let i = 0; i < n; i++) setTimeout(() => {
        const base = 220 * Math.pow(1.09, i);
        tone('square', base, base * 0.75, 0.005, 0.10, 0.10 - i * 0.005);
        noise(0.07, 1800, 400, 0.07, 1.2);
      }, i * 42);
    },
    pick() { noise(0.09, 2600, 900, 0.10, 2); tone('square', 320, 180, 0.004, 0.06, 0.05); },
    coin() { tone('square', 880, 880, 0.005, 0.07, 0.07); setTimeout(() => tone('square', 1320, 1320, 0.005, 0.10, 0.06), 55); },
    hurt() { tone('sawtooth', 190, 60, 0.005, 0.28, 0.16); noise(0.2, 500, 120, 0.14, 0.8); },
    breath() { noise(0.28, 380, 180, 0.05, 0.6); },
    descend() {
      tone('triangle', 440, 880, 0.02, 0.28, 0.10);
      tone('triangle', 660, 1320, 0.02, 0.30, 0.06, 8);
      noise(0.4, 2400, 300, 0.05, 0.7);
    },
    draft() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone('square', f, f, 0.01, 0.22, 0.08), i * 70)); },
    relic() { [784, 988, 1175].forEach((f, i) => setTimeout(() => tone('square', f, f, 0.01, 0.25, 0.08), i * 60)); },
    collapse() {
      noise(1.1, 900, 60, 0.30, 0.5);
      tone('sawtooth', 110, 30, 0.02, 0.9, 0.20);
      tone('square', 55, 22, 0.05, 1.0, 0.14);
    },
    ascend() { [392, 523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone('triangle', f, f, 0.01, 0.4, 0.09), i * 90)); },
    ui() { tone('square', 620, 620, 0.003, 0.04, 0.05); },
    deny() { tone('square', 180, 120, 0.004, 0.10, 0.07); },
    lava() { noise(0.5, 300, 140, 0.07, 0.9); tone('sawtooth', 80, 50, 0.05, 0.4, 0.05); },
    /* 洞穴底噪：一个很轻的低频轰鸣，让"在地下"这件事有体感 */
    startDrone() {
      if (!ensure() || drone) return;
      drone = AC.createOscillator(); drone.type = 'sawtooth'; drone.frequency.value = 42;
      const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 120;
      const g = AC.createGain(); g.gain.value = 0.05;
      drone.connect(f); f.connect(g); g.connect(master); drone.start();
    },
    stopDrone() { if (drone) { try { drone.stop(); } catch (e) { } drone = null; } }
  };
  root.VeinAudio = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
