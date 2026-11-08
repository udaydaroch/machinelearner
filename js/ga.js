// GENERAL STRATEGY — a steady-state genetic algorithm that learns online.
//
// Every attempt is one genome (a vector of genes in [0,1]). After each attempt:
//   1. Score the attempt with the sport's fitness function.
//   2. If it beats the weakest member, it replaces that member (the best is never lost).
//   3. The mutation step size adapts (1/5th success rule): if children often beat their
//      parents it grows (explore more), otherwise it shrinks (fine tune).
//   4. If nothing improves for a while, random "immigrants" replace the bottom 40%.
// New attempts come either from evolution (tournament selection, crossover, Gaussian
// mutation) or from the sport-specific strategy, which reads what happened on the
// parent's attempt and suggests a directed change (like a coach's feedback).

export function gauss() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const reflect = (v) => { v %= 2; if (v < 0) v += 2; return v > 1 ? 2 - v : v; };

export class GeneticLearner {
  constructor(geneCount, opts = {}) {
    this.n = geneCount;
    this.opts = { popSize: 24, mutation: 0.15, guided: true, guidedRate: 0.5, ...opts };
    this.reset();
  }

  reset() {
    this.pop = Array.from({ length: this.opts.popSize }, () => this.randomIndividual());
    this.sigma = this.opts.mutation;
    this.attempts = 0; this.successes = 0; this.firstSuccess = null;
    this.best = null; this.lastImprove = 0;
    this.recent = []; this.improveWindow = []; this.history = [];
    this.immigrations = 0;
  }

  randomIndividual() {
    return { genes: Array.from({ length: this.n }, Math.random), fitness: null, result: null };
  }

  setOption(k, v) {
    this.opts[k] = v;
    if (k === 'mutation') this.sigma = v;
    if (k === 'popSize') {
      this.pop.sort((a, b) => (b.fitness ?? -1e9) - (a.fitness ?? -1e9));
      if (v < this.pop.length) this.pop.length = v;
      while (this.pop.length < v) this.pop.push(this.randomIndividual());
    }
  }

  tournament(k = 3) {
    let best = null;
    for (let i = 0; i < k; i++) {
      const c = this.pop[(Math.random() * this.pop.length) | 0];
      if (c.fitness === null) continue;
      if (!best || c.fitness > best.fitness) best = c;
    }
    return best || this.pop.find((i) => i.fitness !== null) || this.pop[0];
  }

  propose(guide) {
    const seed = this.pop.find((i) => i.fitness === null);
    if (seed) return { genes: seed.genes.slice(), kind: 'explore', slot: seed, parentFit: null };

    if (this.opts.guided && guide && Math.random() < this.opts.guidedRate) {
      const p = this.tournament(2);
      const d = guide(p.genes, p.result) || [];
      const k = 0.6 + Math.random() * 0.6;
      const genes = p.genes.map((g, i) => reflect(g + (d[i] || 0) * k + gauss() * this.sigma * 0.3));
      return { genes, kind: 'strategy', parentFit: p.fitness };
    }

    const a = this.tournament(), b = this.tournament();
    const genes = new Array(this.n);
    for (let i = 0; i < this.n; i++) {
      genes[i] = Math.random() < 0.5
        ? (Math.random() < 0.5 ? a.genes[i] : b.genes[i])                     // uniform crossover
        : a.genes[i] + (b.genes[i] - a.genes[i]) * (Math.random() * 1.5 - 0.25); // blend crossover
    }
    const pm = Math.max(1 / this.n, 0.35);
    for (let i = 0; i < this.n; i++) {
      if (Math.random() < pm) genes[i] += gauss() * this.sigma;
      genes[i] = reflect(genes[i]);
    }
    return { genes, kind: 'evolve', parentFit: Math.max(a.fitness, b.fitness) };
  }

  report(cand, fitness, result, success) {
    this.attempts++;
    let event = null;
    if (success) {
      this.successes++;
      if (this.firstSuccess === null) { this.firstSuccess = this.attempts; event = 'first'; }
    }
    this.recent.push(success ? 1 : 0);
    if (this.recent.length > 20) this.recent.shift();

    if (cand.slot) {
      cand.slot.fitness = fitness; cand.slot.result = result;
    } else {
      this.improveWindow.push(fitness > cand.parentFit ? 1 : 0);
      if (this.improveWindow.length > 20) this.improveWindow.shift();
      if (this.improveWindow.length >= 10) {
        const rate = this.improveWindow.reduce((s, v) => s + v, 0) / this.improveWindow.length;
        this.sigma = Math.min(0.4, Math.max(0.01, this.sigma * (rate > 0.2 ? 1.06 : 0.95)));
      }
      let worst = this.pop[0];
      for (const ind of this.pop) if (ind.fitness < worst.fitness) worst = ind;
      if (fitness > worst.fitness) { worst.genes = cand.genes.slice(); worst.fitness = fitness; worst.result = result; }
    }

    if (!this.best || fitness > this.best.fitness) {
      this.best = { genes: cand.genes.slice(), fitness, result, attempt: this.attempts };
      this.lastImprove = this.attempts;
    }
    this.history.push({ fitness, best: this.best.fitness, success, kind: cand.kind });
    if (this.history.length > 5000) this.history.shift();

    if (this.attempts - this.lastImprove > 25 + this.pop.length && this.successRate() < 0.6) {
      this.pop.sort((a, b) => b.fitness - a.fitness);
      const keep = Math.ceil(this.pop.length * 0.6);
      for (let i = keep; i < this.pop.length; i++) this.pop[i] = this.randomIndividual();
      this.sigma = Math.max(this.sigma, this.opts.mutation);
      this.lastImprove = this.attempts;
      this.immigrations++;
      event = 'immigrants';
    }
    return event;
  }

  successRate() { return this.recent.length ? this.recent.reduce((s, v) => s + v, 0) / this.recent.length : 0; }

  phase() {
    if (this.pop.some((i) => i.fitness === null)) return 'Exploring · random tries';
    const r = this.successRate();
    if (r >= 0.6) return 'Mastered · refining';
    if (this.best && this.firstSuccess) return 'Exploiting · repeating wins';
    return 'Searching · evolving';
  }

  // The environment changed (the user moved a slider): re-score everyone under the new conditions.
  reevaluate(evalFn) {
    for (const ind of this.pop) {
      if (ind.fitness === null) continue;
      const r = evalFn(ind.genes);
      ind.fitness = r.fitness; ind.result = r;
    }
    this.best = null;
    for (const ind of this.pop) {
      if (ind.fitness !== null && (!this.best || ind.fitness > this.best.fitness)) {
        this.best = { genes: ind.genes.slice(), fitness: ind.fitness, result: ind.result, attempt: this.attempts };
      }
    }
    this.lastImprove = this.attempts;
    this.recent = [];
    this.sigma = Math.max(this.sigma, this.opts.mutation * 0.7);
  }
}
