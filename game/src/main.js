// Game flow: draw a line -> car drives -> win or fail -> next / retry.
import { createSim, STEP, WATER_Y, smoothStroke, resample, pathLength } from './sim.js';
import { getLevel, isLong, HANDMADE } from './levels.js';
import * as platform from './platform.js';
import { sfx, unlockAudio, setAudioEnabled, pauseAudio, resumeAudio, setEngine, stopEngine } from './audio.js';
import { createRenderer } from './render.js';
import { t, setLanguage } from './i18n.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = createRenderer(canvas);
const rand = (a, b) => a + Math.random() * (b - a);

const SAVE_VERSION = 1;
const INTERSTITIAL_EVERY = 3;   // levels between interstitial ads
// Prototype: every level can be picked from the level menu. Set to false for
// release so levels open one by one as they are cleared.
const ALL_LEVELS_OPEN = true;
let save = { v: SAVE_VERSION, level: 1, unlocked: 1, stars: {}, hints: {} };

const game = {
  n: 1, level: null, sim: null,
  phase: 'boot',            // draw | drawing | run | parking | won | failed
  phaseTime: 0, time: 0, last: undefined, acc: 0, raf: 0,
  section: 0, lines: [], got: [],   // long levels: current section, lines and stars from earlier sections
  camX: 0, camTarget: 0,
  stroke: null, ghost: null,
  ink: 0, inkMax: 0, inkBoostLevel: 0, inkTick: 0,
  goDelay: 0, pending: null,
  particles: [], shake: 0, dustTimer: 0,
  paused: false, busy: false, pointerId: null,
  returnOverlay: null,     // result screen hidden behind the level menu
};
const debug = platform.IN_PLAYABLES ? {} : readDebugParams();

boot();

async function boot() {
  onResize();
  renderer.draw({ time: 0, particles: [] });
  platform.firstFrameReady();

  const [raw, lang] = await Promise.all([platform.loadData(), platform.getLanguage()]);
  save = parseSave(raw);
  setLanguage(lang);
  applyTexts();
  setAudioEnabled(platform.isAudioEnabled());
  platform.onAudioEnabledChange(setAudioEnabled);
  platform.onPause(pause);
  platform.onResume(resume);
  bindInput();

  loadLevel(debug.level || Math.min(save.level, save.unlocked) || 1);
  platform.gameReady();
  game.raf = requestAnimationFrame(frame);
  if (!platform.IN_PLAYABLES) {
    // Test hooks: inspect state and advance time without requestAnimationFrame.
    window.__game = game;
    window.__debug = debug;
    window.__tick = (seconds) => {
      for (let i = 0; i < Math.round(seconds * 60); i++) {
        game.time += 1 / 60;
        game.phaseTime += 1 / 60;
        update(1 / 60);
      }
      render();
      return { phase: game.phase, sim: game.sim.state, reason: game.sim.failReason, stars: game.sim.stars.filter((s) => s.got).length };
    };
  }
}

// ---------- save data ----------

function parseSave(raw) {
  const base = { v: SAVE_VERSION, level: 1, unlocked: 1, stars: {}, hints: {} };
  if (!raw) return base;
  try {
    const d = JSON.parse(raw);
    const int = (v, min) => (Number.isFinite(v) ? Math.max(min, Math.floor(v)) : min);
    return {
      v: SAVE_VERSION,
      level: int(d.level, 1),
      unlocked: int(d.unlocked, 1),
      stars: typeof d.stars === 'object' && d.stars ? d.stars : {},
      hints: typeof d.hints === 'object' && d.hints ? d.hints : {},
    };
  } catch (e) {
    platform.logError(e);
    return base;
  }
}

function persist() {
  platform.saveData(JSON.stringify(save));
}

// ---------- level flow ----------

const sec = () => game.level.sections[game.section];

function loadLevel(n) {
  game.n = n;
  game.level = getLevel(n);
  game.ghost = null;
  game.section = 0;
  game.lines = [];
  game.got = [];
  game.camX = game.camTarget = 0;
  buildHudSections();
  if (save.level !== n) { save.level = n; persist(); }
  hideOverlays();
  startAttempt();
}

function startAttempt() {
  stopEngine();
  game.sim = createSim(game.level, { section: game.section, lines: game.lines, got: game.got });
  game.camTarget = sec().x0;
  game.phase = 'draw';
  game.phaseTime = 0;
  game.acc = 0;
  game.stroke = null;
  game.pending = null;
  game.inkMax = sec().ink * (game.inkBoostLevel === game.n ? 1.5 : 1);
  game.ink = game.inkMax;
  updateHud();
}

function retry() {
  if (game.busy || game.phase === 'parking') return;
  if (game.stroke && game.stroke.length > 1 && game.phase !== 'draw' && game.phase !== 'drawing') game.ghost = game.stroke;
  hideOverlays();
  startAttempt();
}

async function next() {
  if (game.busy) return;
  sfx.click();
  hideOverlays();
  const n = game.n + 1;
  if (game.n % INTERSTITIAL_EVERY === 0) {
    game.busy = true;
    await platform.showInterstitial();
    game.busy = false;
  }
  loadLevel(n);
}

async function watchAdFor(kind) {
  if (game.busy) return;
  sfx.click();
  game.busy = true;
  const ok = await platform.showRewarded(`${kind}-level-${game.n}`);
  game.busy = false;
  if (!ok) return;
  if (kind === 'hint') { save.hints[game.n] = 1; persist(); }
  if (kind === 'ink') game.inkBoostLevel = game.n;
  game.ghost = null;
  hideOverlays();
  startAttempt();
}

function hintVisible() {
  return sec().guide || !!save.hints[game.n];
}

// ---------- drawing ----------

function eventPoint(e, rect) {
  return renderer.toWorld(e.clientX - rect.left, e.clientY - rect.top);
}

// True if the segment a->b would pass through the car.
function hitsCar(a, b) {
  const c = game.sim.chassis.getPosition();
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
  for (let i = 0; i <= steps; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / steps - c.x;
    const y = a[1] + ((b[1] - a[1]) * i) / steps - c.y;
    if (Math.abs(x) < 0.85 && y > -0.62 && y < 0.72) return true;
  }
  return false;
}

function onDown(e) {
  unlockAudio();
  if (game.paused || game.busy || game.phase !== 'draw' || game.pointerId !== null) return;
  if (Math.abs(game.camX - game.camTarget) > 0.05) return;
  const p = eventPoint(e, canvas.getBoundingClientRect());
  if (hitsCar(p, p)) { sfx.deny(); return; }
  canvas.setPointerCapture(e.pointerId);
  game.pointerId = e.pointerId;
  game.stroke = [p];
  game.phase = 'drawing';
}

function onMove(e) {
  if (e.pointerId !== game.pointerId || game.phase !== 'drawing' || game.paused) return;
  const rect = canvas.getBoundingClientRect();
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of evs.length ? evs : [e]) addPoint(eventPoint(ev, rect));
}

function addPoint(p) {
  const pts = game.stroke;
  const last = pts[pts.length - 1];
  let d = Math.hypot(p[0] - last[0], p[1] - last[1]);
  if (d < 0.15) return;
  if (game.ink <= 0.02) { inkEmpty(); return; }
  if (d > game.ink) {
    const k = game.ink / d;
    p = [last[0] + (p[0] - last[0]) * k, last[1] + (p[1] - last[1]) * k];
    d = game.ink;
  }
  if (hitsCar(last, p)) return;
  const x0 = sec().x0;
  if (p[0] < x0 - 0.3 || p[0] > x0 + 10.3) return;   // stay inside this section
  pts.push(p);
  game.ink -= d;
  game.inkTick += d;
  if (game.inkTick > 0.45) { sfx.pencil(); game.inkTick = 0; }
  updateInk();
}

function onUp(e) {
  if (e.pointerId !== game.pointerId) return;
  game.pointerId = null;
  if (game.phase !== 'drawing') return;
  if (pathLength(game.stroke) < 0.4) {
    game.stroke = null;
    game.phase = 'draw';
    game.ink = game.inkMax;
    updateInk();
    return;
  }
  placeLine();
}

function placeLine() {
  const line = smoothStroke(resample(game.stroke, 0.2));
  game.stroke = line;
  game.sim.addLine(line);
  game.ghost = null;
  game.phase = 'run';
  game.phaseTime = 0;
  game.goDelay = 0.3;
}

function inkEmpty() {
  const bar = $('ink');
  if (!bar.classList.contains('empty')) {
    bar.classList.add('empty');
    sfx.deny();
    setTimeout(() => bar.classList.remove('empty'), 400);
  }
}

// ---------- main loop ----------

function frame(now) {
  if (game.paused) return;
  const dt = Math.min(0.05, game.last === undefined ? 0 : (now - game.last) / 1000);
  game.last = now;
  game.time += dt;
  game.phaseTime += dt;
  update(dt);
  render();
  game.raf = requestAnimationFrame(frame);
}

function update(dt) {
  const sim = game.sim;
  game.camX += (game.camTarget - game.camX) * Math.min(1, dt * 4);
  if (Math.abs(game.camTarget - game.camX) < 0.01) game.camX = game.camTarget;
  if (debug.auto && game.phase === 'draw' && game.phaseTime > 0.6 && game.camX === game.camTarget) {
    game.stroke = sec().hint.slice();
    placeLine();
  }
  if (game.phase === 'run' && sim.state === 'ready') {
    game.goDelay -= dt;
    if (game.goDelay <= 0) sim.go();
  }
  if (sim.state !== 'ready') {
    game.acc += dt;
    while (game.acc >= STEP) { sim.step(); game.acc -= STEP; }
  }
  handleEvents(sim);
  if (sim.state === 'running' || sim.state === 'parking') {
    const v = sim.chassis.getLinearVelocity().length();
    setEngine(v);
    game.dustTimer -= dt;
    if (sim.wheelContacts > 0 && v > 1.2 && game.dustTimer <= 0) { dust(1); game.dustTimer = 0.07; }
  }
  if (game.pending && game.phaseTime >= game.pending.at) {
    const fn = game.pending.fn;
    game.pending = null;
    fn();
  }
  for (const p of game.particles) {
    p.life -= dt;
    p.vy -= (p.g ?? 9) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot = (p.rot || 0) + (p.vr || 0) * dt;
  }
  game.particles = game.particles.filter((p) => p.life > 0);
  game.shake = Math.max(0, game.shake - dt * 2.5);
}

function handleEvents(sim) {
  for (const ev of sim.events) {
    if (ev.type === 'go') sfx.go();
    else if (ev.type === 'star') { sfx.star(ev.i); starBurst(sim.stars[ev.i]); updateHudStars(); }
    else if (ev.type === 'land') { sfx.land(ev.strength); game.shake = Math.max(game.shake, ev.strength * 0.45); dust(5); }
    else if (ev.type === 'bump') sfx.bump(ev.strength);
    else if (ev.type === 'splash') { sfx.splash(); splash(ev.x); }
    else if (ev.type === 'checkpoint') onCheckpoint();
    else if (ev.type === 'parked') onParked(ev.section);
    else if (ev.type === 'win') onWin();
    else if (ev.type === 'fail') onFail(ev.reason);
  }
  sim.events.length = 0;
}

function onCheckpoint() {
  game.phase = 'parking';
  sfx.checkpoint();
  confetti(sec().goal, 18);
  game.camTarget = game.level.sections[game.section + 1].x0;
}

function onParked(section) {
  game.lines.push(game.stroke);
  game.got = game.sim.stars.flatMap((s, i) => (s.got ? [i] : []));
  game.section = section;
  game.stroke = null;
  game.ghost = null;
  game.phase = 'draw';
  game.phaseTime = 0;
  game.inkMax = sec().ink * (game.inkBoostLevel === game.n ? 1.5 : 1);
  game.ink = game.inkMax;
  updateHud();
}

function onWin() {
  const n = game.n;
  const total = game.level.stars.length;
  const got = total ? Math.round((3 * game.sim.stars.filter((s) => s.got).length) / total) : 0;
  game.phase = 'won';
  game.phaseTime = 0;
  stopEngine();
  sfx.win();
  confetti(sec().goal, 50);
  save.stars[n] = Math.max(save.stars[n] || 0, got);
  save.unlocked = Math.max(save.unlocked, n + 1);
  save.level = n + 1;
  persist();
  game.pending = { at: 0.9, fn: () => showClear(got) };
  setTimeout(() => getLevel(n + 1), 1300);   // generate the next level while the player looks at the result
}

function onFail(reason) {
  game.phase = 'failed';
  game.phaseTime = 0;
  stopEngine();
  if (reason !== 'water') { sfx.crash(); debris(); game.shake = 0.8; }
  game.pending = { at: reason === 'water' ? 0.8 : 1.0, fn: () => showFail(reason) };
}

function render() {
  const p = game.phase;
  const drawing = p === 'draw' || p === 'drawing';
  renderer.draw({
    time: game.time, level: game.level, sim: game.sim, camX: game.camX,
    lines: game.lines, stroke: game.stroke, ghost: game.ghost,
    hint: drawing && hintVisible() ? sec().hint : null,
    finger: p === 'draw' && sec().guide ? sec().hint : null,
    idle: p === 'draw' || p === 'drawing' || (p === 'run' && game.sim.state === 'ready'),
    particles: game.particles, shake: game.shake,
  });
}

// ---------- particles ----------

function addP(p) {
  game.particles.push({ fade: true, life: p.max, ...p });
}

function dust(count) {
  const w = game.sim.wheels[0].getPosition();
  for (let i = 0; i < count; i++) {
    addP({ x: w.x - 0.15, y: w.y - 0.2, vx: rand(-1.6, -0.4), vy: rand(0.2, 1.2), g: 0.5, size: rand(0.07, 0.14), color: 'rgba(150,110,70,0.5)', max: 0.5, grow: true });
  }
}

function starBurst(s) {
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    addP({ x: s.x, y: s.y, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, g: 1, size: 0.13, color: '#ffd23f', shape: 'star', vr: 8, max: 0.55 });
  }
}

function splash(x) {
  for (let i = 0; i < 26; i++) {
    addP({ x: x + rand(-0.4, 0.4), y: WATER_Y, vx: rand(-2.5, 2.5), vy: rand(3, 7.5), g: 14, size: rand(0.06, 0.14), color: 'rgba(225,245,255,0.95)', max: 1 });
  }
}

function debris() {
  const c = game.sim.chassis.getPosition();
  const colors = ['#ff4d4d', '#d63a3a', '#2b2d42', '#dfe3ea', '#ffd23f'];
  for (let i = 0; i < 16; i++) {
    addP({ x: c.x, y: c.y, vx: rand(-4, 4), vy: rand(2, 7), g: 14, size: rand(0.12, 0.26), color: colors[i % colors.length], shape: 'rect', rot: rand(0, 6), vr: rand(-12, 12), max: 1.3, fade: false });
  }
}

function confetti([gx, gy], count) {
  const colors = ['#ff4d4d', '#ffd23f', '#4ccb5a', '#40a4f5', '#b86bff', '#ffffff'];
  for (let i = 0; i < count; i++) {
    addP({ x: gx + rand(-0.5, 0.8), y: gy + 2, vx: rand(-3.5, 3.5), vy: rand(4, 9), g: 7, size: rand(0.14, 0.24), color: colors[i % colors.length], shape: 'rect', rot: rand(0, 6), vr: rand(-10, 10), max: 2, fade: false });
  }
}

// ---------- UI ----------

function applyTexts() {
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
}

function buildHudSections() {
  const el = $('hud-sections');
  const count = game.level.sections.length;
  el.hidden = count < 2;
  el.innerHTML = '<span></span>'.repeat(count);
  $('hud-stars').innerHTML = '<span>★</span>'.repeat(game.level.stars.length);
}

function updateHud() {
  $('level-label').textContent = `${t('level')} ${game.n}`;
  $('hud-sections').querySelectorAll('span').forEach((el, i) => {
    el.className = i < game.section ? 'done' : i === game.section ? 'on' : '';
  });
  $('btn-hint').hidden = hintVisible();
  updateInk();
  updateHudStars();
}

function updateInk() {
  const k = game.inkMax ? Math.max(0, game.ink / game.inkMax) : 0;
  const fill = $('ink-fill');
  fill.style.transform = `scaleX(${k})`;
  fill.classList.toggle('low', k < 0.2);
  $('ink').classList.toggle('boost', game.inkBoostLevel === game.n);
}

function updateHudStars() {
  const got = game.sim ? game.sim.stars.map((s) => s.got) : [];
  $('hud-stars').querySelectorAll('span').forEach((el, i) => el.classList.toggle('on', !!got[i]));
}

function hideOverlays() {
  for (const id of ['ov-clear', 'ov-fail', 'ov-levels']) $(id).hidden = true;
  game.returnOverlay = null;
}

// Result screens wait behind the level menu while it is open.
function showOverlay(id) {
  if (!$('ov-levels').hidden) game.returnOverlay = id;
  else $(id).hidden = false;
}

function showClear(got) {
  $('clear-stars').querySelectorAll('span').forEach((el, i) => {
    el.classList.remove('on');
    if (i < got) setTimeout(() => { el.classList.add('on'); sfx.star(i); }, 250 + i * 260);
  });
  showOverlay('ov-clear');
}

function showFail(reason) {
  $('fail-title').textContent = t(reason);
  $('btn-fail-hint').hidden = hintVisible();
  $('btn-fail-ink').hidden = game.inkBoostLevel === game.n;
  showOverlay('ov-fail');
}

function toggleLevels() {
  if ($('ov-levels').hidden) openLevels();
  else closeLevels();
}

function openLevels() {
  sfx.click();
  for (const id of ['ov-clear', 'ov-fail']) {
    if (!$(id).hidden) { game.returnOverlay = id; $(id).hidden = true; }
  }
  const grid = $('level-grid');
  grid.textContent = '';
  const count = ALL_LEVELS_OPEN ? Math.max(60, save.unlocked + 10) : Math.max(HANDMADE.length, save.unlocked + 2);
  for (let i = 1; i <= count; i++) {
    const b = document.createElement('button');
    const locked = !ALL_LEVELS_OPEN && i > save.unlocked;
    const stars = save.stars[i] || 0;
    b.className = 'lv' + (isLong(i) ? ' long' : '') + (i === game.n ? ' current' : '');
    b.disabled = locked;
    b.innerHTML = `<b>${i}</b><i>${locked ? '' : '★'.repeat(stars) + '☆'.repeat(3 - stars)}</i>`;
    b.addEventListener('click', () => { sfx.click(); loadLevel(i); });
    grid.append(b);
  }
  $('ov-levels').hidden = false;
  grid.querySelector('.current')?.scrollIntoView({ block: 'center' });
}

// Closing the menu without picking a level brings back the result screen.
function closeLevels() {
  sfx.click();
  $('ov-levels').hidden = true;
  if (game.returnOverlay) $(game.returnOverlay).hidden = false;
  game.returnOverlay = null;
}

function onKey(e) {
  if (e.key === 'Escape') {
    if (!$('ov-levels').hidden) closeLevels();
    return;
  }
  if (e.key === 'r' || e.key === 'R') retry();
  else if (e.key === 'Enter' || e.key === ' ') {
    if (!$('ov-clear').hidden) next();
    else if (!$('ov-fail').hidden) retry();
    else return;
    e.preventDefault();
  }
}

function onResize() {
  renderer.resize($('hud').getBoundingClientRect().height);
}

function bindInput() {
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', () => { onResize(); if (game.paused) render(); });
  window.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', unlockAudio);
  const click = (id, fn) => $(id).addEventListener('click', fn);
  click('btn-retry', () => { sfx.click(); retry(); });
  click('btn-levels', toggleLevels);
  click('btn-levels-close', closeLevels);
  click('btn-hint', () => watchAdFor('hint'));
  click('btn-next', next);
  click('btn-clear-retry', () => { sfx.click(); retry(); });
  click('btn-fail-retry', () => { sfx.click(); retry(); });
  click('btn-fail-hint', () => watchAdFor('hint'));
  click('btn-fail-ink', () => watchAdFor('ink'));
}

// ---------- pause / resume (from the Playables SDK only) ----------

function pause() {
  if (game.paused) return;
  game.paused = true;
  cancelAnimationFrame(game.raf);
  pauseAudio();
  persist();
}

function resume() {
  if (!game.paused) return;
  game.paused = false;
  game.last = undefined;
  resumeAudio();
  game.raf = requestAnimationFrame(frame);
}

// ---------- local debugging (?level=5&auto=1&reset=1) ----------

function readDebugParams() {
  const q = new URLSearchParams(location.search);
  if (q.has('reset')) {
    try { localStorage.removeItem('draw-road-rush-save'); } catch (e) { /* storage blocked */ }
  }
  return { level: Number(q.get('level')) || 0, auto: q.has('auto') };
}
