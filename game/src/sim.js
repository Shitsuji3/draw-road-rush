// Physics + rules for one attempt at one level. No DOM here, so the same
// code runs in the browser and in the Node level verifier (tools/).
// World units are meters, y points up. Each section of a level is 10 x 16;
// long levels put several sections side by side, joined by checkpoints.
import { World, Vec2, Box, Circle, Chain, Polygon, WheelJoint } from './vendor/planck.mjs';

export const STEP = 1 / 120;
export const LINE_R = 0.11;          // half thickness of the drawn line
export const WATER_Y = 0.6;
export const MAX_TIME = 25;
export const CAR = {
  halfW: 0.62, halfH: 0.16,
  wheelR: 0.26, wheelX: 0.42, wheelY: -0.2,
  speed: 19,     // wheel rad/s -> about 5 m/s
  torque: 3,     // per wheel; must stay well below the chassis' righting torque
  angularDamping: 0.15,
  airDamping: 2.5,  // extra rotation damping while airborne keeps jumps from turning into backflips
};

const CAR_FILTER = { filterGroupIndex: -1 };

// section: where the car starts. lines: lines already drawn in earlier
// sections. got: indices of stars already collected.
export function createSim(level, { section = 0, lines = [], got = [] } = {}) {
  const world = new World({ gravity: Vec2(0, -10) });
  const sim = {
    world, level, section,
    goal: level.sections[section].goal,
    state: 'ready',       // ready -> running -> (parking -> ready ...) -> won | failed
    failReason: null,
    time: 0,
    stars: level.stars.map(([x, y], i) => ({ x, y, got: got.includes(i) })),
    events: [],
    wheelContacts: 0,
    flipTime: 0, stuckTime: 0, airTime: 0, parkTime: 0, parkClock: 0,
    trace: null,
  };

  for (const poly of level.ground) {
    const body = world.createBody();
    body.createFixture(new Chain(poly.map(([x, y]) => Vec2(x, y)), true),
      { friction: 0.9, userData: { kind: 'ground' } });
  }

  if (level.spikes.length || sim.stars.length) {
    const body = world.createBody();
    for (const [x0, x1, y] of level.spikes) {
      body.createFixture(new Box((x1 - x0) / 2, 0.16, Vec2((x0 + x1) / 2, y + 0.16)),
        { isSensor: true, userData: { kind: 'spike' } });
    }
    sim.stars.forEach((s, i) => {
      body.createFixture(new Circle(Vec2(s.x, s.y), 0.36),
        { isSensor: true, userData: { kind: 'star', i } });
    });
  }

  // Car: chassis + cabin, two sprung wheels, all-wheel drive.
  const [cx, groundY] = level.sections[section].car;
  const cy = groundY + CAR.wheelR - CAR.wheelY + 0.02;
  const chassis = world.createBody({ type: 'dynamic', position: Vec2(cx, cy), angularDamping: CAR.angularDamping });
  chassis.createFixture(new Box(CAR.halfW, CAR.halfH),
    { density: 5, friction: 0.5, ...CAR_FILTER, userData: { kind: 'car' } });
  chassis.createFixture(new Polygon([Vec2(-0.34, 0.14), Vec2(0.26, 0.14), Vec2(0.12, 0.44), Vec2(-0.26, 0.44)]),
    { density: 0.4, friction: 0.5, ...CAR_FILTER, userData: { kind: 'car' } });
  const wheels = [];
  const joints = [];
  for (const dx of [-CAR.wheelX, CAR.wheelX]) {
    const w = world.createBody({ type: 'dynamic', position: Vec2(cx + dx, cy + CAR.wheelY) });
    w.createFixture(new Circle(CAR.wheelR),
      { density: 1, friction: 1.2, restitution: 0.05, ...CAR_FILTER, userData: { kind: 'wheel' } });
    joints.push(world.createJoint(new WheelJoint(
      { motorSpeed: 0, maxMotorTorque: 20, enableMotor: true, frequencyHz: 5, dampingRatio: 0.75 },
      chassis, w, w.getPosition(), Vec2(0, 1))));
    wheels.push(w);
  }
  sim.chassis = chassis;
  sim.wheels = wheels;
  sim.joints = joints;
  for (const l of lines) addLine(sim, l);

  world.on('begin-contact', (c) => onContact(sim, c, +1));
  world.on('end-contact', (c) => onContact(sim, c, -1));

  // Let the car settle on its suspension so the drawing phase shows a resting car.
  for (let i = 0; i < 60; i++) world.step(STEP, 8, 3);
  sim.events.length = 0;

  sim.addLine = (points) => addLine(sim, points);
  sim.go = () => {
    for (const j of joints) { j.setMotorSpeed(-CAR.speed); j.setMaxMotorTorque(CAR.torque); }
    sim.state = 'running';
    sim.events.push({ type: 'go' });
  };
  sim.brake = () => {
    for (const j of joints) { j.setMotorSpeed(0); j.setMaxMotorTorque(4); }
  };
  sim.step = () => step(sim);
  return sim;
}

function onContact(sim, contact, delta) {
  const fa = contact.getFixtureA(), fb = contact.getFixtureB();
  const ua = fa.getUserData() || {}, ub = fb.getUserData() || {};
  const isCar = (u) => u.kind === 'car' || u.kind === 'wheel';
  let car, other, otherFix;
  if (isCar(ua) && !isCar(ub)) { car = ua; other = ub; otherFix = fb; }
  else if (isCar(ub) && !isCar(ua)) { car = ub; other = ua; otherFix = fa; }
  else return;

  if (other.kind === 'star') {
    if (delta > 0 && sim.state === 'running' && !sim.stars[other.i].got) {
      sim.stars[other.i].got = true;
      sim.events.push({ type: 'star', i: other.i });
    }
    return;
  }
  if (other.kind === 'spike') {
    if (delta > 0 && sim.state === 'running') fail(sim, 'spiked');
    return;
  }
  if (otherFix.isSensor()) return;
  if (car.kind === 'wheel') {
    sim.wheelContacts = Math.max(0, sim.wheelContacts + delta);
    if (delta > 0 && sim.airTime > 0.35) sim.events.push({ type: 'land', strength: Math.min(1, sim.airTime / 1.2) });
  } else if (delta > 0) {
    const v = sim.chassis.getLinearVelocity().length();
    if (v > 2.5) sim.events.push({ type: 'bump', strength: Math.min(1, v / 8) });
  }
}

function addLine(sim, points) {
  const body = sim.world.createBody();
  const opt = { friction: 0.9, userData: { kind: 'line' } };
  for (const [x, y] of points) body.createFixture(new Circle(Vec2(x, y), LINE_R), opt);
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-3) continue;
    body.createFixture(new Box(len / 2, LINE_R, Vec2((ax + bx) / 2, (ay + by) / 2), Math.atan2(by - ay, bx - ax)), opt);
  }
}

function fail(sim, reason) {
  if (sim.state !== 'running' && sim.state !== 'parking') return;
  sim.chassis.setAngularDamping(CAR.angularDamping);
  sim.state = 'failed';
  sim.failReason = reason;
  sim.brake();
  sim.events.push({ type: 'fail', reason });
}

export function normAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function step(sim) {
  sim.world.step(STEP, 8, 3);
  if (sim.state === 'parking') return park(sim);
  if (sim.state !== 'running') return;
  sim.time += STEP;
  sim.airTime = sim.wheelContacts > 0 ? 0 : sim.airTime + STEP;
  sim.chassis.setAngularDamping(sim.airTime > 0.1 ? CAR.airDamping : CAR.angularDamping);

  const p = sim.chassis.getPosition();
  const a = normAngle(sim.chassis.getAngle());
  if (sim.trace) sim.trace.push([p.x, p.y, sim.time]);

  const goal = sim.goal;
  if (p.x >= goal[0] && p.y > goal[1] - 0.3 && p.y < goal[1] + 3 && Math.abs(a) < 1.6) {
    if (sim.section < sim.level.sections.length - 1) {
      // Checkpoint: roll on slowly to the next section's start and stop there.
      sim.state = 'parking';
      sim.parkTime = 0;
      sim.parkClock = 0;
      sim.chassis.setAngularDamping(CAR.angularDamping);
      for (const j of sim.joints) { j.setMotorSpeed(-8); j.setMaxMotorTorque(CAR.torque); }
      sim.events.push({ type: 'checkpoint', section: sim.section });
    } else {
      sim.state = 'won';
      sim.brake();
      sim.events.push({ type: 'win' });
    }
    return;
  }
  if (p.y < WATER_Y - 0.1) { sim.events.push({ type: 'splash', x: p.x }); return fail(sim, 'water'); }
  if (p.x < goal[0] - 16 || p.x > goal[0] + 7) return fail(sim, 'lost');

  // Upside down, or stuck standing on its nose/tail.
  sim.flipTime = Math.abs(a) > 1.35 ? sim.flipTime + STEP : 0;
  if (sim.flipTime > (Math.abs(a) > 2 ? 0.9 : 1.4)) return fail(sim, 'flipped');

  const v = sim.chassis.getLinearVelocity().length();
  sim.stuckTime = sim.time > 1.2 && v < 0.3 ? sim.stuckTime + STEP : 0;
  if (sim.stuckTime > 1.6) return fail(sim, 'stuck');
  if (sim.time > MAX_TIME) return fail(sim, 'timeout');
}

function park(sim) {
  const next = sim.level.sections[sim.section + 1];
  const p = sim.chassis.getPosition();
  const v = sim.chassis.getLinearVelocity().length();
  const arrived = p.x >= next.car[0] - 0.5;
  if (arrived) sim.brake();
  sim.parkClock += STEP;
  sim.parkTime = arrived && v < 0.15 ? sim.parkTime + STEP : 0;
  if (sim.parkTime > 0.25) {
    sim.section += 1;
    sim.goal = next.goal;
    sim.state = 'ready';
    sim.time = 0;
    sim.flipTime = 0;
    sim.stuckTime = 0;
    sim.events.push({ type: 'parked', section: sim.section });
  } else if (sim.parkClock > 6) {
    fail(sim, 'stuck');
  }
}

// ---- helpers shared by the game, the generator and the verifier ----

// Catmull-Rom smoothing of a few control points, resampled every `spacing` m.
export function smoothPath(ctrl, spacing = 0.2) {
  if (ctrl.length < 3) return resample(ctrl, spacing);
  const dense = [];
  const P = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let t = 0; t < 1; t += 0.05) {
      const t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push(ctrl[ctrl.length - 1]);
  return resample(dense, spacing);
}

export function resample(pts, spacing) {
  const out = [pts[0]];
  let [px, py] = pts[0];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let [ax, ay] = [px, py];
    const [bx, by] = pts[i];
    let seg = Math.hypot(bx - ax, by - ay);
    while (carry + seg >= spacing) {
      const t = (spacing - carry) / seg;
      ax += (bx - ax) * t; ay += (by - ay) * t;
      out.push([ax, ay]);
      seg = Math.hypot(bx - ax, by - ay);
      carry = 0;
    }
    carry += seg;
    [px, py] = [bx, by];
  }
  const last = pts[pts.length - 1], tail = out[out.length - 1];
  if (Math.hypot(last[0] - tail[0], last[1] - tail[1]) > spacing * 0.3) out.push(last);
  return out;
}

// Stroke stabilizer: evens out finger wobble before the line becomes solid.
// Endpoints stay where the player put them.
export function smoothStroke(pts, passes = 3) {
  let cur = pts;
  for (let p = 0; p < passes; p++) {
    cur = cur.map((pt, i) => {
      if (i < 1 || i > cur.length - 2) return pt;
      const a = cur[Math.max(0, i - 2)], b = cur[i - 1], c = cur[i + 1], d = cur[Math.min(cur.length - 1, i + 2)];
      return [(a[0] + b[0] + pt[0] + c[0] + d[0]) / 5, (a[1] + b[1] + pt[1] + c[1] + d[1]) / 5];
    });
  }
  return cur;
}

export function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
}

// Run one section headlessly, from that section's start. `line` may be null.
// Reaching the section's goal (or checkpoint) counts as a win.
export function simulate(level, line, { trace = false, section = 0 } = {}) {
  const sim = createSim(level, { section });
  if (trace) sim.trace = [];
  if (line && line.length >= 2) sim.addLine(line);
  sim.go();
  while (sim.state === 'running') sim.step();
  if (sim.state === 'parking') sim.state = 'won';
  return {
    won: sim.state === 'won',
    reason: sim.failReason,
    time: sim.time,
    stars: sim.stars.filter((s) => s.got).length,
    trace: sim.trace,
  };
}

// Drive a whole level in one world, one line per section, including the
// checkpoint stops in between.
export function simulateStage(level, lines) {
  const sim = createSim(level);
  for (let k = 0; k < level.sections.length; k++) {
    if (lines[k] && lines[k].length >= 2) sim.addLine(lines[k]);
    sim.go();
    while (sim.state === 'running' || sim.state === 'parking') sim.step();
    if (sim.state !== 'ready') break;
  }
  return {
    won: sim.state === 'won',
    reason: sim.failReason,
    section: sim.section,
    stars: sim.stars.filter((s) => s.got).length,
  };
}
