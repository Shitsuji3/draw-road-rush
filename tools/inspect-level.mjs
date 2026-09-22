// Level design helper: explains how one level plays.
// Usage: node tools/inspect-level.mjs <level> [section]
//  - the car's path along the hint line
//  - what happens with no line, and with lazy flat stubs off the start ledge
//  - why wobbly hand-drawn versions of the hint fail
import { getLevel, jitter } from '../game/src/levels.js';
import { simulate, smoothStroke, resample } from '../game/src/sim.js';

const n = Number(process.argv[2] || 1);
const section = Number(process.argv[3] || 1) - 1;
const level = getLevel(n);
const sec = level.sections[section];
const opt = { section };
const fmt = (r) => (r.won ? `WIN ${r.time.toFixed(1)}s, ${r.stars}★` : r.reason);
const end = (r) => { const [x, y] = r.trace.at(-1); return `(${x.toFixed(1)},${y.toFixed(1)})`; };

const hint = simulate(level, sec.hint, { ...opt, trace: true });
console.log(`level ${n} section ${section + 1}/${level.sections.length} (${sec.kind || 'hand'}): ink ${sec.ink}, stars at ${JSON.stringify(level.stars)}`);
console.log(`hint:    ${fmt(hint)}`);
console.log('  path: ' + hint.trace.filter((_, i) => i % 15 === 0).map(([x, y]) => `(${x.toFixed(1)},${y.toFixed(1)})`).join(' '));
const bare = simulate(level, null, { ...opt, trace: true });
console.log(`no line: ${fmt(bare)} at ${end(bare)}`);
const [x0, y0] = sec.hint[0];
console.log('stubs:   ' + [1, 2, 3].map((len) => `${len}m ${fmt(simulate(level, resample([[x0, y0], [x0 + Math.min(len, sec.ink), y0]], 0.2), opt))}`).join(', '));
const wobbly = [];
for (let t = 0; t < 12; t++) {
  const r = simulate(level, smoothStroke(jitter(sec.hint, 1000 + t * 77 + n, 0.25)), { ...opt, trace: true });
  wobbly.push(r.won ? 'W' : `${r.reason}@${end(r)}`);
}
console.log('wobbly:  ' + wobbly.join(' '));
