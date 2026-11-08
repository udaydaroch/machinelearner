// Shared physics + math helpers used by every sport.
export const G = 9.81;
export const D2R = Math.PI / 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

// Map normalised genes [0,1] to real-world parameters.
export function decode(defs, genes) {
  const o = {};
  defs.forEach((d, i) => { o[d.key] = d.min + (d.max - d.min) * genes[i]; });
  return o;
}

// One semi-implicit Euler step with gravity + quadratic air drag.
export function stepDrag(b, k, dt) {
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  b.vx -= k * sp * b.vx * dt;
  b.vy -= (G + k * sp * b.vy) * dt;
  b.vz -= k * sp * b.vz * dt;
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
}

// Position on a recorded trajectory at time t (frames sorted by t).
export function sampleAt(fr, t) {
  if (!fr || !fr.length || t < fr[0].t) return null;
  const last = fr[fr.length - 1];
  if (t >= last.t) return last;
  let lo = 0, hi = fr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (fr[m].t <= t) lo = m; else hi = m; }
  const a = fr[lo], b = fr[hi], u = (t - a.t) / ((b.t - a.t) || 1);
  return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u), t };
}

// Frames up to time t (for drawing the live ball trail).
export function framesUntil(fr, t, from = -Infinity) {
  const out = [];
  for (const f of fr) { if (f.t > t) break; if (f.t >= from) out.push(f); }
  const s = sampleAt(fr, t);
  if (s && out.length) out.push(s);
  return out;
}

export function decimate(fr, every, from = -Infinity) {
  const out = [];
  let i = 0;
  for (const f of fr) { if (f.t < from) continue; if (i++ % every === 0) out.push({ x: f.x, y: f.y, z: f.z }); }
  const l = fr[fr.length - 1];
  if (l) out.push({ x: l.x, y: l.y, z: l.z });
  return out;
}
