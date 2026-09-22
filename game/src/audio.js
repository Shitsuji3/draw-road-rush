// All sounds are synthesized with WebAudio, so the game ships no audio files.
// Nothing plays while YouTube (or the device) has audio turned off.
let ctx = null;
let master = null;
let enabled = true;
let paused = false;
let engine = null;

export function setAudioEnabled(on) {
  enabled = on;
  if (master) master.gain.value = on ? 0.5 : 0;
  if (!on) stopEngine();
}

// Must be called from a user gesture (browsers block audio until then).
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.5 : 0;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended' && !paused) ctx.resume();
}

export function pauseAudio() {
  paused = true;
  if (ctx) ctx.suspend();
}

export function resumeAudio() {
  paused = false;
  if (ctx && enabled) ctx.resume();
}

const ready = () => ctx && enabled && !paused && ctx.state === 'running';

function tone(freq, dur, { type = 'sine', vol = 0.3, slide = 0, delay = 0 } = {}) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.3, freq = 1200, q = 0.8, type = 'bandpass', delay = 0 } = {}) {
  const t = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  pencil() { if (ready()) noise(0.05, { vol: 0.08, freq: 3500, q: 2 }); },
  go() { if (ready()) { tone(220, 0.25, { type: 'square', vol: 0.08, slide: 1.8 }); startEngine(); } },
  star(i) { if (ready()) { const b = [880, 1109, 1319][i % 3]; tone(b, 0.18, { type: 'triangle', vol: 0.25 }); tone(b * 1.5, 0.22, { type: 'triangle', vol: 0.18, delay: 0.07 }); } },
  land(s) { if (ready()) { tone(90, 0.15, { type: 'sine', vol: 0.3 * s, slide: 0.5 }); noise(0.08, { vol: 0.12 * s, freq: 400 }); } },
  bump(s) { if (ready()) tone(140, 0.1, { type: 'square', vol: 0.12 * s, slide: 0.6 }); },
  crash() { if (ready()) { stopEngine(); noise(0.45, { vol: 0.45, freq: 700, q: 0.6, type: 'lowpass' }); tone(70, 0.4, { vol: 0.4, slide: 0.4 }); } },
  splash() { if (ready()) { stopEngine(); noise(0.6, { vol: 0.35, freq: 1800, q: 0.5 }); noise(0.3, { vol: 0.2, freq: 600, delay: 0.1 }); } },
  checkpoint() { if (ready()) { tone(784, 0.16, { type: 'triangle', vol: 0.22 }); tone(1175, 0.24, { type: 'triangle', vol: 0.2, delay: 0.1 }); } },
  win() { if (ready()) { stopEngine(); [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.25, delay: i * 0.09 })); } },
  click() { if (ready()) tone(660, 0.06, { type: 'triangle', vol: 0.15 }); },
  deny() { if (ready()) tone(160, 0.12, { type: 'square', vol: 0.08 }); },
};

function startEngine() {
  stopEngine();
  const o = ctx.createOscillator();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = 'sawtooth';
  o.frequency.value = 70;
  lfo.frequency.value = 18;
  lfoGain.gain.value = 12;
  lfo.connect(lfoGain).connect(o.frequency);
  f.type = 'lowpass';
  f.frequency.value = 500;
  g.gain.value = 0.05;
  o.connect(f).connect(g).connect(master);
  o.start();
  lfo.start();
  engine = { o, lfo, g };
}

export function setEngine(speed) {
  if (!engine || !ctx) return;
  engine.o.frequency.setTargetAtTime(60 + speed * 22, ctx.currentTime, 0.05);
}

export function stopEngine() {
  if (!engine) return;
  const { o, lfo, g } = engine;
  engine = null;
  try {
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    o.stop(ctx.currentTime + 0.2);
    lfo.stop(ctx.currentTime + 0.2);
  } catch (e) { /* already stopped */ }
}
