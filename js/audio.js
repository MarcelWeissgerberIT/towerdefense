// Procedural sound effects with WebAudio (no audio files needed).

let ctx = null, master = null, noiseBuf = null;
let enabled = true;
const last = {};

function init() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.55;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function unlockAudio() {
  init();
  if (ctx && ctx.state !== 'running') ctx.resume();
}

export function setSound(on) { enabled = on; }
export function soundOn() { return enabled; }

function throttle(key, ms) {
  const now = performance.now();
  if (last[key] && now - last[key] < ms) return false;
  last[key] = now;
  return true;
}

function noise(t0, dur, { freq = 1000, q = 0.8, type = 'bandpass', gain = 0.5, attack = 0.002, sweepTo = null } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.05);
}

function tone(t0, dur, { type = 'sine', f0 = 440, f1 = null, gain = 0.3, attack = 0.005 } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

const SFX = {
  gatling() {
    if (!throttle('gat', 55)) return;
    const t = ctx.currentTime;
    noise(t, 0.06, { freq: 2200, q: 0.7, gain: 0.22 });
    noise(t, 0.05, { freq: 300, type: 'lowpass', q: 0.5, gain: 0.25 });
  },
  missile() {
    if (!throttle('mis', 90)) return;
    const t = ctx.currentTime;
    noise(t, 0.5, { freq: 600, sweepTo: 2400, q: 1.2, gain: 0.28, attack: 0.03 });
    tone(t, 0.25, { type: 'sawtooth', f0: 120, f1: 60, gain: 0.08 });
  },
  plasma() {
    if (!throttle('pla', 80)) return;
    const t = ctx.currentTime;
    tone(t, 0.35, { type: 'sawtooth', f0: 900, f1: 90, gain: 0.16 });
    tone(t, 0.3, { type: 'sine', f0: 300, f1: 60, gain: 0.25 });
  },
  rail() {
    if (!throttle('rail', 90)) return;
    const t = ctx.currentTime;
    tone(t, 0.12, { type: 'square', f0: 2400, f1: 300, gain: 0.12 });
    noise(t, 0.45, { freq: 5000, sweepTo: 400, q: 0.6, gain: 0.35 });
    tone(t + 0.02, 0.5, { type: 'sine', f0: 90, f1: 40, gain: 0.35 });
  },
  emp() {
    if (!throttle('emp', 120)) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) noise(t + i * 0.03, 0.05, { freq: 3000 + Math.random() * 3000, q: 4, gain: 0.18 });
    tone(t, 0.25, { type: 'square', f0: 120, f1: 80, gain: 0.07 });
  },
  explosion(big = false) {
    if (!throttle(big ? 'exB' : 'ex', big ? 120 : 70)) return;
    const t = ctx.currentTime;
    noise(t, big ? 1.4 : 0.6, { freq: big ? 900 : 1400, sweepTo: 60, type: 'lowpass', q: 0.3, gain: big ? 0.9 : 0.45 });
    tone(t, big ? 0.9 : 0.4, { type: 'sine', f0: big ? 90 : 120, f1: 30, gain: big ? 0.6 : 0.3 });
  },
  laser() {
    if (!throttle('las', 160)) return;
    const t = ctx.currentTime;
    tone(t, 0.18, { type: 'sawtooth', f0: 1400 + Math.random() * 200, f1: 1200, gain: 0.03 });
  },
  flame() {
    if (!throttle('flm', 110)) return;
    noise(ctx.currentTime, 0.2, { freq: 700, q: 0.4, type: 'lowpass', gain: 0.12, attack: 0.02 });
  },
  flak() {
    if (!throttle('flk', 90)) return;
    const t = ctx.currentTime;
    noise(t, 0.08, { freq: 1500, q: 0.9, gain: 0.2 });
    noise(t + 0.18, 0.12, { freq: 500, type: 'lowpass', gain: 0.15 });
  },
  mortar() {
    if (!throttle('mor', 150)) return;
    const t = ctx.currentTime;
    tone(t, 0.35, { type: 'sine', f0: 70, f1: 35, gain: 0.5 });
    noise(t, 0.3, { freq: 400, type: 'lowpass', gain: 0.35 });
  },
  dive() {
    if (!throttle('dive', 300)) return;
    tone(ctx.currentTime, 0.6, { type: 'sawtooth', f0: 900, f1: 300, gain: 0.05 });
  },
  enemyShot() {
    if (!throttle('es', 70)) return;
    tone(ctx.currentTime, 0.08, { type: 'square', f0: 1800, f1: 600, gain: 0.03 });
  },
  enemyCannon() {
    if (!throttle('ec', 120)) return;
    const t = ctx.currentTime;
    noise(t, 0.12, { freq: 900, q: 0.7, gain: 0.16 });
    tone(t, 0.15, { type: 'sine', f0: 140, f1: 70, gain: 0.15 });
  },
  hit() {
    if (!throttle('hit', 45)) return;
    noise(ctx.currentTime, 0.04, { freq: 4500, q: 2, gain: 0.08 });
  },
  build() {
    const t = ctx.currentTime;
    noise(t, 0.15, { freq: 400, type: 'lowpass', gain: 0.4 });
    tone(t + 0.05, 0.12, { type: 'square', f0: 220, f1: 440, gain: 0.08 });
    tone(t + 0.15, 0.15, { type: 'square', f0: 440, f1: 660, gain: 0.08 });
  },
  upgrade() {
    const t = ctx.currentTime;
    [330, 440, 660].forEach((f, i) => tone(t + i * 0.07, 0.15, { type: 'square', f0: f, gain: 0.07 }));
  },
  sell() {
    const t = ctx.currentTime;
    [660, 440, 330].forEach((f, i) => tone(t + i * 0.06, 0.12, { type: 'triangle', f0: f, gain: 0.12 }));
  },
  click() { tone(ctx.currentTime, 0.05, { type: 'square', f0: 800, f1: 600, gain: 0.05 }); },
  error() { tone(ctx.currentTime, 0.18, { type: 'square', f0: 180, f1: 120, gain: 0.1 }); },
  alarm() {
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      tone(t + i * 0.45, 0.35, { type: 'sawtooth', f0: 330, f1: 440, gain: 0.09 });
    }
  },
  wave() {
    const t = ctx.currentTime;
    tone(t, 1.2, { type: 'sawtooth', f0: 55, gain: 0.18, attack: 0.08 });
    tone(t, 1.2, { type: 'sawtooth', f0: 82.5, gain: 0.12, attack: 0.08 });
    noise(t, 1.0, { freq: 200, type: 'lowpass', gain: 0.25, attack: 0.1 });
  },
  baseHit() {
    if (!throttle('bh', 200)) return;
    const t = ctx.currentTime;
    tone(t, 0.3, { type: 'square', f0: 140, f1: 70, gain: 0.18 });
    noise(t, 0.5, { freq: 600, type: 'lowpass', gain: 0.4 });
  },
  victory() {
    const t = ctx.currentTime;
    [262, 330, 392, 523].forEach((f, i) => tone(t + i * 0.16, 0.5, { type: 'sawtooth', f0: f, gain: 0.08 }));
  },
  defeat() {
    const t = ctx.currentTime;
    [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.22, 0.6, { type: 'sawtooth', f0: f, gain: 0.08 }));
  },
};

export function sfx(name, arg) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const fn = SFX[name];
  if (fn) try { fn(arg); } catch (e) { /* ignore */ }
}
