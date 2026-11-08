import { G, D2R, clamp, lerp, smooth, decode, sampleAt, framesUntil, decimate } from '../physics.js';
import { gauss } from '../ga.js';
import * as D from '../draw3d.js';

// Regulation board: bull 6.35 mm, outer bull 15.9 mm, treble 99–107 mm, double 162–170 mm.
const R_BULL = 0.00635, R_OBULL = 0.0159, R_T0 = 0.099, R_T1 = 0.107, R_D0 = 0.162, R_D1 = 0.170;
const R_NUM = 0.225, R_CAB = 0.33;
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const T0 = 0.75;          // aim + draw-back before release
const REL_X = 0.15, REL_Z = 0.35;
const DRAG = 0.002;

const GENES = [
  { key: 'angle', label: 'Release angle', min: -5, max: 25, unit: '°', dp: 1 },
  { key: 'speed', label: 'Release speed', min: 5, max: 20, unit: 'm/s', dp: 2 },
  { key: 'yaw', label: 'Left/right aim', min: -8, max: 8, unit: '°', dp: 2 },
  { key: 'height', label: 'Release height', min: 1.5, max: 1.95, unit: 'm', dp: 2 },
];

const SETTINGS = [
  { key: 'dist', label: 'Throwing distance (oche → board)', min: 2.0, max: 3.6, step: 0.01, value: 2.37, unit: 'm' },
  { key: 'height', label: 'Bullseye height', min: 1.4, max: 2.0, step: 0.01, value: 1.73, unit: 'm' },
  { key: 'wobble', label: 'Hand wobble (0 = robot-steady)', min: 0, max: 1, step: 0.05, value: 0.3, unit: '' },
];

function score(x, y) {
  const r = Math.hypot(x, y);
  if (r <= R_BULL) return { text: 'BULLSEYE!', pts: 50, bull: true, inner: true };
  if (r <= R_OBULL) return { text: 'BULL!', pts: 25, bull: true };
  if (r > R_D1) return { text: r > R_CAB ? 'Hit the wall' : 'Missed the board', pts: 0 };
  const ang = ((Math.atan2(x, y) / D2R) + 9 + 360) % 360;
  const n = ORDER[Math.floor(ang / 18)];
  if (r >= R_T0 && r <= R_T1) return { text: `Treble ${n}`, pts: n * 3 };
  if (r >= R_D0) return { text: `Double ${n}`, pts: n * 2 };
  return { text: `Single ${n}`, pts: n };
}

function simulate(g, s) {
  const p = decode(GENES, g);
  const Dz = s.dist, H = s.height;
  // human-like noise: every throw comes out a little different
  const wob = s.wobble;
  const angle = p.angle + gauss() * wob * 0.35;
  const yaw0 = Math.atan2(-REL_X, Dz - REL_Z) / D2R;
  const yaw = yaw0 + p.yaw + gauss() * wob * 0.35;
  const speed = p.speed * (1 + gauss() * wob * 0.012);
  const el = angle * D2R, az = yaw * D2R;
  const b = { x: REL_X, y: p.height, z: REL_Z, vx: speed * Math.cos(el) * Math.sin(az), vy: speed * Math.sin(el), vz: speed * Math.cos(el) * Math.cos(az) };
  const dt = 1 / 240;
  let t = T0;
  const frames = [{ t, x: b.x, y: b.y, z: b.z }];
  let floorHit = null, aim = null, dir = null;
  while (t < T0 + 3) {
    const px = b.x, py = b.y, pz = b.z;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    b.vx -= DRAG * sp * b.vx * dt; b.vy -= (G + DRAG * sp * b.vy) * dt; b.vz -= DRAG * sp * b.vz * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; t += dt;
    if (!floorHit && b.y <= 0) {
      floorHit = { x: b.x, y: 0, z: b.z, t };
      frames.push({ t, x: b.x, y: 0, z: b.z });
    }
    if (b.z >= Dz) {
      const u = (Dz - pz) / (b.z - pz);
      aim = { x: lerp(px, b.x, u), y: lerp(py, b.y, u), t: t - dt + dt * u };
      dir = D.norm({ x: b.vx, y: b.vy, z: b.vz });
      if (!floorHit) frames.push({ t: aim.t, x: aim.x, y: aim.y, z: Dz });
      break;
    }
    if (b.vz <= 0) break;
    if (!floorHit) frames.push({ t, x: b.x, y: b.y, z: b.z });
  }
  if (!aim) aim = { x: b.x, y: -5, t };
  if (!dir) dir = { x: 0, y: 0, z: 1 };
  const ex = aim.x, ey = aim.y - H;
  const err = Math.hypot(ex, ey);
  let sc;
  if (floorHit) sc = { text: 'Hit the floor', pts: 0 };
  else sc = score(ex, ey);
  const success = !!sc.bull;
  const fitness = success ? 100 + (sc.inner ? 20 : 0) : 55 * Math.exp(-err / 0.4) + 35 * Math.exp(-err / 0.05);
  const duration = frames[frames.length - 1].t;
  const outcomeTime = floorHit ? floorHit.t : aim.t;
  const detail = `${speed.toFixed(1)} m/s at ${angle.toFixed(1)}° · ${(err * 1000).toFixed(0)} mm from the bull${sc.pts ? ` · ${sc.pts} pts` : ''}`;
  return {
    frames, fitness, success, outcome: sc.text, detail, outcomeTime, duration, contactT: T0, params: p,
    info: { ex, ey, err, dir, onBoard: !floorHit, hit: floorHit ? { x: floorHit.x, y: 0, z: floorHit.z } : { x: aim.x, y: aim.y, z: Dz }, floor: !!floorHit },
    landing: floorHit ? null : { x: ex, y: ey, outcome: success ? 'bull' : 'board' },
    trail: decimate(frames, 3),
  };
}

// SPORT-SPECIFIC STRATEGY: read where the last dart landed and correct the throw.
function guide(g, r, s) {
  const d = new Array(GENES.length).fill(0);
  if (!r) return d;
  const p = r.params, { ex, ey } = r.info;
  const dist = s.dist - REL_Z;
  if (r.success) return d;                                       // it worked: don't fix what isn't broken
  // Only partly correct: part of every miss is random hand wobble, and over-correcting chases noise.
  const k = r.info.err < 0.06 ? 0.5 : 0.85;
  d[0] = ((-Math.atan2(ey, dist) / D2R) / 30) * k;              // landed high -> lower the release angle
  d[2] = ((-Math.atan2(ex, dist) / D2R) / 16) * k;              // landed right -> aim further left
  d[1] = ((15 - p.speed) / 15) * 0.15;                          // a fast, flat throw drops less, so wobble matters less
  d[3] = ((clamp(s.height, 1.5, 1.95) - p.height) / 0.45) * 0.2; // eye, dart and bull in one line
  return d;
}

function camera(s) {
  return { pos: { x: 0.32, y: s.height + 0.16, z: -0.75 }, target: { x: 0, y: s.height - 0.04, z: s.dist }, fov: 24 };
}

// ---------- drawing ----------
const C = { black: '#141414', cream: '#eadfc2', red: '#c3262e', green: '#178a43', wire: 'rgba(200,205,215,.55)' };

function wedge(H, Dz, r0, r1, a0, a1, n = 4) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push({ x: r1 * Math.sin(a), y: H + r1 * Math.cos(a), z: Dz }); }
  for (let i = n; i >= 0; i--) { const a = a0 + ((a1 - a0) * i) / n; pts.push({ x: r0 * Math.sin(a), y: H + r0 * Math.cos(a), z: Dz }); }
  return pts;
}
function disc(H, Dz, r, n = 40) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push({ x: r * Math.sin(a), y: H + r * Math.cos(a), z: Dz }); }
  return pts;
}

function drawBoard(ctx, cam, H, Dz) {
  const z = Dz - 0.004;
  D.poly(ctx, cam, disc(H, Dz + 0.01, R_CAB, 48), '#2a1d14');
  D.poly(ctx, cam, disc(H, Dz + 0.008, R_CAB - 0.02, 48), '#3a281b');
  D.poly(ctx, cam, disc(H, Dz, R_NUM, 60), '#0d0d0d');
  for (let i = 0; i < 20; i++) {
    const a0 = (i * 18 - 9) * D2R, a1 = (i * 18 + 9) * D2R;
    const even = i % 2 === 0;
    D.poly(ctx, cam, wedge(H, z, R_OBULL, R_T0, a0, a1), even ? C.black : C.cream);
    D.poly(ctx, cam, wedge(H, z, R_T0, R_T1, a0, a1), even ? C.red : C.green);
    D.poly(ctx, cam, wedge(H, z, R_T1, R_D0, a0, a1), even ? C.black : C.cream);
    D.poly(ctx, cam, wedge(H, z, R_D0, R_D1, a0, a1), even ? C.red : C.green);
    D.line(ctx, cam, { x: R_OBULL * Math.sin(a0), y: H + R_OBULL * Math.cos(a0), z: z - 0.001 }, { x: R_D1 * Math.sin(a0), y: H + R_D1 * Math.cos(a0), z: z - 0.001 }, C.wire, 0.6);
    // numbers
    const am = i * 18 * D2R;
    const np = cam.project({ x: 0.197 * Math.sin(am), y: H + 0.197 * Math.cos(am), z: z - 0.002 });
    if (np) {
      ctx.fillStyle = '#f1f5f9';
      ctx.font = `600 ${Math.max(7, 0.03 * np.s).toFixed(1)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(ORDER[i]), np.x, np.y);
    }
  }
  for (const r of [R_T0, R_T1, R_D0, R_D1]) D.polyline(ctx, cam, disc(H, z - 0.001, r, 60), C.wire, 0.6, true);
  D.poly(ctx, cam, disc(H, z - 0.001, R_OBULL, 32), C.green, C.wire, 0.6);
  D.poly(ctx, cam, disc(H, z - 0.002, R_BULL, 24), C.red);
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

function drawDart(ctx, cam, tip, u, flight = '#4fd1c5') {
  const at = (k) => D.add(tip, D.mul(u, -k));
  D.limb(ctx, cam, tip, at(0.022), 0.0025, '#e5e7eb');
  D.limb(ctx, cam, at(0.022), at(0.072), 0.0075, '#8b95a5');
  D.limb(ctx, cam, at(0.072), at(0.11), 0.0035, '#1f2937');
  D.limb(ctx, cam, at(0.105), at(0.15), 0.036, flight);
}

function armPose(r, t, H) {
  const relH = r.params.height;
  const aimP = { x: 0.15, y: relH, z: 0.18 };
  const back = { x: 0.16, y: relH + 0.04, z: 0.02 };
  const rel = { x: REL_X, y: relH, z: REL_Z };
  const follow = { x: 0.13, y: relH - 0.12, z: 0.44 };
  let hand;
  if (t < T0 - 0.28) hand = aimP;
  else if (t < T0 - 0.1) hand = D.lerpV(aimP, back, smooth((t - (T0 - 0.28)) / 0.18));
  else if (t < T0) hand = D.lerpV(back, rel, smooth((t - (T0 - 0.1)) / 0.1));
  else hand = D.lerpV(rel, follow, smooth((t - T0) / 0.25));
  const shoulder = { x: 0.3, y: 1.47, z: -0.22 };
  const elbow = { x: 0.36 - (hand.z - 0.18) * 0.3, y: relH - 0.24, z: 0.02 + (hand.z - 0.18) * 0.6 };
  return { hand, shoulder, elbow };
}

function render(ctx, cam, st) {
  const { w, h, result: r, t, settings: s } = st;
  const H = s.height, Dz = s.dist;
  // room
  ctx.fillStyle = '#0c0f18'; ctx.fillRect(0, 0, w, h);
  D.poly(ctx, cam, [{ x: -6, y: 0, z: Dz + 0.03 }, { x: 6, y: 0, z: Dz + 0.03 }, { x: 6, y: 4, z: Dz + 0.03 }, { x: -6, y: 4, z: Dz + 0.03 }], '#1a2033');
  for (let i = -12; i < 12; i++) if (i % 2) D.poly(ctx, cam, [{ x: i * 0.25, y: 0, z: Dz + 0.029 }, { x: i * 0.25 + 0.25, y: 0, z: Dz + 0.029 }, { x: i * 0.25 + 0.25, y: 4, z: Dz + 0.029 }, { x: i * 0.25, y: 4, z: Dz + 0.029 }], '#1d2438');
  D.poly(ctx, cam, D.rect(-6, 6, -2, Dz + 0.03), '#16120f');
  for (let i = 0; i < 30; i++) D.line(ctx, cam, { x: -6, y: 0.001, z: -2 + i * 0.2 }, { x: 6, y: 0.001, z: -2 + i * 0.2 }, 'rgba(255,255,255,.025)', 1);
  D.poly(ctx, cam, D.rect(-0.6, 0.6, -0.03, 0.03, 0.01), '#9ca3af');
  // spotlight on the board
  const c = cam.project({ x: 0, y: H, z: Dz });
  if (c) {
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(w, h) * 0.55);
    g.addColorStop(0, 'rgba(255,236,200,.22)'); g.addColorStop(0.35, 'rgba(255,236,200,.06)'); g.addColorStop(1, 'rgba(0,0,0,.35)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  drawBoard(ctx, cam, H, Dz);

  // every past throw leaves a hole — the trial-and-error record
  const all = st.allGhosts || [];
  for (const gr of all) {
    if (gr === r || !gr.info.onBoard) continue;
    const p = cam.project({ x: gr.info.hit.x, y: gr.info.hit.y, z: Dz - 0.006 });
    if (!p) continue;
    ctx.fillStyle = gr.success ? 'rgba(245,197,66,.95)' : 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.5, 0.004 * p.s), 0, Math.PI * 2); ctx.fill();
  }
  // the previous darts of this "visit" are still stuck in the board
  const prev = all.filter((gr) => gr !== r).slice(-2);
  for (const gr of prev) {
    if (gr.info.floor) continue;
    drawDart(ctx, cam, { ...gr.info.hit, z: Dz - 0.01 }, gr.info.dir, gr.success ? '#f5c542' : '#64748b');
  }

  if (!r) return;
  const pose = armPose(r, t, H);
  let dartTip, dartDir;
  const pos = sampleAt(r.frames, t);
  if (!pos) {
    dartDir = D.norm(D.sub({ x: 0, y: H, z: Dz }, pose.hand));
    dartTip = D.add(pose.hand, D.mul(dartDir, 0.1));
  } else {
    const ahead = sampleAt(r.frames, t + 0.01);
    const settled = t >= r.duration;
    dartDir = settled ? r.info.dir : D.norm(D.sub(ahead, pos));
    if (!isFinite(dartDir.x) || D.len(D.sub(ahead, pos)) < 1e-6) dartDir = r.info.dir;
    dartTip = settled && r.info.onBoard ? { x: r.info.hit.x, y: r.info.hit.y, z: Dz - 0.01 } : pos;
    if (t < r.outcomeTime) D.polyline(ctx, cam, framesUntil(r.frames, t), 'rgba(255,255,255,.35)', 1.2);
  }
  drawDart(ctx, cam, dartTip, dartDir, r.success ? '#f5c542' : '#4fd1c5');
}

function drawMini(ctx, w, h, ghosts, cur) {
  const cx = w / 2, cy = h / 2, sc = (Math.min(w, h) / 2 - 8) / R_NUM;
  const ring = (r, fill) => { ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, cy, r * sc, 0, Math.PI * 2); ctx.fill(); };
  ring(R_NUM, '#0d0d0d');
  for (let i = 0; i < 20; i++) {
    const a0 = (i * 18 - 9 - 90) * D2R, a1 = (i * 18 + 9 - 90) * D2R, even = i % 2 === 0;
    for (const [r0, r1, col] of [[R_OBULL, R_T0, even ? C.black : C.cream], [R_T0, R_T1, even ? C.red : C.green], [R_T1, R_D0, even ? C.black : C.cream], [R_D0, R_D1, even ? C.red : C.green]]) {
      ctx.fillStyle = col; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(cx, cy, r1 * sc, a0, a1); ctx.arc(cx, cy, r0 * sc, a1, a0, true); ctx.closePath(); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ring(R_OBULL, C.green); ring(R_BULL, C.red);
  for (const g of ghosts) {
    if (!g.landing) continue;
    const x = cx + g.landing.x * sc, y = cy - g.landing.y * sc;
    if (Math.hypot(g.landing.x, g.landing.y) > R_NUM) continue;
    ctx.fillStyle = g.success ? '#f5c542' : 'rgba(255,255,255,.75)';
    ctx.beginPath(); ctx.arc(x, y, g === cur ? 4 : 2.4, 0, Math.PI * 2); ctx.fill();
    if (g === cur) { ctx.strokeStyle = '#4fd1c5'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.font = '11px Inter, system-ui'; ctx.fillStyle = '#f5c542'; ctx.fillText('● bull', 6, 14);
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText('● miss', 6, 28);
}

export default {
  id: 'darts', name: 'Darts', icon: '🎯', goal: 'Hit the BULLSEYE', view: 'Thrower\'s eye view',
  successWord: 'Bull', genes: GENES, settings: SETTINGS, simulate, guide, camera, render, drawMini,
  miniTitle: 'Where the darts landed',
  preview: (s) => `Throwing from ${s.dist.toFixed(2)} m at a bull ${s.height.toFixed(2)} m high`,
  strategy: [
    '<b>Read the board:</b> if the dart landed high or low, change the release angle by the angle of the miss.',
    '<b>Correct the line:</b> if it landed left or right, turn the aim back by the same angle.',
    '<b>Groove the throw:</b> move toward a fast, flat throw (~15 m/s) released at bull height. It drops less, so hand wobble throws it off less.',
    'Hand wobble adds human-like noise to every throw, so even a learned throw scatters. You can watch the cluster tighten around the bull.',
  ],
};
