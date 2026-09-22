// Level data. Hand-made levels first, then generated ones forever after.
// Every level is checked by actually driving the car along its hint line:
// the hint must win, and driving with no line must lose.
import { simulate, smoothPath, smoothStroke, pathLength } from './sim.js';

// Columns get bevelled top corners so wheels roll over edges instead of snagging.
const B = 0.18;
const col = (x0, x1, top, bottom = -6) =>
  [[x0, bottom], [x1, bottom], [x1, top - B], [x1 - B, top], [x0 + B, top], [x0, top - B]];
const block = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const left = (x1, top) => col(-40, x1, top);
const right = (x0, top) => col(x0, 50, top);

// Plateau at y=10.5, smooth cosine drop to y=7, then a small kicker ending at x=6.
function skiSlope() {
  const top = [];
  for (let i = 0; i <= 16; i++) {
    const u = i / 16;
    top.push([1.8 + u * 3.4, 7 + 3.5 * (1 + Math.cos(Math.PI * u)) / 2]);
  }
  top.push([5.6, 7.1], [6, 7.35]);
  return [[-40, -6], [6, -6], ...top.reverse(), [-40, 10.5]];
}

export const HANDMADE = [
  { // 1. first bridge (tutorial: the hint is shown as a guide)
    ink: 6, car: [1.3, 7], goal: [8.3, 7], guide: true,
    ground: [left(3, 7), right(7, 7)],
    hint: [[2.6, 7.05], [7.4, 7.05]],
  },
  { // 2. downhill (the goal is too far to just jump down to)
    ink: 8.5, car: [1.3, 8.5], goal: [8.7, 4.5],
    ground: [left(3, 8.5), right(7.6, 4.5)],
    hint: [[2.5, 8.55], [4.0, 7.9], [6.2, 5.3], [7.6, 4.62], [8.4, 4.55]],
  },
  { // 3. uphill
    ink: 7, car: [1.3, 4.5], goal: [8.4, 6.8],
    ground: [left(3.2, 4.5), right(7, 6.8)],
    hint: [[2.7, 4.55], [7.4, 6.85]],
  },
  { // 4. over the pillar
    ink: 6.5, car: [1.3, 5], goal: [8.4, 5],
    ground: [left(3, 5), col(4.6, 5.4, 6.3), right(7, 5)],
    hint: [[2.6, 5.05], [4.5, 6.45], [5.5, 6.45], [7.4, 5.05]],
  },
  { // 5. spike pit - dip down for the stars, but not too far
    ink: 6.5, car: [1.3, 7], goal: [8.4, 7],
    ground: [left(3, 7), col(3, 7, 2.2), right(7, 7)],
    spikes: [[3, 7, 2.2]],
    hint: [[2.6, 7.05], [5, 5.9], [7.4, 7.05]],
  },
  { // 6. short ink: build a kicker and jump
    ink: 2.2, car: [1.3, 8], goal: [8.2, 6.5],
    ground: [left(3.5, 8), right(6.9, 6.5)],
    hint: [[3.1, 8.05], [4.6, 8.65]],
  },
  { // 7. island: the car drops onto it by itself - bridge the second gap
    ink: 3.6, car: [1.3, 8], goal: [9.3, 6.5],
    ground: [left(3, 8), block(4.8, 5.8, 6.2, 6.5), right(8.8, 6.5)],
    hint: [[5.8, 6.55], [9.2, 6.55]],
  },
  { // 8. long slide down past the spikes; the overhang stops you from just flying over
    ink: 12, car: [1.3, 11], goal: [9.4, 2.6],
    ground: [left(2.8, 11), col(2.8, 8.6, 1.6), right(8.6, 2.6), block(7.4, 5.4, 50, 40)],
    spikes: [[2.8, 8.6, 1.6]],
    hint: [[2.5, 11.05], [4.25, 7.4], [5.9, 4.8], [7.55, 3.25], [9.2, 2.75]],
  },
  { // 9. climb over spikes to a higher goal, tight ink
    ink: 6.2, car: [1.3, 4.5], goal: [8.4, 7.2],
    ground: [left(3, 4.5), col(3, 7.2, 2), right(7.2, 7.2)],
    spikes: [[3, 7.2, 2]],
    hint: [[2.6, 4.55], [7.5, 7.25]],
  },
  { // 10. ski jump: the slope alone falls short of the goal
    ink: 2.4, car: [1.0, 10.5], goal: [9.1, 6.4],
    ground: [skiSlope(), col(6, 8.3, 1.8), right(8.3, 6.4)],
    spikes: [[6, 8.3, 1.8]],
    hint: [[5.2, 7.06], [6.0, 7.42], [6.8, 7.9]],
  },
];

const cache = new Map();

// Long levels: from 11 on, every 4th level is several sections joined by checkpoints.
export function isLong(n) {
  return n > HANDMADE.length && (n - 11) % 4 === 0;
}

function sectionCount(n) {
  return n >= 50 ? 5 : n >= 30 ? 4 : 3;
}

// 0 at the end of the hand-made levels, 1 by level 50.
function difficulty(n) {
  return Math.min(1, Math.max(0, (n - HANDMADE.length) / 40));
}

export function getLevel(n) {
  if (!cache.has(n)) {
    let level;
    if (n <= HANDMADE.length) level = buildLevel(HANDMADE[n - 1]);
    else if (isLong(n)) level = generateLong(n);
    else level = generate(n);
    level.n = n;
    cache.set(n, level);
  }
  return cache.get(n);
}

// A one-section level from a definition in world coordinates. Stars are
// placed on the path the car takes along the hint line.
export function buildLevel(def, starAt = [0.2, 0.5, 0.8]) {
  const section = {
    x0: 0, ink: def.ink, car: def.car, goal: def.goal, guide: !!def.guide,
    hint: smoothPath(def.hint, 0.2),
  };
  const level = { ground: def.ground, spikes: def.spikes || [], stars: [], sections: [section] };
  const run = simulate(level, section.hint, { trace: true });
  level.check = { hintWins: run.won, hintReason: run.reason, hintTime: run.time };
  level.stars = def.stars || (run.won ? starsOnTrace(run.trace, section.hint, starAt) : []);
  return level;
}

function starsOnTrace(trace, hint, fractions) {
  const x0 = hint[0][0], x1 = hint[hint.length - 1][0];
  const pts = trace.filter(([x]) => x >= Math.min(x0, x1) && x <= Math.max(x0, x1));
  if (pts.length < 3) return [];
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = acc[acc.length - 1];
  return fractions.map((f) => {
    const i = acc.findIndex((d) => d >= f * total);
    return [round2(pts[i][0]), round2(pts[i][1])];
  });
}

const round2 = (v) => Math.round(v * 100) / 100;

// A wobbly, hand-drawn-looking copy of a path. People aim the ends of a
// stroke, so the wobble fades in over the first and last metre.
export function jitter(path, seed, amount) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  const a1 = rnd() * amount * 2, a2 = rnd() * amount * 2, ph = rnd() * 6;
  const d0 = rnd() * amount * 0.8, d1 = rnd() * amount * 0.8;
  const last = path.length - 1;
  return path.map(([x, y], i) => {
    const env = Math.min(1, i / 5, (last - i) / 5);
    const end = d0 + (d1 - d0) * (i / last);
    return [x, y + end + env * (a1 * Math.sin(i * 0.25 + ph) + a2 * Math.sin(i * 0.61))];
  });
}

// A generated section is kept only if its hint wins, driving with no line
// loses, and at least 5 of 6 wobbly versions of the hint still win.
function playable(level, seed, starCount) {
  if (!level.check.hintWins || level.stars.length < starCount) return false;
  if (simulate(level, null).won) return false;
  const hint = level.sections[0].hint;
  let wins = 0;
  for (let t = 0; t < 6; t++) if (simulate(level, smoothStroke(jitter(hint, seed * 31 + t * 7 + 1, 0.25))).won) wins++;
  return wins >= 5;
}

// ---- generator ----

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// One random section in local coordinates (x from 0 to 10).
// startY forces the start height so sections can be chained.
function candidate(rnd, { startY, d }) {
  const r = (a, b) => a + rnd() * (b - a);
  const pool = ['gap', 'pillar', 'spikes', 'island'];
  if (startY === undefined || startY >= 9) pool.push('drop');
  if (d > 0.1) pool.push('jump', 'tunnel');
  if (d > 0.5) pool.push('jump', 'tunnel', 'spikes');
  const kind = pool[Math.floor(rnd() * pool.length)];
  const ex = r(2.6, 3.4);
  let sy = startY ?? r(4.5, 11);
  let gx = r(6.4, 7.6);
  // Chained sections drift back toward mid-screen so long levels don't sink to the water.
  let gy = startY === undefined ? clamp(sy + r(-4, 1.4), 2.5, 11) : clamp(sy + (7 - sy) * 0.5 + r(-2.5, 1.5), 2.5, 11);
  const mid = [];
  const spikes = [];
  const spikeFloor = () => {
    const floor = Math.max(1.4, Math.min(sy, gy) - r(2, 3.5));
    mid.push(col(ex, gx, floor));
    spikes.push([ex, gx, floor]);
    return floor;
  };
  let ctrl;
  if (kind === 'drop') {
    if (startY === undefined) sy = r(10, 12.5);
    gy = r(2.5, 4); gx = r(7.6, 8.4);
    ctrl = [[ex - 0.4, sy + 0.05], [ex + 1.2, sy - 0.6], [(ex + gx) / 2 + 0.6, (sy + gy) / 2 - 0.4], [gx - 0.2, gy + 0.3], [gx + 0.5, gy + 0.05]];
  } else if (kind === 'pillar') {
    gy = Math.min(gy, sy + 0.5);
    const px = (ex + gx) / 2;
    const top = Math.max(sy, gy) + r(0.6, 1.3);
    mid.push(col(px - 0.4, px + 0.4, top));
    ctrl = [[ex - 0.4, sy + 0.05], [px - 0.5, top + 0.15], [px + 0.5, top + 0.15], [gx + 0.4, gy + 0.05]];
  } else if (kind === 'spikes') {
    const floor = spikeFloor();
    const low = Math.max(floor + 1.6, (sy + gy) / 2 - r(0, 0.9));
    ctrl = [[ex - 0.4, sy + 0.05], [(ex + gx) / 2, low], [gx + 0.4, gy + 0.05]];
  } else if (kind === 'island') {
    const ix = (ex + gx) / 2 + r(-0.4, 0.4);
    const iy = Math.min(sy, gy) - r(0.3, 1.5);
    mid.push(block(ix - 0.7, iy - 0.6, ix + 0.7, iy));
    ctrl = [[ex - 0.4, sy + 0.05], [ix - 0.6, iy + 0.1], [ix + 0.6, iy + 0.1], [gx + 0.4, gy + 0.05]];
  } else if (kind === 'jump') {
    // Not enough ink to bridge the gap: draw a kicker and fly.
    gy = clamp(sy - r(0, 2), 2.5, 11);
    gx = ex + r(2.8, 3.8);
    if (rnd() < 0.5) spikeFloor();
    ctrl = [[ex - 0.4, sy + 0.05], [ex + 0.5, sy + 0.22], [ex + 1.3, sy + 0.7]];
  } else if (kind === 'tunnel') {
    // A ceiling over spikes: the road has to stay low and straight.
    gy = clamp(sy + r(-1.5, 0.8), 2.5, 11);
    spikeFloor();
    const ceiling = Math.max(sy, gy) + r(1.25, 1.6);
    mid.push(block(ex + 0.5, ceiling, gx - 0.5, 40));
    ctrl = [[ex - 0.4, sy + 0.05], [gx + 0.4, gy + 0.05]];
  } else {
    ctrl = [[ex - 0.4, sy + 0.05], [gx + 0.4, gy + 0.05]];
  }
  const hint = smoothPath(ctrl, 0.2);
  const tight = Math.max(1.1, 1.45 - 0.35 * d);
  const ink = Math.ceil(pathLength(hint) * r(tight, tight + 0.15) * 10) / 10;
  return {
    ink, car: [1.3, sy], goal: [gx + 1.2, gy], hint: ctrl, kind,
    ground: [left(ex, sy), ...mid, right(gx, gy)], mid, spikes, ex, gx, sy, gy,
  };
}

function generate(n) {
  const d = difficulty(n);
  for (let attempt = 0; attempt < 40; attempt++) {
    const def = candidate(mulberry32(n * 7919 + attempt * 104729), { d });
    const level = buildLevel(def);
    if (!playable(level, n, 3)) continue;
    level.sections[0].kind = def.kind;
    return level;
  }
  return buildLevel(HANDMADE[0]);
}

// Several generated sections side by side. Each section's goal platform is
// the next section's start platform, so they must share the same height.
function generateLong(n) {
  const d = difficulty(n);
  const count = sectionCount(n);
  let startY = 5 + mulberry32(n * 7919 + 17)() * 4;
  const parts = [];
  for (let k = 0; k < count; k++) {
    let part = null;
    for (let attempt = 0; attempt < 40 && !part; attempt++) {
      const def = candidate(mulberry32(n * 7919 + k * 1543 + attempt * 104729), { startY, d });
      const level = buildLevel(def, [0.5]);
      if (playable(level, n * 10 + k, 1)) part = { def, level };
    }
    if (!part) part = flatSection(startY);
    parts.push(part);
    startY = part.def.gy;
  }

  const ground = [], spikes = [], stars = [], sections = [];
  parts.forEach(({ def, level }, k) => {
    const x0 = k * 10;
    const shift = (pts) => pts.map(([x, y]) => [x + x0, y]);
    ground.push(k === 0 ? left(def.ex, def.sy) : col(x0 - 10 + parts[k - 1].def.gx, x0 + def.ex, def.sy));
    for (const poly of def.mid) ground.push(shift(poly));
    if (k === count - 1) ground.push(right(x0 + def.gx, def.gy));
    for (const [a, b, y] of def.spikes) spikes.push([a + x0, b + x0, y]);
    stars.push(...shift(level.stars));
    sections.push({
      x0, ink: def.ink, car: [def.car[0] + x0, def.car[1]], goal: [def.goal[0] + x0, def.goal[1]],
      hint: shift(level.sections[0].hint), kind: def.kind,
    });
  });
  return { ground, spikes, stars, sections, long: true };
}

// Fallback section that is always solvable: a plain bridge at one height.
function flatSection(y) {
  const def = {
    ink: 6, car: [1.3, y], goal: [8.2, y], hint: [[2.6, y + 0.05], [7.4, y + 0.05]], kind: 'gap',
    ground: [left(3, y), right(7, y)], mid: [], spikes: [], ex: 3, gx: 7, sy: y, gy: y,
  };
  return { def, level: buildLevel(def, [0.5]) };
}
