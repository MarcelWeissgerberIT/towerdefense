// Sound effects with WebAudio: recorded effects from one audio sprite (assets/audio/sfx.mp3, cut from
// the audio tracks of generated sound clips) with procedural synthesis as fallback and for UI blips.

let ctx = null, master = null, noiseBuf = null;
let sprite = null, spriteMap = null, spriteLoading = null;
let sirenH = null;
let enabled = true;
const last = {};

function init() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.8;
  // phones can't reproduce deep bass - filter it out before the compressor so inaudible rumble
  // doesn't pump everything else down (desktop keeps the low end)
  const phone = matchMedia('(pointer: coarse)').matches;
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass'; hpf.frequency.value = phone ? 110 : 32; hpf.Q.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 5;
  comp.attack.value = 0.003; comp.release.value = 0.25;
  master.connect(hpf).connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  loadSprite();
}

function loadSprite() {
  if (spriteLoading || !ctx) return;
  spriteLoading = Promise.all([
    fetch('assets/audio/sfx.json').then(r => r.json()),
    fetch('assets/audio/sfx.mp3').then(r => r.arrayBuffer()),
  ]).then(([map, data]) => new Promise((res, rej) => ctx.decodeAudioData(data, res, rej)).then(buf => { sprite = buf; spriteMap = map; }))
    .catch(() => { spriteLoading = null; });
}

// play a sprite region; returns null if the sprite isn't there (caller falls back to synthesis)
function play(name, { gain = 1, rate = 1, offset = 0, dur = null, delay = 0, fadeIn = 0, fadeOut = 0.02, loop = false } = {}) {
  const m = spriteMap && spriteMap[name];
  if (!sprite || !m) return null;
  const src = ctx.createBufferSource();
  src.buffer = sprite;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  const t0 = ctx.currentTime + delay;
  const len = Math.min(dur ?? m[1] - offset, m[1] - offset) / rate;
  if (fadeIn) { g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + fadeIn); } else g.gain.setValueAtTime(gain, t0);
  if (loop) { src.loop = true; src.loopStart = m[0]; src.loopEnd = m[0] + m[1]; }
  else {
    g.gain.setValueAtTime(gain, t0 + Math.max(fadeIn, len - fadeOut));
    g.gain.linearRampToValueAtTime(0, t0 + len);
    src.stop(t0 + len + 0.02);
  }
  src.connect(g).connect(master);
  src.start(t0, m[0] + offset);
  return { src, g, t0 };
}
const pick = (base, n) => base + (1 + Math.floor(Math.random() * n));
const vary = (a = 0.06) => 1 + (Math.random() * 2 - 1) * a;
// several sounds of the same kind at once: get quieter instead of louder
const active = {};
function voices(key, max, life) {
  const now = performance.now();
  const list = (active[key] || []).filter(t => now - t < life);
  if (list.length >= max) { active[key] = list; return 0; }
  list.push(now); active[key] = list;
  return 1 / Math.sqrt(list.length);
}

export function unlockAudio() {
  init();
  if (ctx && ctx.state !== 'running') ctx.resume();
}

if (typeof document !== 'undefined') for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, () => { if (enabled) unlockAudio(); }, { capture: true, passive: true });

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
    if (play('gatling', { offset: 0.1 + Math.random() * 2.6, dur: 0.16, gain: 0.9, rate: vary(0.05), fadeIn: 0.004, fadeOut: 0.06 })) return;
    const t = ctx.currentTime;
    noise(t, 0.06, { freq: 2200, q: 0.7, gain: 0.22 });
    noise(t, 0.05, { freq: 300, type: 'lowpass', q: 0.5, gain: 0.25 });
  },
  missile() {
    if (!throttle('mis', 90)) return;
    const v = voices('mis', 4, 900);
    if (!v) return;
    if (play(pick('missile', 2), { gain: v, rate: vary(), dur: 1.3, fadeOut: 0.5 })) return;
    const t = ctx.currentTime;
    noise(t, 0.5, { freq: 600, sweepTo: 2400, q: 1.2, gain: 0.28, attack: 0.03 });
    tone(t, 0.25, { type: 'sawtooth', f0: 120, f1: 60, gain: 0.08 });
  },
  plasma() {
    if (!throttle('pla', 80)) return;
    if (play(pick('plasma', 3), { gain: 1, rate: vary(), dur: 0.8, fadeOut: 0.3 })) return;
    const t = ctx.currentTime;
    tone(t, 0.35, { type: 'sawtooth', f0: 900, f1: 90, gain: 0.16 });
    tone(t, 0.3, { type: 'sine', f0: 300, f1: 60, gain: 0.25 });
  },
  rail() {
    if (!throttle('rail', 90)) return;
    if (play(pick('rail', 2), { gain: 1, rate: vary(0.04), dur: 1.2, fadeOut: 0.5 })) return;
    const t = ctx.currentTime;
    tone(t, 0.12, { type: 'square', f0: 2400, f1: 300, gain: 0.12 });
    noise(t, 0.45, { freq: 5000, sweepTo: 400, q: 0.6, gain: 0.35 });
    tone(t + 0.02, 0.5, { type: 'sine', f0: 90, f1: 40, gain: 0.35 });
  },
  emp() {
    if (!throttle('emp', 120)) return;
    if (play(pick('emp', 4), { gain: 1, rate: vary() })) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 4; i++) noise(t + i * 0.03, 0.05, { freq: 3000 + Math.random() * 3000, q: 4, gain: 0.18 });
    tone(t, 0.25, { type: 'square', f0: 120, f1: 80, gain: 0.07 });
  },
  explosion(big = false) {
    if (!throttle(big ? 'exB' : 'ex', big ? 120 : 70)) return;
    const v = voices(big ? 'exB' : 'ex', big ? 3 : 5, big ? 1500 : 700);
    if (!v) return;
    if (big ? play(pick('boomBig', 3), { gain: v, rate: vary(0.08) }) : play(pick('boomSmall', 5), { gain: v, rate: vary(0.1), dur: 0.9, fadeOut: 0.35 })) return;
    const t = ctx.currentTime;
    noise(t, big ? 1.4 : 0.6, { freq: big ? 900 : 1400, sweepTo: 60, type: 'lowpass', q: 0.3, gain: big ? 0.9 : 0.45 });
    noise(t, big ? 0.5 : 0.25, { freq: 1600, q: 0.7, gain: big ? 0.35 : 0.2 });
    tone(t, big ? 0.9 : 0.4, { type: 'sine', f0: big ? 90 : 120, f1: 30, gain: big ? 0.6 : 0.3 });
  },
  laser() {
    if (!throttle('las', 160)) return;
    const t = ctx.currentTime;
    tone(t, 0.18, { type: 'sawtooth', f0: 1400 + Math.random() * 200, f1: 1200, gain: 0.03 });
  },
  cryo() {
    if (!throttle('cry', 120)) return;
    if (play('cryo', { offset: Math.random() * 0.6, dur: 0.45, gain: 0.9, rate: vary(), fadeIn: 0.05, fadeOut: 0.2 })) return;
    const t = ctx.currentTime;
    noise(t, 0.22, { freq: 5200, q: 0.6, type: 'highpass', gain: 0.07, attack: 0.03 });
    tone(t, 0.2, { type: 'sine', f0: 2400 + Math.random() * 300, f1: 2100, gain: 0.012 });
  },
  freeze() {
    if (!throttle('frz', 90)) return;
    if (play('freeze', { gain: 1, rate: vary(0.1) })) return;
    const t = ctx.currentTime;
    noise(t, 0.12, { freq: 3800, q: 2.5, gain: 0.25 });
    noise(t + 0.05, 0.25, { freq: 6000, type: 'highpass', gain: 0.12 });
    tone(t, 0.3, { type: 'triangle', f0: 1800, f1: 2600, gain: 0.04 });
  },
  acid() {
    if (!throttle('acd', 120)) return;
    if (play(pick('acid', 2), { gain: 0.7, rate: vary(0.1), dur: 0.35, fadeOut: 0.15 })) return;
    const t = ctx.currentTime;
    tone(t, 0.16, { type: 'sine', f0: 220, f1: 90, gain: 0.25 });
    noise(t, 0.12, { freq: 900, q: 1.2, gain: 0.12 });
  },
  acidHit() {
    if (!throttle('ach', 80)) return;
    if (play(pick('acid', 2), { gain: 1, rate: vary(0.1), dur: 0.8, fadeOut: 0.3 })) return;
    const t = ctx.currentTime;
    noise(t, 0.35, { freq: 1400, q: 0.5, type: 'lowpass', gain: 0.18, sweepTo: 300 });
    noise(t + 0.08, 0.5, { freq: 4500, type: 'highpass', gain: 0.05, attack: 0.05 });
  },
  orbital() {
    // the clip's beam impact sits at 1.15 s = when the strike lands
    if (play('orbital', { gain: 1 })) return;
    const t = ctx.currentTime;
    tone(t, 1.2, { type: 'sawtooth', f0: 1800, f1: 120, gain: 0.08, attack: 0.3 });
    noise(t, 1.2, { freq: 3000, q: 0.5, sweepTo: 200, gain: 0.08, attack: 0.4 });
  },
  siren() {
    sirenH = play('siren', { gain: 1, dur: 4, fadeOut: 0.3 });
    if (sirenH) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) tone(t + i * 0.8, 0.78, { type: 'sawtooth', f0: 420, f1: 880, gain: 0.07, attack: 0.05 });
  },
  nuke() {
    if (sirenH) {
      // the siren dies with the flash
      const t = ctx.currentTime;
      try { sirenH.g.gain.cancelScheduledValues(t); sirenH.g.gain.setValueAtTime(sirenH.g.gain.value, t); sirenH.g.gain.linearRampToValueAtTime(0, t + 0.08); } catch (e) { /* ignore */ }
      sirenH = null;
    }
    // flash crack
    noise(ctx.currentTime, 0.35, { freq: 2500, q: 0.4, type: 'highpass', gain: 0.6, attack: 0.002 });
    if (play('nuke', { gain: 1 })) {
      // extra sub-bass weight under the recording
      const t = ctx.currentTime;
      tone(t, 3.2, { type: 'sine', f0: 55, f1: 24, gain: 0.3, attack: 0.02 });
      return;
    }
    const t = ctx.currentTime;
    tone(t, 3.2, { type: 'sine', f0: 70, f1: 18, gain: 0.9, attack: 0.01 });
    tone(t, 1.6, { type: 'sawtooth', f0: 110, f1: 30, gain: 0.25 });
    noise(t, 3.5, { freq: 900, q: 0.4, type: 'lowpass', gain: 0.9, sweepTo: 80, attack: 0.01 });
    noise(t + 0.4, 3, { freq: 300, q: 0.5, type: 'lowpass', gain: 0.5, attack: 0.3 });
  },
  dropSpawn() {
    if (!throttle('drp', 200)) return;
    const t = ctx.currentTime;
    tone(t, 0.12, { type: 'triangle', f0: 880, gain: 0.06 });
    tone(t + 0.1, 0.18, { type: 'triangle', f0: 1320, gain: 0.06 });
  },
  powerup() {
    const t = ctx.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.07, 0.22, { type: 'square', f0: f, gain: 0.06 }));
    noise(t, 0.5, { freq: 2000, q: 0.5, sweepTo: 8000, gain: 0.08 });
  },
  holeOpen() {
    const h = play('holeLoop', { gain: 1, loop: true, fadeIn: 0.8 });
    if (h) {
      // 10 s of vortex, fading out into the collapse
      h.g.gain.setValueAtTime(1, h.t0 + 8.9);
      h.g.gain.linearRampToValueAtTime(0, h.t0 + 9.8);
      h.src.stop(h.t0 + 9.9);
      tone(h.t0, 9.6, { type: 'sine', f0: 48, f1: 34, gain: 0.15, attack: 0.8 });
      return;
    }
    const t = ctx.currentTime;
    tone(t, 9.6, { type: 'sine', f0: 55, f1: 36, gain: 0.35, attack: 0.6 });
    tone(t, 9.6, { type: 'triangle', f0: 82, f1: 60, gain: 0.08, attack: 1 });
    noise(t, 9.6, { freq: 400, q: 0.6, type: 'lowpass', gain: 0.18, attack: 1.2, sweepTo: 120 });
    noise(t, 1.2, { freq: 6000, q: 0.5, sweepTo: 300, gain: 0.12, attack: 0.05 });
  },
  holeCollapse() {
    if (play('holeCollapse', { gain: 1 })) { play('boomBig1', { gain: 0.6, rate: 0.75, delay: 0.1 }); return; }
    const t = ctx.currentTime;
    noise(t, 0.6, { freq: 200, q: 0.5, sweepTo: 5000, gain: 0.2, attack: 0.4 });
    tone(t + 0.5, 1.4, { type: 'sine', f0: 90, f1: 25, gain: 0.7 });
    noise(t + 0.5, 1.6, { freq: 700, q: 0.4, type: 'lowpass', gain: 0.5, sweepTo: 90 });
  },
  rankUp() {
    const t = ctx.currentTime;
    tone(t, 0.12, { type: 'square', f0: 660, gain: 0.05 });
    tone(t + 0.1, 0.12, { type: 'square', f0: 880, gain: 0.05 });
    tone(t + 0.2, 0.25, { type: 'square', f0: 1320, gain: 0.05 });
  },
  flame() {
    if (!throttle('flm', 110)) return;
    if (play('flame', { offset: 0.1 + Math.random() * 1.8, dur: 0.32, gain: 0.8, rate: vary(), fadeIn: 0.04, fadeOut: 0.14 })) return;
    noise(ctx.currentTime, 0.2, { freq: 700, q: 0.4, type: 'lowpass', gain: 0.12, attack: 0.02 });
  },
  flak() {
    if (!throttle('flk', 90)) return;
    const v = voices('flk', 4, 600);
    if (!v) return;
    if (play(pick('flak', 2), { gain: v, rate: vary(0.08), dur: 0.7, fadeOut: 0.3 })) return;
    const t = ctx.currentTime;
    noise(t, 0.08, { freq: 1500, q: 0.9, gain: 0.2 });
    noise(t + 0.18, 0.12, { freq: 500, type: 'lowpass', gain: 0.15 });
  },
  mortar() {
    if (!throttle('mor', 150)) return;
    if (play(pick('mortar', 2), { gain: 1, rate: vary(), dur: 1.2, fadeOut: 0.6 })) return;
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
    if (play('gatling', { offset: 0.1 + Math.random() * 2.6, dur: 0.09, gain: 0.45, rate: 1.25 + Math.random() * 0.1, fadeOut: 0.04 })) return;
    tone(ctx.currentTime, 0.08, { type: 'square', f0: 1800, f1: 600, gain: 0.03 });
  },
  enemyCannon() {
    if (!throttle('ec', 120)) return;
    if (play(pick('flak', 2), { gain: 0.6, rate: 0.8 + Math.random() * 0.1, dur: 0.5, fadeOut: 0.25 })) return;
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
  upgradeStart() {
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) noise(t + i * 0.12, 0.08, { freq: 2500 + i * 400, q: 3, gain: 0.12 });
    tone(t, 0.3, { type: 'square', f0: 200, f1: 260, gain: 0.05 });
  },
  sell() {
    const t = ctx.currentTime;
    [660, 440, 330].forEach((f, i) => tone(t + i * 0.06, 0.12, { type: 'triangle', f0: f, gain: 0.12 }));
  },
  click() { tone(ctx.currentTime, 0.05, { type: 'square', f0: 800, f1: 600, gain: 0.05 }); },
  error() { tone(ctx.currentTime, 0.18, { type: 'square', f0: 180, f1: 120, gain: 0.1 }); },
  alarm() {
    if (play('siren', { gain: 0.7, offset: 0.4, dur: 1.6, fadeOut: 0.4 })) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      tone(t + i * 0.45, 0.35, { type: 'sawtooth', f0: 330, f1: 440, gain: 0.09 });
    }
  },
  wave() {
    if (play('horn', { gain: 1, dur: 2.6, fadeOut: 1.0 })) return;
    const t = ctx.currentTime;
    tone(t, 1.2, { type: 'sawtooth', f0: 55, gain: 0.18, attack: 0.08 });
    tone(t, 1.2, { type: 'sawtooth', f0: 82.5, gain: 0.12, attack: 0.08 });
    noise(t, 1.0, { freq: 200, type: 'lowpass', gain: 0.25, attack: 0.1 });
  },
  baseHit() {
    if (!throttle('bh', 200)) return;
    if (play(pick('boomSmall', 5), { gain: 1, rate: 0.75, dur: 0.8, fadeOut: 0.3 })) { tone(ctx.currentTime, 0.25, { type: 'square', f0: 140, f1: 70, gain: 0.08 }); return; }
    const t = ctx.currentTime;
    tone(t, 0.3, { type: 'square', f0: 140, f1: 70, gain: 0.18 });
    noise(t, 0.5, { freq: 600, type: 'lowpass', gain: 0.4 });
  },
  victory() {
    if (play('victory', { gain: 1 })) return;
    const t = ctx.currentTime;
    [262, 330, 392, 523].forEach((f, i) => tone(t + i * 0.16, 0.5, { type: 'sawtooth', f0: f, gain: 0.08 }));
  },
  defeat() {
    if (play('defeat', { gain: 1 })) return;
    const t = ctx.currentTime;
    [392, 330, 262, 196].forEach((f, i) => tone(t + i * 0.22, 0.6, { type: 'sawtooth', f0: f, gain: 0.08 }));
  },
};

export function sfx(name, arg) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const fn = SFX[name];
  if (fn) try { fn(arg); } catch (e) { /* ignore */ }
}

// for tests / debugging
export function audioStatus() { return { state: ctx && ctx.state, sprite: !!sprite, sounds: spriteMap ? Object.keys(spriteMap).length : 0 }; }
