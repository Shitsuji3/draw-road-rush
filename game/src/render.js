// Canvas renderer. Everything is drawn from code - there are no image files.
import { CAR, LINE_R, WATER_Y } from './sim.js';

export const VIEW = { w: 10, h: 16 };

const C = {
  skyTop: '#6cc8ff', skyBottom: '#d8f3ff',
  hillFar: '#bfe8d0', hillNear: '#9fdcb4',
  dirt: '#c98a55', dirtDark: '#b0733f', dirtEdge: '#8a5530',
  grass: '#4ccb5a', grassLight: '#8be36b',
  ink: '#2b2d42',
  spike: '#dfe3ea', spikeEdge: '#6b7280',
  star: '#ffd23f', starEdge: '#e08e00',
  car: '#ff4d4d', carDark: '#d63a3a', glass: '#bfeaff',
  tire: '#2b2d42', hub: '#d9dde3',
  water: 'rgba(64,164,245,0.86)', waterDeep: 'rgba(24,96,200,0.95)',
  rock: '#8f8580', rockDark: '#7a706b', rockEdge: '#5b524e',
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // x: world x at the left edge of the 10-wide design area (moves between sections)
  const cam = { s: 40, ox: 0, oy: 0, dpr: 1, cw: 1, ch: 1, x: 0 };
  const clouds = Array.from({ length: 6 }, (_, i) => ({ x: (i * 0.23 + 0.05) % 1, y: 0.06 + ((i * 37) % 23) / 100, r: 18 + ((i * 13) % 14), v: 0.004 + (i % 3) * 0.002 }));

  function resize(hudPx) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(cw * dpr));
    canvas.height = Math.max(1, Math.round(ch * dpr));
    const top = hudPx + 6, bottom = 6, side = 6;
    const s = Math.min((cw - side * 2) / VIEW.w, (ch - top - bottom) / VIEW.h);
    const spare = ch - top - bottom - VIEW.h * s;
    Object.assign(cam, { s, dpr, cw, ch, ox: (cw - VIEW.w * s) / 2, oy: top + spare * 0.6 + VIEW.h * s });
  }

  const toWorld = (px, py) => [cam.x + (px - cam.ox) / cam.s, (cam.oy - py) / cam.s];

  function draw(sc) {
    const { dpr, cw, ch } = cam;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, ch);
    g.addColorStop(0, C.skyTop);
    g.addColorStop(1, C.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    drawClouds(sc.time);

    const sx = sc.shake ? (Math.random() - 0.5) * sc.shake * 14 : 0;
    const sy = sc.shake ? (Math.random() - 0.5) * sc.shake * 14 : 0;
    const s = cam.s;
    cam.x = sc.camX || 0;
    ctx.setTransform(s * dpr, 0, 0, -s * dpr, (cam.ox + sx - cam.x * s) * dpr, (cam.oy + sy) * dpr);
    // visible world x range, for things drawn per metre
    const x0 = cam.x - cam.ox / s - 1, x1 = cam.x + (cw - cam.ox) / s + 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    drawHills(x0, x1);
    if (!sc.level) return;
    const { level, sim } = sc;
    for (const poly of level.ground) drawGround(poly, x0, x1);
    for (const row of level.spikes) drawSpikes(row);
    const last = level.sections.length - 1;
    level.sections.forEach((sec, k) => (k === last ? drawFlag(sec.goal, sc.time) : drawCheckpoint(sec.goal, sc.time)));
    if (sc.ghost) strokePath(sc.ghost, 'rgba(43,45,66,0.16)', LINE_R * 2);
    if (sc.hint) drawHint(sc.hint, sc.time);
    for (const l of sc.lines || []) drawInkLine(l);
    if (sc.stroke && sc.stroke.length > 1) drawInkLine(sc.stroke);
    else if (sc.stroke && sc.stroke.length === 1) dot(sc.stroke[0], LINE_R, C.ink);
    if (sim) {
      sim.stars.forEach((st, i) => { if (!st.got) drawStar(st.x, st.y, sc.time + i * 0.7); });
      drawCar(sim, sc.idle ? Math.sin(sc.time * 18) * 0.012 : 0);
    }
    drawParticles(sc.particles);
    drawWater(sc.time, x0, x1);
    if (sc.finger) drawFinger(sc.finger, sc.time);
  }

  function drawClouds(t) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const c of clouds) {
      const x = (((c.x + t * c.v) % 1.2) - 0.1) * cam.cw;
      const y = c.y * cam.ch;
      ctx.beginPath();
      ctx.arc(x, y, c.r, 0, Math.PI * 2);
      ctx.arc(x + c.r * 0.9, y + 4, c.r * 0.75, 0, Math.PI * 2);
      ctx.arc(x - c.r * 0.9, y + 5, c.r * 0.65, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHills(x0, x1) {
    const layer = (color, base, amp, f, ph) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x0, -5);
      for (let x = Math.floor(x0); x <= x1 + 0.5; x += 0.5) ctx.lineTo(x, base + amp * Math.sin(x * f + ph) + amp * 0.5 * Math.sin(x * f * 2.3 + ph * 2));
      ctx.lineTo(x1 + 0.5, -5);
      ctx.fill();
    };
    layer(C.hillFar, 3.2, 1.1, 0.35, 1);
    layer(C.hillNear, 1.9, 0.8, 0.55, 3);
  }

  function polyPath(poly) {
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
  }

  function drawGround(poly, x0, x1) {
    // Blocks hanging from above the screen are ceilings: grey rock, no grass.
    const ceiling = Math.max(...poly.map((p) => p[1])) > 20;
    polyPath(poly);
    ctx.fillStyle = ceiling ? C.rock : C.dirt;
    ctx.fill();
    ctx.save();
    polyPath(poly);
    ctx.clip();
    // speckles, only inside the visible area
    ctx.fillStyle = ceiling ? C.rockDark : C.dirtDark;
    for (let x = Math.floor(x0 / 0.7) * 0.7; x < x1; x += 0.7) {
      for (let y = -1; y < 17; y += 0.7) {
        const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const r = h - Math.floor(h);
        if (r < 0.35) {
          ctx.beginPath();
          ctx.arc(x + r, y + r * 0.6, 0.05 + r * 0.12, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // grass on every upward-facing edge
    const area = signedArea(poly);
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      const ny = (area > 0 ? -dx : dx) / len;
      if (ny > 0.5) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    }
    if (!ceiling) {
      ctx.strokeStyle = C.grass;
      ctx.lineWidth = 0.56;
      ctx.stroke();
      ctx.strokeStyle = C.grassLight;
      ctx.lineWidth = 0.16;
      ctx.stroke();
    }
    ctx.restore();
    polyPath(poly);
    ctx.strokeStyle = ceiling ? C.rockEdge : C.dirtEdge;
    ctx.lineWidth = 0.05;
    ctx.stroke();
  }

  function drawSpikes([x0, x1, y]) {
    const n = Math.max(1, Math.round((x1 - x0) / 0.4));
    const w = (x1 - x0) / n;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      ctx.moveTo(x0 + i * w, y);
      ctx.lineTo(x0 + (i + 0.5) * w, y + 0.44);
      ctx.lineTo(x0 + (i + 1) * w, y);
    }
    ctx.fillStyle = C.spike;
    ctx.fill();
    ctx.strokeStyle = C.spikeEdge;
    ctx.lineWidth = 0.04;
    ctx.stroke();
  }

  function strokePath(pts, color, width) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function drawInkLine(pts) {
    strokePath(pts, C.ink, LINE_R * 2);
    ctx.save();
    ctx.translate(-0.02, 0.04);
    strokePath(pts, 'rgba(255,255,255,0.22)', LINE_R * 0.5);
    ctx.restore();
  }

  function drawHint(pts, t) {
    strokePath(pts, 'rgba(43,45,66,0.18)', LINE_R * 2.2);
    ctx.setLineDash([0.28, 0.22]);
    ctx.lineDashOffset = -t * 1.2;
    strokePath(pts, 'rgba(255,255,255,0.95)', LINE_R * 1.1);
    ctx.setLineDash([]);
  }

  function drawFinger(pts, t) {
    const cycle = 2.6;
    const u = (t % cycle) / cycle;
    const k = Math.min(1, u / 0.75);
    const i = Math.min(pts.length - 1, Math.floor(k * (pts.length - 1)));
    const [x, y] = pts[i];
    const alpha = u < 0.85 ? 1 : 1 - (u - 0.85) / 0.15;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, 0.45 + 0.12 * Math.sin(t * 8), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.06;
    ctx.stroke();
    // simple pointing hand: palm + finger, pointing down-left at the touch point
    ctx.save();
    ctx.translate(x + 0.08, y - 0.08);
    ctx.rotate(-0.5);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 0.05;
    roundRect(-0.13, -0.7, 0.26, 0.62, 0.13);
    ctx.fill(); ctx.stroke();
    roundRect(-0.3, -1.25, 0.62, 0.62, 0.2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function dot([x, y], r, color) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function starPath(r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  function drawStar(x, y, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.arc(0, 0, 0.5 + 0.05 * Math.sin(t * 4), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,225,90,0.28)';
    ctx.fill();
    ctx.rotate(Math.sin(t * 2) * 0.25);
    starPath(0.34);
    ctx.fillStyle = C.star;
    ctx.fill();
    ctx.strokeStyle = C.starEdge;
    ctx.lineWidth = 0.06;
    ctx.stroke();
    ctx.restore();
  }

  function drawCheckpoint([gx, gy], t) {
    ctx.strokeStyle = '#59606e';
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx, gy + 1.7);
    ctx.stroke();
    const w = Math.sin(t * 5) * 0.06;
    ctx.beginPath();
    ctx.moveTo(gx, gy + 1.7);
    ctx.quadraticCurveTo(gx + 0.35, gy + 1.52 + w, gx + 0.75, gy + 1.45 + w);
    ctx.quadraticCurveTo(gx + 0.35, gy + 1.3 - w, gx, gy + 1.2);
    ctx.closePath();
    ctx.fillStyle = C.grass;
    ctx.fill();
    ctx.strokeStyle = '#2f9e44';
    ctx.lineWidth = 0.04;
    ctx.stroke();
  }

  function drawFlag([gx, gy], t) {
    ctx.strokeStyle = '#59606e';
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx, gy + 2.1);
    ctx.stroke();
    const cols = 5, rows = 3, cw = 0.19, rh = 0.19;
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const w0 = Math.sin(t * 6 - c * 0.9) * 0.05 * c;
        const w1 = Math.sin(t * 6 - (c + 1) * 0.9) * 0.05 * (c + 1);
        const y0 = gy + 2.05 - r * rh;
        ctx.beginPath();
        ctx.moveTo(gx + c * cw, y0 + w0);
        ctx.lineTo(gx + (c + 1) * cw, y0 + w1);
        ctx.lineTo(gx + (c + 1) * cw, y0 - rh + w1);
        ctx.lineTo(gx + c * cw, y0 - rh + w0);
        ctx.closePath();
        ctx.fillStyle = (c + r) % 2 ? '#fff' : C.ink;
        ctx.fill();
      }
    }
  }

  function drawCar(sim, bob) {
    for (const w of sim.wheels) {
      const p = w.getPosition();
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(w.getAngle());
      ctx.beginPath();
      ctx.arc(0, 0, CAR.wheelR, 0, Math.PI * 2);
      ctx.fillStyle = C.tire;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, CAR.wheelR * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = C.hub;
      ctx.fill();
      ctx.strokeStyle = C.tire;
      ctx.lineWidth = 0.04;
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * CAR.wheelR * 0.5, Math.sin(a) * CAR.wheelR * 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }
    const p = sim.chassis.getPosition();
    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.rotate(sim.chassis.getAngle());
    // cabin
    ctx.beginPath();
    ctx.moveTo(-0.36, 0.12); ctx.lineTo(0.3, 0.12); ctx.lineTo(0.14, 0.46); ctx.lineTo(-0.28, 0.46); ctx.closePath();
    ctx.fillStyle = C.carDark;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-0.27, 0.16); ctx.lineTo(0.22, 0.16); ctx.lineTo(0.1, 0.4); ctx.lineTo(-0.22, 0.4); ctx.closePath();
    ctx.fillStyle = C.glass;
    ctx.fill();
    // driver
    ctx.beginPath();
    ctx.arc(-0.06, 0.27, 0.09, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd7b0';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-0.03, 0.29, 0.018, 0, Math.PI * 2);
    ctx.fillStyle = C.ink;
    ctx.fill();
    // body
    roundRect(-0.66, -0.18, 1.32, 0.34, 0.12);
    ctx.fillStyle = C.car;
    ctx.fill();
    ctx.fillStyle = C.carDark;
    ctx.fillRect(-0.6, -0.16, 1.2, 0.08);
    ctx.fillStyle = '#fff3a8';
    ctx.fillRect(0.56, 0.0, 0.1, 0.08);
    ctx.fillStyle = '#ff9f1c';
    ctx.fillRect(-0.66, 0.0, 0.07, 0.08);
    ctx.restore();
  }

  function drawParticles(ps) {
    for (const p of ps) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = p.fade ? a : 1;
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else if (p.shape === 'star') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot || 0);
        starPath(p.size);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (p.grow ? 1 + (1 - a) : 1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawWater(t, x0, x1) {
    ctx.beginPath();
    ctx.moveTo(x0, -20);
    for (let x = Math.floor(x0); x <= x1 + 0.25; x += 0.25) ctx.lineTo(x, WATER_Y + 0.07 * Math.sin(x * 1.4 + t * 2.2) + 0.04 * Math.sin(x * 3.1 - t * 3));
    ctx.lineTo(x1 + 0.25, -20);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, WATER_Y, 0, -3);
    g.addColorStop(0, C.water);
    g.addColorStop(1, C.waterDeep);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    for (let x = Math.floor(x0); x <= x1 + 0.25; x += 0.25) ctx.lineTo(x, WATER_Y + 0.07 * Math.sin(x * 1.4 + t * 2.2) + 0.04 * Math.sin(x * 3.1 - t * 3));
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 0.06;
    ctx.stroke();
  }

  return { resize, draw, toWorld, cam };
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
