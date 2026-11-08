import { G, D2R, clamp, lerp, smooth, decode, stepDrag, sampleAt, framesUntil, decimate } from '../physics.js';
import * as D from '../draw3d.js';

const R = 0.036;        // ball radius
const CZ = 10;          // ground centre (middle of the pitch)
const BR = 62;          // boundary radius
const STUMP_H = 0.711;
const T0 = 0.8;         // bowler run-up before release
const DT = 1 / 120;
const DRAG = 0.007;
const BODY_X = -0.5;    // right-hander, seen from the keeper

const GENES = [
  { key: 'reach', label: 'Meets ball at', min: 0.2, max: 2.6, unit: 'm', dp: 2 },
  { key: 'batX', label: 'Bat line', min: -0.8, max: 0.8, unit: 'm', dp: 2 },
  { key: 'batY', label: 'Bat height', min: 0.0, max: 1.4, unit: 'm', dp: 2 },
  { key: 'loft', label: 'Bat-face loft', min: -10, max: 60, unit: '°', dp: 0 },
  { key: 'aim', label: 'Shot direction', min: -80, max: 80, unit: '°', dp: 0 },
  { key: 'power', label: 'Swing power', min: 0, max: 1, unit: '', dp: 2, pct: true },
];

const SETTINGS = [
  { key: 'length', label: 'Ball pitches at', min: 1, max: 10, step: 0.1, value: 5.5, unit: 'm from batter' },
  { key: 'line', label: 'Line (− leg · + off)', min: -0.6, max: 0.6, step: 0.05, value: 0.1, unit: 'm' },
  { key: 'speed', label: 'Bowling speed', min: 100, max: 155, step: 1, value: 135, unit: 'km/h' },
];

const cache = new Map();
function delivery(s) {
  const key = `${s.length}|${s.line}|${s.speed}`;
  if (cache.has(key)) return cache.get(key);
  const rel = { x: 0.3, y: 2.15, z: 19.3 };
  const v = s.speed / 3.6;
  const dx = s.line - rel.x, dz = s.length - rel.z, tt = Math.hypot(dx, dz) / v;
  const b = { x: rel.x, y: rel.y, z: rel.z, vx: dx / tt, vz: dz / tt, vy: (R - rel.y + 0.5 * G * tt * tt) / tt };
  let t = T0;
  const pts = [{ t, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz }];
  while (b.z > -1.6 && t < T0 + 3) {
    b.vy -= G * DT; b.x += b.vx * DT; b.y += b.vy * DT; b.z += b.vz * DT;
    if (b.y < R && b.vy < 0) { b.y = R; b.vy = -b.vy * 0.5; b.vx *= 0.95; b.vz *= 0.88; }
    t += DT;
    pts.push({ t, x: b.x, y: b.y, z: b.z, vx: b.vx, vy: b.vy, vz: b.vz });
  }
  if (cache.size > 60) cache.clear();
  cache.set(key, pts);
  return pts;
}

function boundaryDist(az) {
  const c = CZ * Math.cos(az);
  return c + Math.sqrt(c * c - CZ * CZ + BR * BR);
}

function simulate(g, s) {
  const p = decode(GENES, g);
  const del = delivery(s);
  const frames = [];
  let i = 0, contact = null;
  for (; i < del.length; i++) {
    const a = del[i], b = del[i + 1];
    frames.push(a);
    if (b && a.z > p.reach && b.z <= p.reach) {
      const u = (a.z - p.reach) / (a.z - b.z);
      contact = { t: a.t + DT * u, x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: p.reach, speed: Math.hypot(a.vx, a.vy, a.vz) };
      break;
    }
  }
  const d = Math.hypot(contact.x - p.batX, contact.y - p.batY);
  const info = { contact, d, hit: false };
  let outcome, detail, success = false, fitness, outcomeTime = null, landing = null;

  if (d < 0.2) {
    info.hit = true;
    const q = Math.exp(-((d / 0.09) ** 2));
    const batSpeed = 16 + 18 * p.power;
    const ev = (batSpeed * 1.15 + 0.12 * contact.speed) * (0.25 + 0.75 * q);
    const elev = clamp(p.loft + (p.batY - contact.y) * 120, -25, 80);
    const azDeg = p.aim + (contact.x - p.batX) * 150;
    const el = elev * D2R, az = azDeg * D2R;
    const b = { x: contact.x, y: Math.max(contact.y, R), z: contact.z, vx: ev * Math.cos(el) * Math.sin(az), vy: ev * Math.sin(el), vz: ev * Math.cos(el) * Math.cos(az) };
    let t = contact.t, six = false, four = false, carry = null, roll = false, landT = null;
    frames.push({ t, x: b.x, y: b.y, z: b.z });
    while (t < contact.t + 10) {
      if (!roll) {
        stepDrag(b, DRAG, DT); t += DT;
        if (carry === null && !six && Math.hypot(b.x, b.z - CZ) >= BR) { six = true; outcomeTime = t; }
        if (b.y <= R) {
          b.y = R;
          if (carry === null) { carry = Math.hypot(b.x, b.z); landing = { x: b.x, z: b.z }; landT = t; }
          if (six) { frames.push({ t, x: b.x, y: b.y, z: b.z }); break; }
          if (Math.abs(b.vy) > 2) { b.vy = -b.vy * 0.35; b.vx *= 0.6; b.vz *= 0.6; } else { roll = true; b.vy = 0; }
        }
      } else {
        const hs = Math.hypot(b.vx, b.vz);
        if (hs < 0.4) break;
        const k = Math.max(0, hs - 5 * DT) / hs;
        b.vx *= k; b.vz *= k; b.x += b.vx * DT; b.z += b.vz * DT; t += DT;
      }
      frames.push({ t, x: b.x, y: b.y, z: b.z });
      const rc = Math.hypot(b.x, b.z - CZ);
      if (!six && carry !== null && !four && rc >= BR) { four = true; outcomeTime = t; }
      if (four && rc >= BR + 2) break;
    }
    if (carry === null) { carry = Math.hypot(b.x, b.z); landing = { x: b.x, z: b.z }; landT = t; }
    const bd = boundaryDist(az);
    fitness = 15 + 100 * Math.min(carry / bd, 1.3) + (six ? 40 : 0) + (four ? 8 : 0);
    success = six;
    const total = Math.hypot(b.x, b.z);
    outcome = six ? 'SIX!' : four ? 'FOUR' : total < 12 ? 'Dot ball' : total < 30 ? '1 run' : total < 50 ? '2 runs' : '3 runs';
    if (!outcomeTime) outcomeTime = landT ?? t;
    detail = `${carry.toFixed(0)} m carry · ${(ev * 3.6).toFixed(0)} km/h off the bat · ${elev.toFixed(0)}° launch`;
    Object.assign(info, { ev, elev, az: azDeg, q, carry, six, four });
    landing.outcome = six ? 'six' : four ? 'four' : 'field';
  } else {
    let bowled = false;
    for (let j = i + 1; j < del.length; j++) {
      const a = del[j], pr = del[j - 1];
      frames.push(a);
      if (pr.z > 0 && a.z <= 0) {
        const u = pr.z / (pr.z - a.z);
        const x = lerp(pr.x, a.x, u), y = lerp(pr.y, a.y, u);
        if (Math.abs(x) < 0.13 && y < STUMP_H + 0.02) { bowled = true; outcomeTime = a.t; break; }
      }
    }
    outcome = bowled ? 'BOWLED' : 'Beaten — swing and a miss';
    detail = `Missed the ball by ${(d * 100).toFixed(0)} cm`;
    fitness = 12 * (1 - Math.min(d, 1.2) / 1.2) - (bowled ? 2 : 0);
    if (!outcomeTime) outcomeTime = contact.t + 0.25;
    info.bowled = bowled;
  }
  const duration = frames[frames.length - 1].t;
  return {
    frames, fitness, success, outcome, detail, outcomeTime, duration, contactT: contact.t, info, landing, params: p,
    trail: decimate(frames, 3, info.hit ? contact.t : T0),
  };
}

// SPORT-SPECIFIC STRATEGY: coach's feedback from the parent's last attempt.
function guide(g, r, s) {
  const d = new Array(GENES.length).fill(0);
  if (!r) return d;
  const p = r.params, c = r.info.contact;
  // 1) Watch the ball: move the bat to where the ball actually was at the hitting point.
  d[1] = ((c.x - p.batX) / 1.6) * 0.9;
  d[2] = ((c.y - p.batY) / 1.4) * 0.9;
  // 2) Get to the pitch: meet the ball where it sits around waist height.
  let bestZ = p.reach, bestErr = Infinity;
  for (const pt of delivery(s)) {
    if (pt.z < 0.2 || pt.z > 2.6) continue;
    const e = Math.abs(pt.y - 0.75);
    if (e < bestErr) { bestErr = e; bestZ = pt.z; }
  }
  d[0] = ((bestZ - p.reach) / 2.4) * 0.5;
  if (r.info.hit) {
    // 3) Get under it: aim for a ~38° launch, swing harder, and target cow corner.
    d[3] = ((38 - r.info.elev) / 70) * 0.6;
    if (!r.success) d[5] = 0.3 * (1 - g[5]);
    d[4] = ((-25 - p.aim) / 160) * 0.25;
  }
  return d;
}

function camera() {
  return { pos: { x: 0.6, y: 1.8, z: -7.5 }, target: { x: -0.1, y: 1.1, z: 16 }, fov: 46 };
}

// ---------- drawing ----------
const GROUND = D.rect(-500, 500, -60, 600);
const STANDS = [];
for (let i = 0; i < 120; i++) {
  const a0 = (i / 120) * Math.PI * 2, a1 = ((i + 1) / 120) * Math.PI * 2;
  const P = (r, y, a) => ({ x: r * Math.sin(a), y, z: CZ + r * Math.cos(a) });
  const R1 = BR + 12, R2 = BR + 42;
  const tiers = [0, 1, 2, 3].map((k) => {
    const ra = R1 + ((R2 - R1) * k) / 4, rb = R1 + ((R2 - R1) * (k + 1)) / 4, ya = 5 + (19 * k) / 4, yb = 5 + (19 * (k + 1)) / 4;
    const pts = [P(ra, ya, a0), P(ra, ya, a1), P(rb, yb, a1), P(rb, yb, a0)];
    return { pts, color: k % 2 ? '#1b2333' : '#202a3d', crowd: D.makeCrowd(pts, 18, i * 4 + k) };
  });
  STANDS.push({
    at: P(R1, 4, (a0 + a1) / 2),
    wall: [P(R1, 0, a0), P(R1, 0, a1), P(R1, 5, a1), P(R1, 5, a0)],
    tiers,
    roof: [P(R2, 24, a0), P(R2, 24, a1), P(R2 + 4, 31, a1), P(R2 + 4, 31, a0)],
    board: [P(BR + 2.5, 0, a0), P(BR + 2.5, 0, a1), P(BR + 2.5, 0.9, a1), P(BR + 2.5, 0.9, a0)],
    boardColor: i % 8 < 4 ? '#0f2a5f' : '#14315f',
  });
}
const LIGHTS = [45, 135, 225, 315].map((deg) => {
  const a = deg * D2R, r = BR + 48;
  return { base: { x: r * Math.sin(a), y: 0, z: CZ + r * Math.cos(a) }, facing: a + Math.PI / 2 };
});
const FIELDERS = [[-26, 42], [30, 46], [-46, 16], [42, 14], [-14, 64], [16, 24], [-8, 30], [52, 40], [-40, 50]];

function stumps(ctx, cam, z, broken) {
  for (const x of [-0.11, 0, 0.11]) {
    const lean = broken ? (x + 0.05) * 3 : 0;
    D.limb(ctx, cam, { x, y: 0, z }, { x: x + lean * 0.4, y: STUMP_H - Math.abs(lean) * 0.2, z: z - lean * 0.3 }, 0.035, '#f1e3c0');
  }
  if (!broken) D.limb(ctx, cam, { x: -0.12, y: STUMP_H + 0.01, z }, { x: 0.12, y: STUMP_H + 0.01, z }, 0.02, '#c58b3a');
}

function crease(ctx, cam, a, b) { D.line(ctx, cam, { ...a, y: 0.004 }, { ...b, y: 0.004 }, 'rgba(255,255,255,.9)', 1.5); }

const fielderPose = (x, z) => {
  const yaw = Math.atan2(-x, -z);
  const L = D.frame({ x, z }, yaw);
  return { footL: L(-0.18, 0, 0), footR: L(0.18, 0, 0), hip: L(0, 0.9, 0), neck: L(0, 1.45, 0.05), head: L(0, 1.63, 0.06), shL: L(-0.2, 1.4, 0.05), shR: L(0.2, 1.4, 0.05), handL: L(-0.3, 0.95, 0.25), handR: L(0.3, 0.95, 0.25) };
};
const WHITES = { skin: '#c68642', shirt: '#f4f4ef', pants: '#e9e7dd', shoes: '#ddd' };

function batterPose(r, t) {
  const p = r.params;
  const tc = r.contactT;
  const step = smooth((t - (tc - 0.4)) / 0.3);
  const bz = lerp(1.0, clamp(p.reach - 0.5, 0.2, 1.9), step);
  const J = {
    footL: { x: BODY_X - 0.02, y: 0, z: bz + 0.38 }, footR: { x: BODY_X + 0.02, y: 0, z: bz - 0.25 },
    hip: { x: BODY_X, y: 0.92, z: bz + 0.05 }, neck: { x: BODY_X + 0.06, y: 1.45, z: bz + 0.12 },
    head: { x: BODY_X + 0.1, y: 1.63, z: bz + 0.16 },
    shL: { x: BODY_X + 0.06, y: 1.4, z: bz + 0.3 }, shR: { x: BODY_X + 0.06, y: 1.4, z: bz - 0.06 },
  };
  const C = { x: p.batX, y: p.batY, z: p.reach };
  const Hc = { x: lerp(BODY_X, p.batX, 0.6) + 0.1, y: clamp(p.batY + 0.75, 0.6, 1.5), z: p.reach - 0.15 };
  const H0 = { x: BODY_X + 0.2, y: 1.2, z: bz - 0.15 };
  const H1 = { x: BODY_X + 0.15, y: 1.55, z: bz + 0.35 };
  const sPhase = clamp((t - tc) / 0.36 + 0.55, 0, 1);
  const sw = D.swing(H0, Hc, H1, C, sPhase, -2.3, 2.0, { x: 0, y: 0, z: 1 }, Math.max(0.6, D.len(D.sub(C, Hc))));
  J.handL = sw.hands; J.handR = D.add(sw.hands, { x: 0, y: 0.08, z: 0 });
  return { J, sw, at: { x: BODY_X, y: 1, z: bz } };
}

function render(ctx, cam, st) {
  const { w, h, result: r, t, ghosts, settings: s } = st;
  D.sky(ctx, w, h, '#3b82d6', '#cfe4fb');
  LIGHTS.forEach((l) => D.floodlight(ctx, cam, l.base, 52, l.facing));
  D.poly(ctx, cam, GROUND, '#24522a');
  STANDS.map((p) => ({ p, d: cam.depth(p.at) })).sort((a, b) => b.d - a.d).forEach(({ p }) => {
    D.poly(ctx, cam, p.roof, '#0d1220');
    p.tiers.forEach((q) => { D.poly(ctx, cam, q.pts, q.color); D.drawCrowd(ctx, cam, q.crowd, 0.6); });
    D.poly(ctx, cam, p.wall, '#111827');
  });
  D.haze(ctx, cam, w, '220,235,255', 0.18);
  const rope = D.ring(0, 0, CZ, BR, 120);
  if (D.path(ctx, cam, rope)) {
    ctx.fillStyle = '#3f8f36'; ctx.fill();
    ctx.save(); ctx.clip();
    for (let i = 0; i < 26; i++) if (i % 2) D.poly(ctx, cam, D.rect(-80, 80, -60 + i * 6, -54 + i * 6), '#4a9d3f');
    ctx.restore();
  }
  STANDS.forEach((p) => D.poly(ctx, cam, p.board, p.boardColor));
  D.polyline(ctx, cam, D.ring(0, 0.03, CZ, BR, 120), 'rgba(255,255,255,.95)', 2, true);
  ctx.setLineDash([6, 6]);
  D.polyline(ctx, cam, D.ring(0, 0.01, CZ, 27, 80), 'rgba(255,255,255,.5)', 1.2, true);
  ctx.setLineDash([]);

  // pitch
  D.poly(ctx, cam, D.rect(-1.52, 1.52, -1.6, 21.7, 0.002), '#cbb47c');
  D.poly(ctx, cam, D.rect(-0.85, 0.85, -0.4, 20.5, 0.003), '#d8c592');
  for (const [end, dir] of [[0, 1], [20.12, -1]]) {
    crease(ctx, cam, { x: -1.32, z: end }, { x: 1.32, z: end });
    crease(ctx, cam, { x: -2.2, z: end + 1.22 * dir }, { x: 2.2, z: end + 1.22 * dir });
    for (const x of [-1.32, 1.32]) crease(ctx, cam, { x, z: end - 1.0 * dir }, { x, z: end + 1.22 * dir });
  }
  // the user-chosen pitching spot
  ctx.setLineDash([3, 3]);
  D.polyline(ctx, cam, D.ring(s.line, 0.006, s.length, 0.22, 24), 'rgba(255,214,10,.95)', 1.5, true);
  ctx.setLineDash([]);
  stumps(ctx, cam, 20.12, false);

  // fielders
  FIELDERS.map(([x, z]) => ({ x, z, d: cam.depth({ x, y: 1, z }) })).sort((a, b) => b.d - a.d)
    .forEach(({ x, z }) => D.figure(ctx, cam, fielderPose(x, z), WHITES));

  // past attempts (ghost trails)
  for (const gr of ghosts) {
    if (gr === r) continue;
    D.polyline(ctx, cam, gr.trail, gr.success ? 'rgba(245,197,66,.3)' : 'rgba(255,255,255,.09)', 1);
  }
  if (!r) return;

  const ball = sampleAt(r.frames, t);
  const items = [];

  // bowler
  const run = clamp(t / T0, 0, 1);
  const bzB = t < T0 ? lerp(27, 19.9, run) : lerp(19.9, 17.6, smooth((t - T0) / 0.7));
  const BL = D.frame({ x: 0.1, z: bzB }, Math.PI);
  const stride = Math.sin(t * 14) * (t < T0 ? 0.35 : 0.1);
  const armA = t < T0 ? lerp(-2.8, 0.15, smooth((t - (T0 - 0.35)) / 0.35)) : lerp(0.15, 2.6, smooth((t - T0) / 0.35));
  const shR = BL(-0.2, 1.42, 0);
  const handR = D.add(shR, D.add({ x: 0, y: Math.cos(armA) * 0.66, z: 0 }, D.mul({ x: 0, y: 0, z: -1 }, Math.sin(armA) * 0.66)));
  const bowlerJ = { footL: BL(0.15, 0, stride), footR: BL(-0.15, 0, -stride), hip: BL(0, 0.92, 0), neck: BL(0, 1.47, 0.04), head: BL(0, 1.64, 0.05), shL: BL(0.2, 1.42, 0), shR, handL: BL(0.35, 1.1, 0.25), handR };
  items.push({ at: bowlerJ.hip, draw: () => D.figure(ctx, cam, bowlerJ, WHITES) });

  // batter
  const bat = batterPose(r, t);
  items.push({
    at: bat.at, draw: () => {
      D.figure(ctx, cam, bat.J, { ...WHITES, legs: '#ffffff', hat: '#1e3a8a' });
      const handle = D.lerpV(bat.sw.hands, bat.sw.tip, 0.28);
      D.limb(ctx, cam, bat.sw.hands, handle, 0.045, '#333');
      D.limb(ctx, cam, handle, bat.sw.tip, 0.11, '#e8d3a0');
    },
  });
  const broken = r.info.bowled && t >= r.outcomeTime;
  items.push({ at: { x: 0, y: 0.4, z: 0 }, draw: () => stumps(ctx, cam, 0, broken) });

  if (ball) {
    const live = framesUntil(r.frames, t, r.info.hit ? r.contactT : T0);
    items.push({
      at: ball, draw: () => {
        D.polyline(ctx, cam, live, r.success ? 'rgba(255,214,10,.9)' : 'rgba(255,255,255,.6)', 2);
        D.sphere(ctx, cam, ball, R * 1.6, '#b3121b', '#ff8a8a', { seam: 'rgba(255,255,255,.7)' });
      },
    });
  } else {
    items.push({ at: handR, draw: () => D.sphere(ctx, cam, handR, R * 1.6, '#b3121b', '#ff8a8a', { shadow: false }) });
  }
  D.drawSorted(cam, items);
}

function drawMini(ctx, w, h, ghosts, cur, s) {
  const sc = Math.min(w, h) / 2 / (BR + 6);
  const cx = w / 2, cy = h / 2;
  const P = (x, z) => [cx + x * sc, cy - (z - CZ) * sc];
  ctx.fillStyle = '#2f7a33'; ctx.beginPath(); ctx.arc(cx, cy, BR * sc, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.arc(cx, cy, 27 * sc, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  const [px, py] = P(-1.5, 20.1); ctx.fillStyle = '#cbb47c'; ctx.fillRect(px, py, 3 * sc, 20.1 * sc);
  const [bx, by] = P(0, 0);
  for (const g of ghosts) {
    if (!g.landing) continue;
    const [x, y] = P(g.landing.x, g.landing.z);
    ctx.fillStyle = g.landing.outcome === 'six' ? '#f5c542' : g.landing.outcome === 'four' ? '#60a5fa' : 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.arc(x, y, g === cur ? 4 : 2.4, 0, Math.PI * 2); ctx.fill();
  }
  if (cur && cur.landing) {
    const [x, y] = P(cur.landing.x, cur.landing.z);
    ctx.strokeStyle = cur.success ? '#f5c542' : '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(x, y); ctx.stroke();
  }
  ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.fillText('bowler ↑', 6, 14);
  ctx.fillStyle = '#f5c542'; ctx.fillText('● six', 6, h - 22); ctx.fillStyle = '#60a5fa'; ctx.fillText('● four', 6, h - 8);
}

export default {
  id: 'cricket', name: 'Cricket', icon: '🏏', goal: 'Hit a SIX', view: "Keeper's view",
  successWord: 'Six', genes: GENES, settings: SETTINGS, simulate, guide, camera, render, drawMini,
  miniTitle: 'Where the shots landed',
  preview: (s) => `Delivery: ${s.speed} km/h, pitching ${s.length.toFixed(1)} m from the batter`,
  strategy: [
    '<b>Watch the ball:</b> after each attempt, move the bat toward where the ball actually was when it reached the hitting point.',
    '<b>Get to the pitch:</b> read the delivery and step forward or back to meet the ball at about waist height.',
    '<b>Get under it:</b> once it connects, aim for a launch angle near 38°, swing harder, and target cow corner (leg side).',
  ],
};
