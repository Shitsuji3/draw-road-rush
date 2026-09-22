// Drives the car through every level headlessly and checks, for each section:
//  - the hint line wins
//  - the hint fits in the section's ink
//  - driving with no line loses
//  - wobbly human-like versions of the hint still win most of the time
// and for the whole level: driving every hint in one go (through the
// checkpoints) wins and collects every star.
// Usage: node tools/verify-levels.mjs [levelsAfterHandmade]
import { HANDMADE, getLevel, jitter } from '../game/src/levels.js';
import { simulate, simulateStage, pathLength, smoothStroke } from '../game/src/sim.js';

const extra = Number(process.argv[2] ?? 20);
const TRIALS = 12;

let bad = 0;
const rows = [];
for (let n = 1; n <= HANDMADE.length + extra; n++) {
  const t0 = performance.now();
  const level = getLevel(n);
  const problems = [];
  let wobblyWins = 0, wobblyTotal = 0;
  const noLine = [];
  level.sections.forEach((sec, k) => {
    const tag = level.sections.length > 1 ? `s${k + 1} ` : '';
    const hint = simulate(level, sec.hint, { section: k });
    if (!hint.won) problems.push(`${tag}hint fails (${hint.reason})`);
    const inkUse = pathLength(sec.hint);
    if (inkUse > sec.ink) problems.push(`${tag}hint needs ${inkUse.toFixed(1)}m ink > ${sec.ink}`);
    const bare = simulate(level, null, { section: k });
    noLine.push(bare.won ? 'WIN' : bare.reason);
    if (bare.won) problems.push(`${tag}wins with no line`);
    let ok = 0;
    for (let t = 0; t < TRIALS; t++) if (simulate(level, smoothStroke(jitter(sec.hint, 1000 + t * 77 + n + k * 13, 0.25)), { section: k }).won) ok++;
    if (ok < TRIALS * 0.6) problems.push(`${tag}fragile ${ok}/${TRIALS}`);
    wobblyWins += ok;
    wobblyTotal += TRIALS;
  });
  const stage = simulateStage(level, level.sections.map((s) => s.hint));
  if (!stage.won) problems.push(`full run fails in section ${stage.section + 1} (${stage.reason})`);
  if (stage.stars < level.stars.length) problems.push(`full run stars ${stage.stars}/${level.stars.length}`);
  if (problems.length) bad++;
  rows.push({
    n,
    kind: level.sections.map((s) => s.kind || 'hand').join('+'),
    run: stage.won ? 'win' : stage.reason,
    stars: `${stage.stars}/${level.stars.length}`,
    noLine: noLine.join(','),
    robust: `${Math.round((100 * wobblyWins) / wobblyTotal)}%`,
    ms: Math.round(performance.now() - t0),
    problems: problems.join('; ') || 'ok',
  });
}
console.table(rows);
console.log(bad ? `${bad} level(s) need work` : 'all levels ok');
process.exitCode = bad ? 1 : 0;
