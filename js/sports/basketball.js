import { G, D2R, clamp, lerp, smooth, decode, sampleAt, framesUntil, decimate } from '../physics.js';
import * as D from '../draw3d.js';

const BALL_R = 0.12;
const RIM_R = 0.2286;
const RIM_Y = 3.05;
const RIM_T = 0.012;
const BOARD_Z = 0.38;
const BASELINE_Z = BOARD_Z + 1.22;
const T0 = 0.6;

const GENES = [
  { key: 'angle', label: 'Release angle', min: 25, max: 75, unit: '°', dp: 0 },
  { key: 'speed', label: 'Release speed', min: 4, max: 13, unit: 'm/s', dp: 2 },
  { key: 'aim', label: 'Left/right aim', min: -12, max: 12, unit: '°', dp: 1 },
  { key: 'height', label: 'Release height (jump)', min: 1.9, max: 2.7, unit: 'm', dp: 2 },
  { key: 'spin', label: 'Backspin (soft touch)', min: 0, max: 1, unit: '', dp: 2, pct: true },
];

const SETTINGS = [
  { key: 'dist', label: 'Shooter distance from hoop', min: 1.5, max: 9, step: 0.1, value: 5.8, unit: 'm' },
  { key: 'side', label: 'Court angle (− left · + right)', min: -75, max: 75, step: 1, value: 25, unit: '°' },
];

function player(s) {
  const a = s.side * D2R;
  const P = { x: s.dist * Math.sin(a), y: 0, z: -s.dist * Math.cos(a) };
  const yaw = Math.atan2(-P.x, -P.z);
  return { P, yaw, fx: Math.sin(yaw), fz: Math.cos(yaw) };
}

function simulate(g, s) {
  const p = decode(GENES, g);
  const { P, yaw: yaw0, fx, fz } = player(s);
  const dist = Math.hypot(P.x, P.z);
  const rel = { x: P.x + fx * 0.3, y: p.height, z: P.z + fz * 0.3 };
  const yaw = yaw0 + p.aim * D2R, el = p.angle * D2R;
  const b = { x: rel.x, y: rel.y, z: rel.z, vx: p.speed * Math.cos(el) * Math.sin(yaw), vy: p.speed * Math.sin(el), vz: p.speed * Math.cos(el) * Math.cos(yaw) };
  const dt = 1 / 240;
  let t = T0, n = 0;
  const frames = [{ t, x: b.x, y: b.y, z: b.z }];
  let made = false, madeT = null, rimHits = 0, board = false, floor = 0, event = null, apex = { ...b, t };
  const e = 0.72 - 0.32 * p.spin;
  const mark = (type) => { if (!event) event = { x: b.x, y: b.y, z: b.z, t, type }; };

  while (t < T0 + 4.5) {
    const py = b.y;
    b.vy -= G * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; t += dt;
    if (b.y > apex.y) apex = { x: b.x, y: b.y, z: b.z, t };

    if (b.vz > 0 && b.z + BALL_R >= BOARD_Z && b.z < BOARD_Z + 0.1 && Math.abs(b.x) < 0.915 + BALL_R * 0.5 && b.y > 2.9 - BALL_R * 0.5 && b.y < 3.95) {
      b.z = BOARD_Z - BALL_R; b.vz = -b.vz * 0.6; b.vx *= 0.85; b.vy *= 0.85; board = true; mark('board');
    }
    const rh = Math.hypot(b.x, b.z) || 1e-6;
    const cx = (b.x / rh) * RIM_R, cz = (b.z / rh) * RIM_R;
    const nx = b.x - cx, ny = b.y - RIM_Y, nz = b.z - cz, nd = Math.hypot(nx, ny, nz);
    if (nd < BALL_R + RIM_T) {
      const ux = nx / nd, uy = ny / nd, uz = nz / nd;
      const vn = b.vx * ux + b.vy * uy + b.vz * uz;
      if (vn < 0) {
        b.vx -= (1 + e) * vn * ux; b.vy -= (1 + e) * vn * uy; b.vz -= (1 + e) * vn * uz;
        b.vx *= 0.9; b.vz *= 0.9; rimHits++; mark('rim');
      }
      const push = BALL_R + RIM_T;
      b.x = cx + ux * push; b.y = RIM_Y + uy * push; b.z = cz + uz * push;
    }
    if (!made && py >= RIM_Y && b.y < RIM_Y && b.vy < 0) {
      mark('plane');
      if (Math.hypot(b.x, b.z) < RIM_R - 0.02) { made = true; madeT = t; }
    }
    if (made && b.y < RIM_Y && b.y > 2.6) { b.vx *= 0.95; b.vz *= 0.95; b.vy *= 0.985; }
    if (b.y < BALL_R && b.vy < 0) {
      b.y = BALL_R; b.vy = -b.vy * 0.72; b.vx *= 0.85; b.vz *= 0.85; floor++; mark('floor');
      if (floor >= 3) break;
    }
    if (made && t > madeT + 1.4) break;
    if (++n % 2 === 0) frames.push({ t, x: b.x, y: b.y, z: b.z });
  }
  frames.push({ t, x: b.x, y: b.y, z: b.z });

  const ev = event || apex;
  const along = ev.x * fx + ev.z * fz;
  const lateral = ev.x * fz - ev.z * fx;
  const err = Math.hypot(along, lateral);
  const swish = made && rimHits === 0 && !board;
  let fitness, outcome;
  if (made) {
    fitness = 100 + (swish ? 25 : 0) - Math.min(rimHits, 5) * 2;
    outcome = swish ? 'SWISH!' : board && !rimHits ? 'BANK SHOT!' : 'IN OFF THE RIM!';
  } else {
    fitness = 80 * Math.exp(-err / 0.6);
    if (!rimHits && !board) outcome = err > 0.9 ? 'Air ball' : along < 0 ? 'Short' : 'Long';
    else if (board && !rimHits) outcome = 'Off the glass';
    else if (Math.abs(lateral) > Math.abs(along)) outcome = `Rimmed out ${lateral < 0 ? 'left' : 'right'}`;
    else outcome = along < 0 ? 'Front rim — out' : 'Back rim — out';
  }
  const duration = frames[frames.length - 1].t;
  const outcomeTime = made ? madeT : Math.min((event ? event.t : apex.t) + 0.3, duration);
  const detail = `${p.speed.toFixed(1)} m/s at ${p.angle.toFixed(0)}° · ${made ? (swish ? 'nothing but net' : `${rimHits} rim touch${rimHits === 1 ? '' : 'es'}`) : `off target by ${(err * 100).toFixed(0)} cm`}`;
  return {
    frames, fitness, success: made, outcome, detail, outcomeTime, duration, contactT: T0, params: p,
    info: { along, lateral, err, dist, rimHits, board, swish, P, fx, fz },
    trail: decimate(frames, 2),
  };
}

// SPORT-SPECIFIC STRATEGY: read the miss and correct power, aim and arc.
function guide(g, r) {
  const d = new Array(GENES.length).fill(0);
  if (!r) return d;
  const { along, lateral, dist } = r.info;
  const p = r.params;
  const k = r.success ? 0.35 : 1;
  // Short/long -> power. Range grows ~ 2R/v per m/s, so dv = -along * v / (2R).
  d[1] = ((-along * p.speed) / (2 * Math.max(dist, 1.5)) / 9) * k * 0.9;
  // Left/right -> aim correction.
  d[2] = ((-Math.atan2(lateral, dist) / D2R) / 24) * k * 0.9;
  // High arc (~52°) gives the ball the biggest window into the hoop.
  d[0] = ((52 - p.angle) / 50) * 0.3;
  // Jump higher and add backspin for a softer touch on the rim.
  d[3] = 0.15 * (1 - g[3]);
  d[4] = 0.15 * (1 - g[4]);
  return d;
}

function camera(s) {
  const { P } = player(s);
  const l = Math.hypot(P.x, P.z) || 1;
  const bx = P.x / l, bz = P.z / l;
  return { pos: { x: P.x + bx * 5.2, y: 3.3, z: P.z + bz * 5.2 }, target: { x: 0, y: 1.9, z: 0 }, fov: 52 };
}

// ---------- drawing ----------
const FLOOR = D.rect(-9.5, 9.5, -40, 8);
const NET_TOP = D.ring(0, RIM_Y, 0, RIM_R, 16);
const NET_BOT = D.ring(0, RIM_Y - 0.42, 0, RIM_R * 0.62, 16);
// Arena seating: a back stand behind the basket and two side stands.
const ARENA = [];
for (let k = 0; k < 7; k++) {
  const color = k % 2 ? '#141a29' : '#182033';
  for (let i = 0; i < 20; i++) {
    const x0 = -30 + i * 3, ya = 1 + k * 1.6, za = 8.4 + k * 1.1;
    const pts = [{ x: x0, y: ya, z: za }, { x: x0 + 3, y: ya, z: za }, { x: x0 + 3, y: ya + 1.6, z: za + 1.1 }, { x: x0, y: ya + 1.6, z: za + 1.1 }];
    ARENA.push({ pts, color, at: { x: x0 + 1.5, y: ya, z: za }, crowd: D.makeCrowd(pts, 16, 900 + i * 7 + k) });
  }
  for (const sg of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const z0 = -28 + i * 3, xa = sg * (10 + k * 1.1), ya = 1 + k * 1.6;
      const pts = [{ x: xa, y: ya, z: z0 }, { x: xa, y: ya, z: z0 + 3 }, { x: xa + sg * 1.1, y: ya + 1.6, z: z0 + 3 }, { x: xa + sg * 1.1, y: ya + 1.6, z: z0 }];
      ARENA.push({ pts, color, at: { x: xa, y: ya, z: z0 + 1.5 }, crowd: D.makeCrowd(pts, 16, 500 + i * 13 + k * 3 + (sg > 0 ? 200 : 0)) });
    }
  }
}
const JERSEY = { skin: '#8d5524', shirt: '#d6453d', pants: '#d6453d', legs: '#8d5524', shoes: '#f5f5f5' };

function courtLines(ctx, cam) {
  const W = 'rgba(255,255,255,.85)';
  const L = (pts, closed) => D.polyline(ctx, cam, pts, W, 1.6, closed);
  D.poly(ctx, cam, D.rect(-2.45, 2.45, BASELINE_Z - 5.8, BASELINE_Z, 0.002), '#a8452f');
  L(D.rect(-2.45, 2.45, BASELINE_Z - 5.8, BASELINE_Z, 0.004), true);
  L(D.ring(0, 0.004, BASELINE_Z - 5.8, 1.8, 40), true);
  L([{ x: -7.5, y: 0.004, z: BASELINE_Z }, { x: 7.5, y: 0.004, z: BASELINE_Z }]);
  L([{ x: -7.5, y: 0.004, z: BASELINE_Z }, { x: -7.5, y: 0.004, z: -14 }]);
  L([{ x: 7.5, y: 0.004, z: BASELINE_Z }, { x: 7.5, y: 0.004, z: -14 }]);
  const a = Math.asin(6.6 / 6.75);
  L(D.ring(0, 0.004, 0, 6.75, 48, Math.PI - a, Math.PI + a));
  const zc = -6.75 * Math.cos(a);
  L([{ x: 6.6, y: 0.004, z: zc }, { x: 6.6, y: 0.004, z: BASELINE_Z }]);
  L([{ x: -6.6, y: 0.004, z: zc }, { x: -6.6, y: 0.004, z: BASELINE_Z }]);
  L([{ x: -7.5, y: 0.004, z: -12.4 }, { x: 7.5, y: 0.004, z: -12.4 }]);
  L(D.ring(0, 0.004, -12.4, 1.8, 40), true);
}

function shooterPose(r, s, t) {
  const { P, yaw } = player(s);
  const p = r.params;
  const jumpH = clamp(p.height - 2.15, 0, 0.5);
  const tj = (t - (T0 - 0.3)) / 0.7;
  const lift = tj > 0 && tj < 1 ? Math.sin(tj * Math.PI) * jumpH : 0;
  const dip = t < T0 - 0.3 ? Math.sin(clamp(t / (T0 - 0.3), 0, 1) * Math.PI) * 0.12 : 0;
  const L = D.frame(P, yaw, lift - dip);
  const relPt = { x: P.x + Math.sin(yaw) * 0.3, y: p.height, z: P.z + Math.cos(yaw) * 0.3 };
  const chest = L(0.05, 1.25, 0.32);
  let ballHeld = null, hands;
  if (t < T0) {
    ballHeld = D.lerpV(chest, relPt, smooth((t - (T0 - 0.45)) / 0.45));
    hands = D.add(ballHeld, { x: 0, y: -0.1, z: 0 });
  } else {
    const drop = smooth((t - T0 - 0.7) / 0.6);
    hands = D.lerpV(D.add(relPt, { x: 0, y: 0.05, z: 0 }), L(0.15, 1.0, 0.2), drop);
  }
  const J = {
    footL: L(-0.17, 0, 0.05), footR: L(0.17, 0, -0.02), kneeL: L(-0.14, 0.5 - dip, 0.12), kneeR: L(0.14, 0.5 - dip, 0.08),
    hip: L(0, 0.95 - dip, 0), neck: L(0, 1.5 - dip, 0.03), head: L(0, 1.69 - dip, 0.05),
    shL: L(-0.21, 1.45 - dip, 0.03), shR: L(0.21, 1.45 - dip, 0.03),
    handL: D.add(hands, D.mul({ x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) }, -0.12)), handR: hands,
  };
  return { J, ballHeld, at: L(0, 1, 0) };
}

function render(ctx, cam, st) {
  const { w, h, result: r, t, ghosts, settings: s } = st;
  D.sky(ctx, w, h, '#05070d', '#111829');
  D.poly(ctx, cam, D.rect(-40, 40, -40, 30), '#0c111c');
  ARENA.map((q) => ({ q, d: cam.depth(q.at) })).sort((a, b) => b.d - a.d).forEach(({ q }) => {
    D.poly(ctx, cam, q.pts, q.color);
    if (q.crowd) D.drawCrowd(ctx, cam, q.crowd, 0.3);
  });
  D.poly(ctx, cam, [{ x: -30, y: 0, z: 8 }, { x: 30, y: 0, z: 8 }, { x: 30, y: 0.9, z: 8 }, { x: -30, y: 0.9, z: 8 }], '#0b3b3a');
  D.polyline(ctx, cam, [{ x: -30, y: 0.88, z: 7.99 }, { x: 30, y: 0.88, z: 7.99 }], 'rgba(79,209,197,.8)', 1.5);
  D.poly(ctx, cam, FLOOR, '#c98e53');
  for (let i = -9; i < 9; i++) if (i % 2) D.poly(ctx, cam, D.rect(i, i + 1, -40, 8, 0.001), '#c68b50');
  courtLines(ctx, cam);
  const spot = cam.project({ x: 0, y: 0, z: -2 });
  if (spot) {
    const g = ctx.createRadialGradient(spot.x, spot.y, 0, spot.x, spot.y, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(255,240,210,.10)'); g.addColorStop(0.45, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.5)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }

  for (const gr of ghosts) if (gr !== r) D.polyline(ctx, cam, gr.trail, gr.success ? 'rgba(245,197,66,.3)' : 'rgba(255,255,255,.1)', 1);

  const items = [];
  const zb = BOARD_Z + 1.2;
  items.push({
    at: { x: 0, y: 2.5, z: BOARD_Z + 0.6 }, draw: () => {
      D.poly(ctx, cam, D.rect(-0.6, 0.6, zb - 0.6, zb + 0.9, 0.003), '#1f2937');
      D.limb(ctx, cam, { x: 0, y: 0, z: zb }, { x: 0, y: 3.5, z: zb }, 0.16, '#374151');
      D.limb(ctx, cam, { x: 0, y: 3.5, z: zb }, { x: 0, y: 3.5, z: BOARD_Z + 0.02 }, 0.1, '#374151');
      const B = (x, y) => ({ x, y, z: BOARD_Z });
      D.poly(ctx, cam, [B(-0.915, 2.9), B(0.915, 2.9), B(0.915, 3.95), B(-0.915, 3.95)], 'rgba(240,248,255,.82)', '#1f2937', 2);
      D.poly(ctx, cam, [B(-0.295, 3.05), B(0.295, 3.05), B(0.295, 3.5), B(-0.295, 3.5)], null, '#e4572e', 2);
      D.limb(ctx, cam, { x: 0, y: RIM_Y, z: BOARD_Z }, { x: 0, y: RIM_Y, z: RIM_R }, 0.03, '#e4572e');
    },
  });
  // back half of rim + net, then (sorted) ball, then front half
  const backIdx = [], frontIdx = [];
  const cz0 = cam.depth({ x: 0, y: RIM_Y, z: 0 });
  NET_TOP.forEach((pt, i) => (cam.depth(pt) > cz0 ? backIdx : frontIdx).push(i));
  const rimPart = (idx, alpha) => () => {
    for (const i of idx) {
      const j = (i + 1) % NET_TOP.length;
      D.line(ctx, cam, NET_TOP[i], NET_BOT[i], `rgba(255,255,255,${alpha})`, 1);
      D.line(ctx, cam, NET_TOP[i], NET_BOT[j], `rgba(255,255,255,${alpha * 0.8})`, 1);
      D.limb(ctx, cam, NET_TOP[i], NET_TOP[j], 0.035, '#e4572e');
    }
  };
  items.push({ at: { x: 0, y: RIM_Y, z: 0.5 * RIM_R }, draw: rimPart(backIdx, 0.55) });
  items.push({ at: { x: 0, y: RIM_Y, z: -0.6 * RIM_R }, draw: rimPart(frontIdx, 0.8) });

  if (r) {
    const pose = shooterPose(r, s, t);
    items.push({ at: pose.at, draw: () => D.figure(ctx, cam, pose.J, JERSEY) });
    const ball = pose.ballHeld || sampleAt(r.frames, t);
    if (ball) {
      items.push({
        at: { ...ball, z: ball.z }, draw: () => {
          if (!pose.ballHeld) D.polyline(ctx, cam, framesUntil(r.frames, t), r.success ? 'rgba(255,214,10,.85)' : 'rgba(255,255,255,.5)', 2);
          D.sphere(ctx, cam, ball, BALL_R, '#e67e22', '#ffc38a', { seam: 'rgba(40,20,0,.6)' });
        },
      });
    }
  }
  D.drawSorted(cam, items);
}

function drawMini(ctx, w, h, ghosts, cur, s) {
  const { P, fx, fz } = player(s);
  const dist = Math.hypot(P.x, P.z);
  const sc = Math.min((w - 20) / (dist + 2.2), (h - 16) / 5.2);
  const X = (a) => 12 + a * sc, Y = (y) => h - 8 - y * sc;
  ctx.fillStyle = '#c98e53'; ctx.fillRect(0, Y(0), w, 8);
  ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(X(dist + BOARD_Z), Y(2.9)); ctx.lineTo(X(dist + BOARD_Z), Y(3.95)); ctx.stroke();
  ctx.strokeStyle = '#e4572e'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(X(dist - RIM_R), Y(RIM_Y)); ctx.lineTo(X(dist + RIM_R), Y(RIM_Y)); ctx.stroke();
  ctx.strokeStyle = '#d6453d'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(0), Y(1.8)); ctx.stroke();
  const along = (pt) => (pt.x - P.x) * fx + (pt.z - P.z) * fz;
  for (const g of ghosts) {
    ctx.strokeStyle = g === cur ? (g.success ? '#f5c542' : '#fff') : g.success ? 'rgba(245,197,66,.45)' : 'rgba(255,255,255,.18)';
    ctx.lineWidth = g === cur ? 2 : 1;
    ctx.beginPath();
    g.trail.forEach((pt, i) => { const x = X(along(pt)), y = Y(pt.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.fillText('side view: shooter → hoop', 6, 14);
}

export default {
  id: 'basketball', name: 'Basketball', icon: '🏀', goal: 'Sink the shot', view: 'Behind the shooter',
  successWord: 'Basket', genes: GENES, settings: SETTINGS, simulate, guide, camera, render, drawMini,
  miniTitle: 'Shot arcs (side view)',
  preview: (s) => `Shooting from ${s.dist.toFixed(1)} m at ${s.side}° — ${s.dist >= 6.75 ? 'three-pointer' : 'two-pointer'}`,
  strategy: [
    '<b>Read the miss:</b> if a shot was short or long, change release speed by the amount physics predicts (range changes by about 2R/v per m/s).',
    '<b>Line it up:</b> if it missed left or right, turn the aim by the angle of the miss.',
    '<b>Use arc and touch:</b> move toward a ~52° release, jump higher and add backspin so the ball gets a bigger window and a softer bounce off the rim.',
  ],
};
