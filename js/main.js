import { GeneticLearner } from './ga.js';
import { Camera, vignette } from './draw3d.js';
import { drawChart, fitCanvas } from './chart.js';
import cricket from './sports/cricket.js';
import basketball from './sports/basketball.js';
import darts from './sports/darts.js';

const SPORTS = [cricket, basketball, darts];
const byId = Object.fromEntries(SPORTS.map((s) => [s.id, s]));
const $ = (id) => document.getElementById(id);
const HOLD = 0.9; // seconds to linger on the result before the next attempt
const TURBO_RATE = 8; // attempts per second in turbo mode (at 1× speed)
const KIND = { explore: 'random exploration', evolve: 'crossover + mutation', strategy: 'sport strategy (coached)', best: 'replaying best attempt' };

const learnerOpts = { popSize: 24, mutation: 0.15, guided: true, guidedRate: 0.5 };
const app = { sport: 'cricket', running: true, speed: 1, turbo: false, stepping: false, per: {}, envDirty: false };

function S() {
  const id = app.sport;
  if (!app.per[id]) {
    const sp = byId[id];
    const settings = {};
    sp.settings.forEach((d) => (settings[d.key] = d.value));
    app.per[id] = { settings, learner: new GeneticLearner(sp.genes.length, { ...learnerOpts }), ghosts: [], log: [], current: null, playT: 0, replay: false, logDirty: true };
  }
  return app.per[id];
}
const sport = () => byId[app.sport];

// ---------- learning ----------
function runAttempt() {
  const sp = sport(), ss = S();
  const cand = ss.learner.propose((g, r) => sp.guide(g, r, ss.settings));
  const res = sp.simulate(cand.genes, ss.settings);
  const ev = ss.learner.report(cand, res.fitness, res, res.success);
  res.genes = cand.genes; res.kind = cand.kind; res.attempt = ss.learner.attempts;
  ss.ghosts.push(res);
  if (ss.ghosts.length > 40) ss.ghosts.shift();
  ss.log.unshift({ n: res.attempt, text: res.outcome, detail: res.detail, success: res.success, fit: res.fitness, kind: cand.kind });
  if (ev === 'first') ss.log.unshift({ n: res.attempt, sys: true, text: `First ${sp.successWord.toLowerCase()} after ${res.attempt} attempts!` });
  if (ev === 'immigrants') ss.log.unshift({ n: res.attempt, sys: true, text: 'Stuck: injecting fresh random genomes' });
  if (ss.log.length > 60) ss.log.length = 60;
  ss.logDirty = true;
  return res;
}

function applyEnvChange() {
  const sp = sport(), ss = S();
  ss.learner.reevaluate((g) => sp.simulate(g, ss.settings));
  ss.ghosts = [];
  ss.log.unshift({ n: ss.learner.attempts, sys: true, text: 'Conditions changed: re-scored the population, adapting…' });
  ss.logDirty = true;
  if (!app.turbo) { ss.current = null; ss.playT = 0; }
}

function tick(dt) {
  const ss = S();
  if (app.envDirty) { app.envDirty = false; applyEnvChange(); }
  if (app.turbo && app.running && !ss.replay) {
    // Steady pace: TURBO_RATE attempts per second at 1×, scaled by the playback-speed slider.
    app.turboAcc = (app.turboAcc || 0) + dt * TURBO_RATE * app.speed;
    let res = null;
    while (app.turboAcc >= 1) { app.turboAcc -= 1; res = runAttempt(); }
    if (res) { ss.current = res; ss.playT = res.duration + HOLD; }
    else if (!ss.current) { ss.current = runAttempt(); ss.playT = ss.current.duration + HOLD; }
    return;
  }
  const cur = ss.current;
  if (cur && ss.playT < cur.duration + HOLD) {
    if (app.running || app.stepping || ss.replay) ss.playT += dt * app.speed;
    return;
  }
  if (ss.replay) ss.replay = false;
  app.stepping = false;
  if (app.running) { ss.current = runAttempt(); ss.playT = 0; }
}

// ---------- rendering ----------
const scene = $('scene');
function render() {
  const sp = sport(), ss = S();
  const { ctx, w, h } = fitCanvas(scene);
  const cd = sp.camera(ss.settings);
  const cam = new Camera(cd.pos, cd.target, cd.fov, w, h);
  sp.render(ctx, cam, { w, h, result: ss.current, t: ss.playT, ghosts: ss.ghosts.slice(-12), allGhosts: ss.ghosts, settings: ss.settings });
  vignette(ctx, w, h, sp.id === 'cricket' ? 0.4 : 0.3);

  const cur = ss.current;
  const banner = $('banner');
  const show = cur && ss.playT >= cur.outcomeTime;
  const text = show ? cur.outcome : '';
  if (banner.dataset.text !== text) {
    banner.dataset.text = text;
    banner.textContent = text;
    banner.className = 'banner' + (show ? ' show ' + (cur.success ? 'win' : 'lose') : '');
  }
  $('hudAttempt').textContent = cur ? (ss.replay ? `Best attempt (#${ss.learner.best?.attempt ?? '–'})` : `Attempt #${cur.attempt}`) : 'Ready';
  $('hudKind').textContent = cur ? (ss.replay ? KIND.best : KIND[cur.kind] || '') : '';
  $('hudReadout').textContent = cur ? (ss.playT >= cur.contactT + 0.05 ? cur.detail : sp.preview(ss.settings)) : sp.preview(ss.settings);
}

let uiTimer = -Infinity;
function updatePanels() {
  const sp = sport(), ss = S(), L = ss.learner;
  $('phase').textContent = L.phase();
  $('rateBar').style.width = `${Math.round(L.successRate() * 100)}%`;
  $('rateTxt').textContent = `${Math.round(L.successRate() * 100)}%`;
  $('rateTxt').title = 'Success rate over the last 20 attempts';
  const stats = [
    ['Attempts', L.attempts],
    [`${sp.successWord}s`, L.successes],
    ['First success', L.firstSuccess ? `#${L.firstSuccess}` : '—'],
    ['Best score', L.best ? L.best.fitness.toFixed(1) : '—'],
    ['Mutation σ', L.sigma.toFixed(2)],
  ];
  $('stats').innerHTML = stats.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');

  const g = ss.current?.genes, best = L.best?.genes;
  sp.genes.forEach((d, i) => {
    const row = $('gene-' + i);
    if (!row) return;
    const v = g ? g[i] : 0;
    row.querySelector('i').style.width = `${(v * 100).toFixed(1)}%`;
    const mk = row.querySelector('b');
    mk.style.display = best ? 'block' : 'none';
    if (best) mk.style.left = `calc(${(best[i] * 100).toFixed(1)}% - 1px)`;
    const real = d.min + (d.max - d.min) * v;
    row.querySelector('.val').textContent = g ? (d.pct ? `${Math.round(v * 100)}%` : `${real.toFixed(d.dp)} ${d.unit}`) : '—';
  });

  if (ss.logDirty) {
    ss.logDirty = false;
    $('log').innerHTML = ss.log.slice(0, 40).map((e) => e.sys
      ? `<li class="sys"><span class="n">#${e.n}</span><span>${e.text}</span></li>`
      : `<li class="${e.success ? 'win' : ''}"><span class="n">#${e.n}</span><span><span class="t">${e.text}</span><span class="k">${KIND[e.kind]}</span></span><span class="f">${e.fit.toFixed(0)}</span></li>`).join('');
  }
  drawChart($('chart'), L.history);
  const mini = fitCanvas($('mini'));
  mini.ctx.clearRect(0, 0, mini.w, mini.h);
  sp.drawMini(mini.ctx, mini.w, mini.h, ss.ghosts, ss.current, ss.settings);
}

// ---------- UI wiring ----------
function fmt(v, d) {
  const dec = d.step >= 1 ? 0 : d.step >= 0.1 ? 1 : 2;
  return `${v.toFixed(dec)} ${d.unit || ''}`.trim();
}

function paintRange(el) {
  const p = ((parseFloat(el.value) - parseFloat(el.min)) / (parseFloat(el.max) - parseFloat(el.min))) * 100;
  el.style.setProperty('--p', `${p}%`);
}
document.addEventListener('input', (e) => { if (e.target.matches('input[type=range]')) paintRange(e.target); });
const paintAll = () => document.querySelectorAll('input[type=range]').forEach(paintRange);

function buildSport() {
  const sp = sport(), ss = S();
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.id === sp.id));
  $('hudGoal').textContent = `${sp.icon} Goal: ${sp.goal}`;
  $('hudView').textContent = `Camera: ${sp.view}`;
  $('miniTitle').textContent = sp.miniTitle;
  $('howSport').textContent = `Sport-specific strategy: ${sp.name}`;
  $('howList').innerHTML = sp.strategy.map((s) => `<li>${s}</li>`).join('');

  const env = $('envControls');
  env.innerHTML = '';
  sp.settings.forEach((d) => {
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    wrap.innerHTML = `<label><span>${d.label}</span><output>${fmt(ss.settings[d.key], d)}</output></label>
      <input type="range" min="${d.min}" max="${d.max}" step="${d.step}" value="${ss.settings[d.key]}" aria-label="${d.label}">`;
    const input = wrap.querySelector('input'), out = wrap.querySelector('output');
    input.addEventListener('input', () => {
      ss.settings[d.key] = parseFloat(input.value);
      out.textContent = fmt(ss.settings[d.key], d);
      app.envDirty = true;
    });
    env.appendChild(wrap);
  });

  $('genes').innerHTML = sp.genes.map((d, i) => `<div class="gene" id="gene-${i}"><div class="top"><span>${d.label}</span><span class="val">—</span></div><div class="bar"><i></i><b></b></div></div>`).join('');

  const o = ss.learner.opts;
  $('pop').value = o.popSize; $('popOut').textContent = o.popSize;
  $('mut').value = o.mutation; $('mutOut').textContent = o.mutation.toFixed(2);
  $('guided').checked = o.guided;
  ss.logDirty = true;
  paintAll();
  updatePanels();
}

$('tabs').innerHTML = SPORTS.map((s) => `<button class="tab" role="tab" data-id="${s.id}">${s.icon} ${s.name}</button>`).join('');
$('tabs').addEventListener('click', (e) => {
  const b = e.target.closest('.tab');
  if (!b || b.dataset.id === app.sport) return;
  app.sport = b.dataset.id;
  app.envDirty = false;
  try { localStorage.setItem('ml-sport', app.sport); } catch {}
  buildSport();
});

function setRunning(v) {
  app.running = v;
  $('btnRun').textContent = v ? 'Pause' : 'Resume';
  $('btnRun').classList.toggle('primary', v);
}
document.querySelector('.seg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-pane]');
  if (!b) return;
  document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === b.dataset.pane));
});
$('btnRun').addEventListener('click', () => setRunning(!app.running));
$('btnStep').addEventListener('click', () => {
  setRunning(false);
  const ss = S();
  ss.replay = false;
  ss.current = runAttempt(); ss.playT = 0; app.stepping = true;
});
$('btnBest').addEventListener('click', () => {
  const sp = sport(), ss = S(), best = ss.learner.best;
  if (!best) return;
  const res = sp.simulate(best.genes, ss.settings);
  res.genes = best.genes; res.kind = 'best'; res.attempt = best.attempt;
  ss.current = res; ss.playT = 0; ss.replay = true;
});
$('btnReset').addEventListener('click', () => {
  const ss = S();
  ss.learner.reset(); ss.ghosts = []; ss.log = []; ss.current = null; ss.playT = 0; ss.replay = false; ss.logDirty = true;
  updatePanels();
});
$('speed').addEventListener('input', (e) => { app.speed = parseFloat(e.target.value); $('speedOut').textContent = `${app.speed}×`; });
$('turbo').addEventListener('change', (e) => {
  app.turbo = e.target.checked;
  const ss = S();
  if (!app.turbo) { ss.current = null; ss.playT = 0; }
});
$('guided').addEventListener('change', (e) => { learnerOpts.guided = e.target.checked; S().learner.setOption('guided', e.target.checked); });
$('pop').addEventListener('input', (e) => { const v = parseInt(e.target.value, 10); $('popOut').textContent = v; learnerOpts.popSize = v; S().learner.setOption('popSize', v); });
$('mut').addEventListener('input', (e) => { const v = parseFloat(e.target.value); $('mutOut').textContent = v.toFixed(2); learnerOpts.mutation = v; S().learner.setOption('mutation', v); });
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !['INPUT', 'BUTTON'].includes(document.activeElement?.tagName)) { e.preventDefault(); setRunning(!app.running); }
});

try { const saved = localStorage.getItem('ml-sport'); if (saved && byId[saved]) app.sport = saved; } catch {}
const qs = new URLSearchParams(location.search).get('sport');
if (qs && byId[qs]) app.sport = qs;
if (new URLSearchParams(location.search).get('turbo') === '1') { app.turbo = true; $('turbo').checked = true; }
buildSport();

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  render();
  if (now - uiTimer > 100) { uiTimer = now; updatePanels(); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
