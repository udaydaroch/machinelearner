// Learning curve: score of every attempt, best-so-far and rolling success rate.
export function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export function drawChart(canvas, history) {
  const { ctx, w, h } = fitCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const padL = 30, padB = 18, padT = 6, padR = 8;
  const pw = w - padL - padR, ph = h - padT - padB;
  const win = history.slice(-300);
  const offset = history.length - win.length;
  let maxF = 60;
  for (const e of win) maxF = Math.max(maxF, e.fitness, e.best);
  maxF = Math.ceil(maxF / 20) * 20;
  const X = (i) => padL + (win.length <= 1 ? pw / 2 : (i / (win.length - 1)) * pw);
  const Y = (f) => padT + ph - (Math.max(0, f) / maxF) * ph;

  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.fillStyle = '#6b7896'; ctx.font = '10px system-ui'; ctx.lineWidth = 1;
  for (let f = 0; f <= maxF; f += maxF / 4) {
    ctx.beginPath(); ctx.moveTo(padL, Y(f)); ctx.lineTo(w - padR, Y(f)); ctx.stroke();
    ctx.fillText(String(Math.round(f)), 2, Y(f) + 3);
  }
  if (!win.length) {
    ctx.fillText('waiting for the first attempt…', padL + 8, padT + ph / 2);
    return;
  }
  ctx.fillText(`#${offset + 1}`, padL, h - 4);
  const lastLbl = `#${history.length}`;
  ctx.fillText(lastLbl, w - padR - ctx.measureText(lastLbl).width, h - 4);

  const area = ctx.createLinearGradient(0, padT, 0, padT + ph);
  area.addColorStop(0, 'rgba(79,209,197,.22)'); area.addColorStop(1, 'rgba(79,209,197,0)');
  ctx.fillStyle = area; ctx.beginPath(); ctx.moveTo(X(0), Y(0));
  win.forEach((e, i) => ctx.lineTo(X(i), Y(e.best)));
  ctx.lineTo(X(win.length - 1), Y(0)); ctx.closePath(); ctx.fill();

  const r = Math.max(1.4, Math.min(3, 400 / win.length));
  win.forEach((e, i) => {
    ctx.fillStyle = e.success ? '#f5c542' : 'rgba(124,141,181,.55)';
    ctx.beginPath(); ctx.arc(X(i), Y(e.fitness), e.success ? r + 0.6 : r, 0, Math.PI * 2); ctx.fill();
  });
  ctx.strokeStyle = '#4fd1c5'; ctx.lineWidth = 2; ctx.beginPath();
  win.forEach((e, i) => (i ? ctx.lineTo(X(i), Y(e.best)) : ctx.moveTo(X(i), Y(e.best))));
  ctx.stroke();

  ctx.strokeStyle = '#f472b6'; ctx.lineWidth = 1.5; ctx.beginPath();
  let acc = 0;
  const all = history;
  for (let i = 0; i < win.length; i++) {
    const gi = offset + i;
    acc = 0;
    const from = Math.max(0, gi - 19);
    for (let j = from; j <= gi; j++) acc += all[j].success ? 1 : 0;
    const rate = acc / (gi - from + 1);
    const y = padT + ph - rate * ph;
    i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y);
  }
  ctx.stroke();
}
