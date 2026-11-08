// Tiny perspective renderer on top of Canvas 2D. World: x = right, y = up, z = forward.
import { lerp, smooth } from './physics.js';

const NEAR = 0.08;
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
export const lerpV = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });

export class Camera {
  constructor(pos, target, fov, w, h) {
    this.pos = pos; this.w = w; this.h = h;
    this.f = norm(sub(target, pos));
    this.r = norm(cross({ x: 0, y: 1, z: 0 }, this.f));
    this.u = cross(this.f, this.r);
    this.focal = (h / 2) / Math.tan((fov * Math.PI) / 360);
  }
  toCam(p) { const d = sub(p, this.pos); return { x: dot(d, this.r), y: dot(d, this.u), z: dot(d, this.f) }; }
  projC(c) { return { x: this.w / 2 + (this.focal * c.x) / c.z, y: this.h / 2 - (this.focal * c.y) / c.z, s: this.focal / c.z }; }
  project(p) { const c = this.toCam(p); return c.z < NEAR ? null : this.projC(c); }
  depth(p) { return this.toCam(p).z; }
}

function clipPoly(cs) {
  const out = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i], b = cs[(i + 1) % cs.length];
    const ain = a.z >= NEAR, bin = b.z >= NEAR;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (NEAR - a.z) / (b.z - a.z);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: NEAR });
    }
  }
  return out;
}

export function path(ctx, cam, pts) {
  const c = clipPoly(pts.map((p) => cam.toCam(p)));
  if (c.length < 3) return false;
  ctx.beginPath();
  c.forEach((q, i) => { const s = cam.projC(q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
  ctx.closePath();
  return true;
}

export function poly(ctx, cam, pts, fill, stroke, lw = 1) {
  if (!path(ctx, cam, pts)) return;
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

function seg(cam, a, b) {
  let A = cam.toCam(a), B = cam.toCam(b);
  if (A.z < NEAR && B.z < NEAR) return null;
  let endClipped = false;
  if (A.z < NEAR) { const u = (NEAR - A.z) / (B.z - A.z); A = { x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u, z: NEAR }; }
  else if (B.z < NEAR) { const u = (NEAR - B.z) / (A.z - B.z); B = { x: B.x + (A.x - B.x) * u, y: B.y + (A.y - B.y) * u, z: NEAR }; endClipped = true; }
  return [cam.projC(A), cam.projC(B), endClipped];
}

export function line(ctx, cam, a, b, color, w = 1) {
  const s = seg(cam, a, b); if (!s) return;
  ctx.strokeStyle = color; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); ctx.stroke();
}

export function polyline(ctx, cam, pts, color, w = 1, closed = false) {
  if (pts.length < 2) return;
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin = 'round';
  ctx.beginPath();
  let pen = false;
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const s = seg(cam, pts[i], pts[(i + 1) % n]);
    if (!s) { pen = false; continue; }
    if (!pen) { ctx.moveTo(s[0].x, s[0].y); pen = true; }
    ctx.lineTo(s[1].x, s[1].y);
    if (s[2]) pen = false;
  }
  ctx.stroke();
}

// Thick limb whose width scales with distance (world-space width).
export function limb(ctx, cam, a, b, width, color) {
  const s = seg(cam, a, b); if (!s) return;
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, (width * (s[0].s + s[1].s)) / 2);
  ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); ctx.stroke();
  ctx.lineCap = 'butt';
}

export function ring(cx, cy, cz, r, n = 48, a0 = 0, a1 = Math.PI * 2) {
  const pts = [];
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const cnt = full ? n : n + 1;
  for (let i = 0; i < cnt; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push({ x: cx + r * Math.sin(a), y: cy, z: cz + r * Math.cos(a) });
  }
  return pts;
}

export const rect = (x0, x1, z0, z1, y = 0) => [
  { x: x0, y, z: z0 }, { x: x1, y, z: z0 }, { x: x1, y, z: z1 }, { x: x0, y, z: z1 },
];

export function sky(ctx, w, h, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

export function shadow(ctx, cam, p, r, groundY = 0) {
  const sp = cam.project({ x: p.x, y: groundY + 0.003, z: p.z });
  if (!sp) return;
  const a = 0.35 * Math.max(0, 1 - (p.y - groundY) / 15);
  if (a <= 0.01) return;
  const rx = Math.max(1.2, r * sp.s * 1.2);
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath(); ctx.ellipse(sp.x, sp.y, rx, rx * 0.4, 0, 0, Math.PI * 2); ctx.fill();
}

export function sphere(ctx, cam, p, r, base, hi = '#fff', opts = {}) {
  if (opts.shadow !== false) shadow(ctx, cam, p, r, opts.groundY || 0);
  const s = cam.project(p); if (!s) return;
  const rad = Math.max(opts.minPx ?? 1.8, r * s.s);
  const g = ctx.createRadialGradient(s.x - rad * 0.35, s.y - rad * 0.4, rad * 0.1, s.x, s.y, rad);
  g.addColorStop(0, hi); g.addColorStop(0.35, base); g.addColorStop(1, opts.dark || 'rgba(0,0,0,0.85)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(s.x, s.y, rad, 0, Math.PI * 2); ctx.fill();
  if (opts.seam && rad > 4) {
    ctx.strokeStyle = opts.seam; ctx.lineWidth = Math.max(1, rad * 0.12);
    ctx.beginPath(); ctx.arc(s.x, s.y, rad * 0.8, -1.1, 1.1); ctx.stroke();
  }
  if (opts.glow) {
    ctx.strokeStyle = opts.glow; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, rad + 4, 0, Math.PI * 2); ctx.stroke();
  }
}

// Body frame helper: base on the ground, facing yaw (0 = +z).
export function frame(base, yaw, lift = 0) {
  const f = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  const r = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  return (lx, ly, lz) => ({ x: base.x + r.x * lx + f.x * lz, y: ly + lift, z: base.z + r.z * lx + f.z * lz });
}

// Stylised human. J: footL, footR, hip, neck, head, shL, shR, handL, handR (kneeL/kneeR optional).
export function figure(ctx, cam, J, c) {
  const g = cam.project({ x: (J.footL.x + J.footR.x) / 2, y: 0.002, z: (J.footL.z + J.footR.z) / 2 });
  if (g) {
    const rx = Math.max(2, 0.42 * g.s);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath(); ctx.ellipse(g.x, g.y, rx, rx * 0.32, 0, 0, Math.PI * 2); ctx.fill();
  }
  const knee = (hip, foot, k) => k || { x: (hip.x + foot.x) / 2, y: (hip.y + foot.y) / 2, z: (hip.z + foot.z) / 2 };
  const elbow = (sh, hand) => ({ x: (sh.x + hand.x) / 2, y: (sh.y + hand.y) / 2 - 0.07, z: (sh.z + hand.z) / 2 });
  const kL = knee(J.hip, J.footL, J.kneeL), kR = knee(J.hip, J.footR, J.kneeR);
  const legs = c.legs || c.pants;
  limb(ctx, cam, J.hip, kL, 0.17, c.pants); limb(ctx, cam, kL, J.footL, 0.14, legs);
  limb(ctx, cam, J.hip, kR, 0.17, c.pants); limb(ctx, cam, kR, J.footR, 0.14, legs);
  limb(ctx, cam, J.footL, add(J.footL, { x: 0, y: 0.02, z: 0 }), 0.13, c.shoes || '#222');
  limb(ctx, cam, J.footR, add(J.footR, { x: 0, y: 0.02, z: 0 }), 0.13, c.shoes || '#222');
  limb(ctx, cam, J.hip, J.neck, 0.36, c.shirt);
  const eL = elbow(J.shL, J.handL), eR = elbow(J.shR, J.handR);
  limb(ctx, cam, J.shL, eL, 0.1, c.sleeve || c.shirt); limb(ctx, cam, eL, J.handL, 0.085, c.skin);
  limb(ctx, cam, J.shR, eR, 0.1, c.sleeve || c.shirt); limb(ctx, cam, eR, J.handR, 0.085, c.skin);
  const h = cam.project(J.head);
  if (h) {
    const r = Math.max(2, 0.115 * h.s);
    ctx.fillStyle = c.skin; ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.fill();
    if (c.hat) { ctx.fillStyle = c.hat; ctx.beginPath(); ctx.arc(h.x, h.y - r * 0.05, r * 1.06, Math.PI * 1.02, Math.PI * 1.98); ctx.fill(); ctx.fillRect(h.x - r * 1.06, h.y - r * 0.15, r * 2.12, r * 0.25); }
  }
}

// Bat swing: hands travel H0 -> Hc -> H1 while the bat rotates in the plane of (C - Hc) and aHint.
export function swing(H0, Hc, H1, C, s, phiBack, phiFollow, aHint, batLen) {
  const u = norm(sub(C, Hc));
  const a = norm(sub(aHint, mul(u, dot(aHint, u))));
  let phi, hands;
  if (s < 0.55) { const k = smooth(s / 0.55); phi = lerp(phiBack, 0, k); hands = lerpV(H0, Hc, k); }
  else { const k = smooth((s - 0.55) / 0.45); phi = lerp(0, phiFollow, k); hands = lerpV(Hc, H1, k); }
  const dir = add(mul(u, Math.cos(phi)), mul(a, Math.sin(phi)));
  return { hands, tip: add(hands, mul(dir, batLen)) };
}

// Painter's algorithm: draw items far -> near.
export function drawSorted(cam, items) {
  items.map((it) => ({ ...it, d: cam.depth(it.at) })).sort((a, b) => b.d - a.d).forEach((it) => it.draw());
}

export function hash(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// ---------- atmosphere helpers ----------
const CROWD = ['#94a3b8', '#cbd5e1', '#b45353', '#c8a24a', '#5b7fb8', '#6f9a86', '#9d6b8f', '#d6d3d1', '#7c8aa5'];

// Scatter spectators across a stand quad [bottomA, bottomB, topB, topA].
export function makeCrowd(q, n, seed) {
  const dots = [];
  for (let i = 0; i < n; i++) {
    const u = hash(seed * 31 + i * 2.13), v = hash(seed * 17 + i * 5.71);
    const b = lerpV(q[0], q[1], u), t = lerpV(q[3], q[2], u);
    dots.push({ p: lerpV(b, t, v * 0.92 + 0.04), c: CROWD[(hash(seed + i * 9.3) * CROWD.length) | 0] });
  }
  return dots;
}

export function drawCrowd(ctx, cam, dots, alpha = 0.8) {
  ctx.globalAlpha = alpha;
  for (const d of dots) {
    const s = cam.project(d.p);
    if (!s || s.x < -4 || s.x > cam.w + 4 || s.y < -4 || s.y > cam.h + 4) continue;
    const r = Math.max(0.8, Math.min(3, 0.22 * s.s));
    ctx.fillStyle = d.c;
    ctx.fillRect(s.x - r / 2, s.y - r, r, r * 1.4);
  }
  ctx.globalAlpha = 1;
}

// Stadium floodlight pylon with a glowing head.
export function floodlight(ctx, cam, base, height, facing) {
  const top = { x: base.x, y: height, z: base.z };
  limb(ctx, cam, base, top, 0.9, '#1f2937');
  const r = { x: Math.cos(facing), y: 0, z: -Math.sin(facing) };
  const head = [add(top, mul(r, -3.5)), add(top, mul(r, 3.5)), add(add(top, mul(r, 3.5)), { x: 0, y: 4, z: 0 }), add(add(top, mul(r, -3.5)), { x: 0, y: 4, z: 0 })];
  poly(ctx, cam, head, '#f8fafc', '#334155', 1);
  const c = cam.project(add(top, { x: 0, y: 2, z: 0 }));
  if (c) {
    const rad = Math.max(10, 9 * c.s);
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rad);
    g.addColorStop(0, 'rgba(255,250,230,.55)'); g.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, rad, 0, Math.PI * 2); ctx.fill();
  }
}

// Soft cinematic vignette over the whole frame.
export function vignette(ctx, w, h, strength = 0.38) {
  const g = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.35, w / 2, h * 0.5, Math.hypot(w, h) * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

// Atmospheric haze band along the horizon.
export function haze(ctx, cam, w, color = '255,255,255', a = 0.22) {
  const far = cam.project({ x: cam.pos.x + cam.f.x * 400, y: 0, z: cam.pos.z + cam.f.z * 400 });
  if (!far) return;
  const y = far.y, hgt = cam.h * 0.18;
  const g = ctx.createLinearGradient(0, y - hgt, 0, y + hgt * 0.6);
  g.addColorStop(0, `rgba(${color},0)`); g.addColorStop(0.6, `rgba(${color},${a})`); g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g; ctx.fillRect(0, y - hgt, w, hgt * 1.6);
}
