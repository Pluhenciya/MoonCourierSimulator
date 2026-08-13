/* Moon Courier Simulator — клиент (редизайн) */
"use strict";

const $ = (id) => document.getElementById(id);
const state = { selOrder: null, selRover: null, data: null, roverPrev: {}, hoverOrder: null, lastPollT: null, pollDt: 800 };
window.tutMap = null; // цель подсветки обучалки на карте: {kind:"base"|"order"|"rover", id?}

const STATUS = {
  idle: ["st-idle", "свободен"], delivering: ["st-busy", "в пути"],
  returning: ["st-busy", "возврат"], stranded: ["st-hard", "застрял"],
  maintenance: ["st-soft", "зарядка"],
};
const riskColor = (r) => (r < 0.2 ? "#34d399" : r < 0.5 ? "#fbbf24" : "#f87171");
const kg = (k) => (k >= 1000 ? (k / 1000).toFixed(1) + " т" : Math.round(k) + " кг");

// Иконки (Lucide, MIT): inline SVG, работают офлайн
const IC = {
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 4l14 8-14 8z"/></svg>',
  ff: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M4 5l8 7-8 7z"/><path d="M13 5l8 7-8 7z"/></svg>',
};

async function api(cmd, payload = {}) {
  try {
    const r = await fetch("/api/cmd", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd, payload }),
    });
    return await r.json();
  } catch { return { ok: false, error: "нет связи с сервером" }; }
}
async function poll() {
  try {
    if (state.data) {
      const t = performance.now();
      state.pollDt = state.lastPollT ? Math.min(2500, t - state.lastPollT) : 800;
      state.lastPollT = t;
      state.data.rovers.forEach((r) => {
        const j = r.journey;
        state.roverPrev[r.id] = { x: r.x, y: r.y, t, prog: j ? r.progress : 0, phase: j ? j.phase : null };
      });
    }
    state.data = await (await fetch("/api/state", { cache: "no-store" })).json();
    render();
  } catch { /* сервер не готов */ }
}

function render() {
  const d = state.data; if (!d) return;
  $("st-day").textContent = d.time.day + "/" + d.time.days_total;
  $("st-clock").textContent = d.time.clock;
  $("st-credits").textContent = d.credits + " $";
  $("st-rating").style.width = d.rating + "%";
  $("btn-pause").classList.toggle("on", d.time.paused);
  $("btn-ff").classList.toggle("on", d.time.ff);
  $("btn-play").classList.toggle("on", !d.time.paused && !d.time.ff);
  if (d.time.paused) $("st-clock").textContent = "⏸ " + d.time.clock;
  renderOrders(d); renderRovers(d); renderMission(d); renderLog(d); renderMap(d);
  tutTick(d);
  // звук по новым событиям журнала
  const evt = d.events && d.events[0];
  if (evt && evt.ts !== state.lastEvtTs) {
    const first = state.lastEvtTs === undefined;
    state.lastEvtTs = evt.ts;
    if (!first) SFX.byEvent(evt);
  }
  // иконка mute
  $("btn-sound").innerHTML = SFX.muted
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
  if (d.gameover) showGameOver(d);
}

/* -------- заказы -------- */
function imposs(d, o) {
  const cap = Math.max(...d.rovers.map((r) => r.cap_kg));
  if (o.weight_kg > cap) return "слишком тяжёлый";
  if (d.storms[o.zone_id]) return "зона под бурей";
  return null;
}
function renderOrders(d) {
  const list = $("orders-list");
  $("orders-count").textContent = d.orders.filter((o) => o.status === "available").length;
  list.innerHTML = "";
  for (const o of d.orders) {
    if (o.status !== "available") continue;
    const left = o.expires_at - d.time.minute_total;
    const im = imposs(d, o);
    const chip = im
      ? `<span class="chip i">✕ ${im}</span>`
      : left < 40
        ? `<span class="chip u">срочно · ${Math.ceil(left)}′</span>`
        : `<span class="chip t">${Math.ceil(left)}′</span>`;
    const el = document.createElement("div");
    el.className = "oc" + (state.selOrder === o.id ? " sel" : "") + (im ? " off" : "");
    el.innerHTML = `
      <div class="top"><span class="dest">${o.outpost_name}</span>${chip}</div>
      <div class="mid"><span class="w">${kg(o.weight_kg)}</span><span class="r">+${o.reward}$</span></div>
      <div class="risk"><i style="--dot:${riskColor(o.zone_risk)}"></i>риск ${Math.round(o.zone_risk * 100)}%</div>
      <div class="obar"><div style="width:${Math.max(0, Math.min(100, (left / o.urgent) * 100))}%"></div></div>`;
    el.addEventListener("click", () => { state.selOrder = o.id; state.hoverOrder = null; SFX.click(); renderOrders(d); renderMission(d); });
    el.addEventListener("mouseenter", () => { state.hoverOrder = o.id; renderMap(d); });
    el.addEventListener("mouseleave", () => { state.hoverOrder = null; renderMap(d); });
    list.appendChild(el);
  }
}

/* -------- роверы -------- */
function clickableRover(s) { return s === "idle" || s === "stranded" || s === "maintenance"; }
function renderRovers(d) {
  const list = $("rovers-list");
  list.innerHTML = "";
  for (const r of d.rovers) {
    const [cls, txt] = STATUS[r.status] || ["", r.status];
    const pct = Math.max(0, Math.min(100, Math.round((r.batt / r.batt_max) * 100)));
    const batC = pct > 50 ? "var(--good)" : pct > 25 ? "var(--warn)" : "var(--bad)";
    const clickable = clickableRover(r.status);
    const el = document.createElement("div");
    el.className = "rc" + (state.selRover === r.id ? " sel" : "") + (clickable ? " clickable" : " off");
    const statusChip = (r.batt < 15 && r.status === "idle")
      ? `<span class="st st-soft">разряжен</span>`
      : `<span class="st ${cls}">${txt}</span>`;
    const info = r.journey
      ? `<div class="triple"><span>маршрут</span><span>${r.phase_label}</span><b>${Math.round((r.progress || 0) * 50)}%</b></div>`
      : `<div class="triple"><span>доставок <b>${r.done}</b></span><span>заработано <b>${r.earned}$</b></span></div>`;
    el.innerHTML = `
      <div class="top"><span class="name">${r.name} <small>· ${r.model}</small></span>${statusChip}</div>
      <div class="bbar"><div style="width:${pct}%;background:${batC}"></div></div>
      <div class="spec"><span>🔋 <b>${Math.round(r.batt)}</b>/${r.batt_max}</span>
        <span>🧱 <b>${r.cap_kg}</b> кг</span><span>⚡ <b>${r.speed_kmh}</b> км/ч</span></div>
      ${info}`;
    if (clickable) el.addEventListener("click", () => { state.selRover = r.id; SFX.click(); renderRovers(d); renderMission(d); });
    list.appendChild(el);
  }
}

/* -------- миссия -------- */
function renderMission(d) {
  const box = $("mission-box");
  const o = d.orders.find((x) => x.id === state.selOrder);
  const r = d.rovers.find((x) => x.id === state.selRover);
  if (!o || !r) {
    box.innerHTML = `<div class="mt">Миссия</div><div class="hintMsg">Выберите заказ слева и ровер справа — здесь появится расчёт маршрута.</div>`;
    return;
  }
  const out = d.outposts[o.outpost];
  const km = Math.hypot(out.x - r.x, out.y - r.y) * 0.05;
  const stormy = d.storms[o.zone_id];
  const heavy = o.weight_kg > r.cap_kg;
  const estE = Math.ceil(km * 2 * 1.2 * 1.2);
  const lowBat = estE > r.batt;
  const block = stormy ? "зона заказчика под бурей"
    : heavy ? `вес ${kg(o.weight_kg)} превышает груз ${r.cap_kg} кг`
    : lowBat ? `на маршрут нужно ≈${estE} Вт·ч, есть ${Math.round(r.batt)}`
    : null;
  const timeM = Math.ceil((km / r.speed_kmh) * 60 * 2);
  box.innerHTML = `
    <div class="mt">${r.name} → ${o.outpost_name}</div>
    <div class="grid">
      <span>Груз</span><b>${kg(o.weight_kg)}</b>
      <span>Награда</span><b>+${o.reward}$</b>
      <span>Туда-обратно</span><b>≈${timeM}′ · ${estE} Вт·ч</b>
      <span>Срок</span><b>${Math.max(0, Math.ceil(o.expires_at - d.time.minute_total))}′</b>
    </div>
    <div id="ma">${actionsHtml(d, r, o, block)}</div>`;
  wireActions(d, r, o, block);
}
function actionsHtml(d, r, o, block) {
  if (r.status === "stranded") {
    const cost = Math.round(15 + Math.hypot(d.outposts[o.outpost].x - r.x, d.outposts[o.outpost].y - r.y) * 0.05 * 0.6);
    return `<button class="recover" data-a="recover">Эвакуировать ${r.name} · −${cost}$</button>`;
  }
  if (block) return `<div class="err">✕ Доставка невозможна: ${block}</div>`;
  const cost = Math.ceil((r.batt_max - r.batt) / 2);
  return `<button class="launch" data-a="launch">🚀 Запустить доставку</button>
    <button class="charge" data-a="charge">⚡ Быстрая зарядка · −${cost}$</button>`;
}
function wireActions(d, r, o, block) {
  const box = $("ma");
  if (!box) return;
  box.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      let res;
      if (btn.dataset.a === "launch") res = await api("launch", { order_id: o.id, rover_id: r.id });
      else if (btn.dataset.a === "charge") res = await api("rush_charge", { rover_id: r.id });
      else res = await api("recover", { rover_id: r.id });
      if (res && !res.ok && !box.dataset.err) {
        box.innerHTML = box.innerHTML + `<div class="err">${res.error}</div>`;
        box.dataset.err = "1";
      }
      if (res && res.ok) {
        if (btn.dataset.a === "launch") SFX.launch();
        else if (btn.dataset.a === "charge") SFX.buy();
        else SFX.click();
        state.selOrder = null; state.selRover = null;
      }
      poll();
    });
  });
}

/* -------- журнал -------- */
let logKey = "";
function renderLog(d) {
  const k = d.events.slice(0, 12).map((e) => e.minute + "|" + e.text).join("\n");
  if (k === logKey) return;   // не перерисовываем, если лог не менялся (против «моргания»)
  logKey = k;
  const box = $("log");
  box.innerHTML = "";
  const cls = { delivery: "ok", hazard: "alert", storm: "alert", mission: "miss" };
  d.events.slice(0, 12).forEach((e) => {
    const div = document.createElement("div");
    div.className = "ev " + (cls[e.kind] || "");
    div.innerHTML = `<span class="c">Д${Math.floor(e.minute / 1440) + 1} ${e.clock}</span>${e.text}`;
    box.appendChild(div);
  });
  box.scrollTop = 0;
}

/* -------- карта -------- */
let stars = [], bgCanvas = null, bgKey = "";
function initStars(W, H) {
  if (stars.length) return;
  for (let i = 0; i < 90; i++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.3, a: Math.random() * 0.5 + 0.25 });
  stars.size = { W, H };
}
function buildBg(d, W, H) {
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const cx = cv.getContext("2d");

  // глубокий космос
  const space = cx.createLinearGradient(0, 0, 0, H);
  space.addColorStop(0, "#04060c");
  space.addColorStop(0.55, "#070b16");
  space.addColorStop(1, "#04060c");
  cx.fillStyle = space; cx.fillRect(0, 0, W, H);

  // звёзды
  stars.forEach((s) => { cx.globalAlpha = s.a; cx.fillStyle = "#cdd9ef"; cx.beginPath(); cx.arc(s.x * W, s.y * H, s.r, 0, 7); cx.fill(); });
  cx.globalAlpha = 1;

  const S = Math.min(W / 1000, H / 700);
  const ox = (W - 1000 * S) / 2, oy = (H - 700 * S) / 2;
  const px2 = (x) => x * S + ox, py2 = (y) => y * S + oy;

  // поверхность Луны: светлый реголит
  const surf = cx.createRadialGradient(W * 0.5, H * 0.45, 60, W * 0.5, H * 0.45, Math.max(W, H) * 0.75);
  surf.addColorStop(0, "#aeb9c9");
  surf.addColorStop(0.5, "#8b97ab");
  surf.addColorStop(0.85, "#6d7a8f");
  surf.addColorStop(1, "#5c687c");
  cx.fillStyle = surf; cx.fillRect(0, 0, W, H);

  // лунные моря — большие тёмно-серые пятна (мягкие)
  const seas = [[0.28, 0.32, 0.22], [0.68, 0.25, 0.18], [0.78, 0.62, 0.25], [0.35, 0.72, 0.17], [0.55, 0.45, 0.12]];
  seas.forEach(([sx, sy, sr]) => {
    const g = cx.createRadialGradient(W * sx, H * sy, 5, W * sx, H * sy, H * sr);
    g.addColorStop(0, "rgba(58,66,84,.5)");
    g.addColorStop(1, "rgba(58,66,84,0)");
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
  });

  // лунный свет (блик сверху слева)
  const light = cx.createRadialGradient(W * 0.3, H * 0.2, 20, W * 0.3, H * 0.2, W * 0.9);
  light.addColorStop(0, "rgba(255,255,255,.16)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  cx.fillStyle = light; cx.fillRect(0, 0, W, H);

  // кратеры: светлая кромка (верх слева) + тёмная тень (низ справа)
  const crater = (cxp, cyp, cr) => {
    // внешний вал
    cx.beginPath(); cx.arc(cxp, cyp, cr, 0, 7);
    cx.fillStyle = "rgba(74,84,102,.5)"; cx.fill();
    // дно кратера
    cx.beginPath(); cx.arc(cxp, cyp, cr * 0.8, 0, 7);
    cx.fillStyle = "rgba(112,122,140,.75)"; cx.fill();
    // внутренняя тень
    cx.beginPath(); cx.arc(cxp, cyp, cr * 0.62, 0, 7);
    cx.fillStyle = "rgba(56,66,84,.6)"; cx.fill();
    // светлая кромка (верх слева)
    cx.lineWidth = Math.max(1.4, cr * 0.18);
    cx.beginPath(); cx.arc(cxp, cyp, cr * 0.9, Math.PI * 1.05, Math.PI * 1.95);
    cx.strokeStyle = "rgba(235,242,250,.65)"; cx.stroke();
    // тёмная кромка (низ справа)
    cx.beginPath(); cx.arc(cxp, cyp, cr * 0.9, Math.PI * 1.95, Math.PI * 3.05);
    cx.strokeStyle = "rgba(38,46,62,.55)"; cx.stroke();
  };
  (d.craters || []).forEach(([a, b, c]) => crater(px2(a), py2(b), c * S));

  // слабое виньетирование
  const vin = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  vin.addColorStop(0, "rgba(0,0,0,0)");
  vin.addColorStop(1, "rgba(10,16,28,.35)");
  cx.fillStyle = vin; cx.fillRect(0, 0, W, H);

  drawBase(cx, px2(d.outposts.base.x), py2(d.outposts.base.y), S);
  return cv;
}
function renderMap(d) {
  const canvas = $("map");
  const W = canvas.parentElement.clientWidth, H = canvas.parentElement.clientHeight;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  initStars(W, H);
  const key = W + "x" + H + "|" + (d.craters ? d.craters.length + ":" + d.craters[0].join(",") : "");
  if (!bgCanvas || bgKey !== key) { bgCanvas = buildBg(d, W, H); bgKey = key; }
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bgCanvas, 0, 0);
  const S = Math.min(W / 1000, H / 700);
  const ox = (W - 1000 * S) / 2, oy = (H - 700 * S) / 2;
  const px = (x) => x * S + ox, py = (y) => y * S + oy;
  const hour = Math.floor(d.time.minute_total) % 1440;
  const night = hour < 360 || hour >= 1200;

  // зоны
  const stormGlow = (Math.sin(performance.now() / 300) + 1) / 2;
  d.zone_order.forEach((zid) => {
    const z = d.zones[zid];
    const storm = d.storms[zid];
    ctx.beginPath();
    z.poly.forEach(([x, y], i) => i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)));
    ctx.closePath();
    ctx.fillStyle = storm ? "rgba(248,113,113," + (0.06 + stormGlow * 0.08) + ")" : "rgba(148,163,184,.045)";
    ctx.fill();
    ctx.strokeStyle = storm ? "rgba(248,113,113," + (0.55 + stormGlow * 0.4) + ")" : riskColor(z.risk) + "55";
    ctx.lineWidth = 1;
    ctx.setLineDash(storm ? [5, 5] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    const cx = px(z.poly.reduce((a, p) => a + p[0], 0) / z.poly.length);
    const cy = py(z.poly.reduce((a, p) => a + p[1], 0) / z.poly.length);
    ctx.fillStyle = storm ? "rgba(248,113,113,.9)" : "rgba(222,232,246,.4)";
    ctx.font = "600 11px Exo 2, Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(z.name + (storm ? " · буря" : ""), cx, cy);
  });

  // заказы: точки распределяются по кольцу вокруг форпоста, чтобы не накладываться
  const selO = d.orders.find((x) => x.id === state.selOrder);
  const orderPos = {};
  const byOut = {};
  d.orders.forEach((o) => { if (o.status === "available") (byOut[o.outpost] = byOut[o.outpost] || []).push(o); });
  for (const op in byOut) {
    const list = byOut[op], out = d.outposts[op];
    list.forEach((o, i) => {
      const n = list.length, ang = -Math.PI / 2 + (i * Math.PI * 2) / n;
      const r = 20 + (n > 6 ? 14 : 0);
      orderPos[o.id] = { x: out.x + Math.cos(ang) * r, y: out.y + Math.sin(ang) * r };
    });
  }
  d.orders.forEach((o) => {
    if (o.status !== "available") return;
    const p = orderPos[o.id] || { x: d.outposts[o.outpost].x, y: d.outposts[o.outpost].y };
    const ex = px(p.x), ey = py(p.y);
    const im = imposs(d, o);
    ctx.beginPath(); ctx.arc(ex, ey, (selO && selO.id === o.id ? 7 : 5) * S, 0, 7);
    ctx.fillStyle = im ? "#fbbf24" : "#e6edf7";
    ctx.fill();
    ctx.strokeStyle = im ? "rgba(251,191,36,.7)" : riskColor(o.zone_risk) + "aa";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = "10px Exo 2, Segoe UI";
    ctx.fillStyle = "rgba(230,237,247,.8)";
    ctx.fillText(kg(o.weight_kg), ex, ey - 8 * S);
    if (selO && selO.id === o.id) {
      ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(ex, ey, 11 * S, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    // наведение на заказ — подсветка пункта доставки (надпись над точкой)
    if (state.hoverOrder && state.hoverOrder === o.id) {
      ctx.font = "700 11px Exo 2, Segoe UI";
      ctx.fillStyle = "#38bdf8"; ctx.textAlign = "center";
      ctx.fillText("▲ доставить сюда", ex, ey - 20 * S);
      const hpx = px(d.outposts.base.x), hpy = py(d.outposts.base.y);
      ctx.beginPath(); ctx.moveTo(hpx, hpy); ctx.lineTo(ex, ey);
      ctx.strokeStyle = "rgba(56,189,248,.45)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(ex, ey, 15 * S, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = .25; ctx.beginPath(); ctx.arc(ex, ey, 15 * S, 0, 7); ctx.fillStyle = "#38bdf8";
      ctx.fill(); ctx.globalAlpha = 1;
    }
  });

  // точка на ломаной пути по доле длины (как на сервере)
function pointAlongPath(path, frac) {
  if (!path || !path.length) return null;
  let L = 0;
  const seg = [];
  for (let i = 1; i < path.length; i++) {
    const l = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    seg.push(l); L += l;
  }
  if (L <= 0) return { x: path[0][0], y: path[0][1] };
  let target = Math.max(0, Math.min(1, frac)) * L;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const f = seg[i] === 0 ? 0 : target / seg[i];
      return { x: path[i][0] + (path[i + 1][0] - path[i][0]) * f, y: path[i][1] + (path[i + 1][1] - path[i][1]) * f };
    }
    target -= seg[i];
  }
  return { x: path[path.length - 1][0], y: path[path.length - 1][1] };
}

  // роверы (плавная интерполяция вдоль маршрута между поллингами)
  const selR = d.rovers.find((x) => x.id === state.selRover);
  const nowMs = performance.now();
  d.rovers.forEach((r) => {
    const pv = state.roverPrev[r.id];
    const j = r.journey;
    const phaseChanged = pv && pv.phase !== null && j && pv.phase !== j.phase;
    const stopped = pv && pv.phase === null && !j;
    const progBack = pv && j && r.progress < pv.prog - 0.03;
    const teleport = !pv || Math.hypot(r.x - pv.x, r.y - pv.y) > 250 || phaseChanged || progBack;
    let rx, ry;
    if (j && r.path && r.path.length > 1 && pv && !teleport && !stopped) {
      const a = Math.min(1, Math.max(0, (nowMs - pv.t) / state.pollDt));
      const prog = pv.prog + (r.progress - pv.prog) * a;
      const frac = j.phase === "returning" ? 1 - prog : prog;
      const pt = pointAlongPath(r.path, frac);
      rx = px(pt.x); ry = py(pt.y);
    } else {
      rx = px(r.x); ry = py(r.y);
    }
    if (r.journey) {
      const oo = d.outposts[r.journey.outpost];
      ctx.strokeStyle = "rgba(56,189,248,.18)"; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      if (r.path && r.path.length > 1) {
        ctx.moveTo(px(r.path[0][0]), py(r.path[0][1]));
        for (let i = 1; i < r.path.length; i++) ctx.lineTo(px(r.path[i][0]), py(r.path[i][1]));
      } else {
        ctx.moveTo(px(oo.x), py(oo.y)); ctx.lineTo(rx, ry);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    const inSel = selR && selR.id === r.id;
    ctx.beginPath(); ctx.arc(rx, ry, (inSel ? 8.5 : 6.5) * S, 0, 7);
    ctx.fillStyle = "#0e1626"; ctx.fill();
    ctx.strokeStyle = r.status === "stranded" ? "#f87171" : r.status === "idle" ? "#34d399" : "#38bdf8";
    ctx.lineWidth = 2; ctx.stroke();
    if (r.status === "stranded") { ctx.font = "12px Exo 2, Segoe UI"; ctx.fillStyle = "#f87171"; ctx.textAlign = "center"; ctx.fillText("✗", rx, ry + 4 * S); }
    const bp = Math.round((r.batt / r.batt_max) * 100);
    ctx.beginPath(); ctx.arc(rx, ry, 13 * S, -Math.PI / 2, -Math.PI / 2 + (bp / 100) * Math.PI * 2);
    ctx.strokeStyle = bp > 50 ? "#34d399" : bp > 25 ? "#fbbf24" : "#f87171";
    ctx.lineWidth = 2.5; ctx.stroke();
    ctx.font = "600 10px Exo 2, Segoe UI"; ctx.fillStyle = "#e6edf7"; ctx.textAlign = "center";
    ctx.fillText(r.name, rx, ry + 20 * S);
  });

  if (night) { ctx.fillStyle = "rgba(10,20,45,.16)"; ctx.fillRect(0, 0, W, H); }

  // подсветка цели обучалки на карте
  if (window.tutMap) {
    const tm = window.tutMap;
    let tx = null, ty = null;
    if (tm.kind === "base") { tx = d.outposts.base.x; ty = d.outposts.base.y; }
    else if (tm.kind === "order") {
      const o = d.orders.find((x) => x.id === tm.id);
      if (o && d.outposts[o.outpost]) { tx = d.outposts[o.outpost].x; ty = d.outposts[o.outpost].y; }
    } else if (tm.kind === "rover") {
      const r = d.rovers.find((x) => x.id === tm.id);
      if (r) { tx = r.x; ty = r.y; }
    }
    if (tx != null) {
      const t = performance.now() / 1000;
      const R = (14 + Math.sin(t * 4)) * S;
      const gx = px(tx), gy = py(ty);
      window.tutMapScreen = { x: gx + canvas.getBoundingClientRect().left, y: gy + canvas.getBoundingClientRect().top };
      ctx.beginPath(); ctx.arc(gx, gy, R, 0, 7);
      ctx.strokeStyle = "rgba(56,189,248,.85)"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(gx, gy, R + 5, 0, 7);
      ctx.strokeStyle = "rgba(56,189,248,.25)"; ctx.lineWidth = 6; ctx.stroke();
      ctx.font = "700 13px Exo 2, Segoe UI"; ctx.fillStyle = "#38bdf8"; ctx.textAlign = "center";
      ctx.fillText("▶", gx, gy - R - 8 * S);
    }
  }
}
function drawBase(ctx, x, y, S) {
  ctx.beginPath(); ctx.arc(x, y, 8 * S, 0, 7);
  ctx.fillStyle = "#38bdf8"; ctx.globalAlpha = .9; ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = "#e6edf7"; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = "700 11px Exo 2, Segoe UI"; ctx.fillStyle = "#38bdf8"; ctx.textAlign = "center";
  ctx.fillText("База", x, y - 12 * S);
}

/* -------- правила и финал -------- */
const RULES = `
  <h2>🌙 Moon Courier — правила</h2>
  <p>Вы — диспетчер лунной базы. Выживите <b>7 дней</b>, не уронив рейтинг до 0, и заработайте максимум долларов.</p>
  <h3>Как играть</h3>
  <ul>
    <li>Выберите заказ и ровер, нажмите <b>🚀 Запустить</b>.</li>
    <li>Вес, батарея и риск маршрута проверяются автоматически.</li>
  </ul>
  <h3>Логика</h3>
  <ul>
    <li><b>Вес</b>: груз > грузоподъёмности — доставка невозможна; тяжёлый груз тратит больше энергии.</li>
    <li><b>Батарея</b>: нужна на путь туда и обратно. Зарядка только на базе; есть платная быстрая.</li>
    <li><b>Риск зоны</b>: выше — чаще аварии (пыль, ЭМИ, поломки, застревание).</li>
    <li><b>Буря</b>: перекрывает зону — туда нельзя, пока не пройдёт.</li>
  </ul>
  <h3>Очки</h3>
  <ul>
    <li>Вовремя — полная награда (+2 рейтинга). Опоздание — половина (−4).</li>
    <li>Просрочка и застрявший ровер — минусы к рейтингу.</li>
    <li>Финал 7-го дня: счёт = доллары + рейтинг × 30.</li>
  </ul>`;
function showHelp() { showModal(RULES + `<button onclick="hideModal()">Понятно 🚀</button>`); }

function showGameOver(d) {
  if (!$("overlay").classList.contains("hidden")) return;
  const ok = d.gameover_reason === "success";
  const name = localStorage.getItem("mcs_name") || "";
  $("modal").innerHTML = `
    <h2>${ok ? "🏆 База выстояла 7 дней!" : "💀 База закрыта"}</h2>
    <div class="end-msg">${ok ? "Превосходная работа, диспетчер." : d.gameover_reason}</div>
    <div class="score">
      <div class="sc"><b class="good">${d.credits}</b><span>долларов</span></div>
      <div class="sc"><b class="${ok ? "good" : "warn"}">${d.rating}</b><span>рейтинг</span></div>
      <div class="sc"><b>${d.deliveries.length}</b><span>доставок</span></div>
      <div class="sc"><b>${d.credits + d.rating * 30}</b><span>итог</span></div>
    </div>
    <label class="menu-lab">Твоё имя для таблицы лидеров
      <input id="go-name" maxlength="16" placeholder="Диспетчер" value="${name}"/>
    </label>
    <div class="menu-row">
      <button class="menu-btn sm" id="go-save" onclick="saveScore()">💾 В таблицу лидеров</button>
      <button class="menu-btn sm ghost" onclick="hideModal();api('reset').then(poll)">Новая игра</button>
    </div>
    <div id="go-table" hidden></div>`;
  $("overlay").classList.remove("hidden");
}
function saveScore() {
  const name = ($("go-name").value.trim() || "Диспетчер").slice(0, 16);
  localStorage.setItem("mcs_name", name);
  leaderSave(name);
  $("go-table").hidden = false;
  $("go-table").innerHTML = `<div class="menu-title">Таблица лидеров</div>` + leaderTableHtml();
  const btn = $("go-save");
  btn.disabled = true;
  btn.textContent = "Результат записан ✓";
}
function showModal(html) { $("modal").innerHTML = html; $("overlay").classList.remove("hidden"); }
function hideModal() { $("overlay").classList.add("hidden"); }

/* -------- таблица лидеров -------- */
const MENU_STORAGE = "mcs_scores";
function leaderSave(name) {
  try {
    const d = state.data;
    const score = d.credits + d.rating * 30;
    const list = JSON.parse(localStorage.getItem(MENU_STORAGE) || "[]");
    list.push({ name, score, rating: d.rating, done: d.total_done, day: d.time.day, ts: Date.now() });
    list.sort((a, b) => b.score - a.score);
    localStorage.setItem(MENU_STORAGE, JSON.stringify(list.slice(0, 10)));
  } catch { /* localStorage недоступен */ }
}
function leaderTableHtml() {
  try {
    const list = JSON.parse(localStorage.getItem(MENU_STORAGE) || "[]");
    if (!list.length) return `<div class="menu-empty">Пока нет результатов. Заверши партию — и появишься здесь!</div>`;
    return `<table class="scores"><tr><th>#</th><th>Пилот</th><th>Итог</th><th>Рейтинг</th><th>Доставок</th></tr>` +
      list.map((e, i) => `<tr><td>${i + 1}</td><td>${e.name}</td><td><b>${e.score}$</b></td><td>${e.rating}</td><td>${e.done}</td></tr>`).join("") +
      `</table>`;
  } catch { return `<div class="menu-empty">—</div>`; }
}
function showLeaders() {
  showModal(`<h2>🏆 Таблица лидеров</h2>${leaderTableHtml()}<button onclick="hideModal()">Закрыть</button>`);
}

/* -------- звук и музыка (Web Audio, синтез без файлов) -------- */
const SFX = {
  ctx: null, master: null,
  muted: localStorage.getItem("mcs_muted") === "1",
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  },
  tone(freq, dur, type, vol, when = 0, slide = 0) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, vol, cutoff = 600) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  },
  click() { this.tone(760, 0.05, "square", 0.1); },
  orders() { this.tone(520, 0.06, "sine", 0.14); this.tone(690, 0.07, "sine", 0.14, 0.08); },
  launch() { this.tone(170, 0.55, "sawtooth", 0.16, 0, 240); this.tone(340, 0.3, "square", 0.08, 0.1, 160); this.noise(0.35, 0.05, 900); },
  arrive() { this.tone(523, 0.13, "sine", 0.25); this.tone(659, 0.13, "sine", 0.25, 0.11); this.tone(784, 0.24, "sine", 0.25, 0.22); },
  late() { this.tone(330, 0.22, "triangle", 0.2); this.tone(233, 0.3, "triangle", 0.2, 0.2); },
  hazard() { this.noise(0.4, 0.22, 800); this.tone(120, 0.35, "sawtooth", 0.14, 0, -40); },
  storm() { this.noise(0.7, 0.2, 500); this.tone(70, 0.8, "sine", 0.2, 0, -20); },
  buy() { this.tone(880, 0.09, "sine", 0.2); this.tone(1318, 0.22, "sine", 0.2, 0.08); },
  day() { this.tone(440, 0.12, "sine", 0.18); this.tone(660, 0.18, "sine", 0.18, 0.13); },
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.28, "triangle", 0.22, i * 0.16)); },
  lose() { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.32, "triangle", 0.2, i * 0.22)); },
  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem("mcs_muted", this.muted ? "1" : "0");
    if (this.muted) MUSIC.stop(); else MUSIC.start();
    return this.muted;
  },
  // звук по событию из журнала
  byEvent(e) {
    if (e.kind === "delivery") (e.text.includes("опозд") ? SFX.late() : SFX.arrive());
    else if (e.kind === "storm") SFX.storm();
    else if (e.kind === "hazard") SFX.hazard();
    else if (e.kind === "orders") SFX.orders();
    else if (e.kind === "day") SFX.day();
    else if (e.kind === "game") (e.text.includes("устояла") ? SFX.win() : SFX.lose());
  },
};
// фоновая музыка — медленный лунный цикл (бас + пентатоника)
const MUSIC = {
  bass: [110, 110, 130.8, 98, 110, 110, 87.3, 98],
  arp: [220, 261.6, 293.7, 329.6, 293.7, 261.6, 220, 196, 220, 261.6, 293.7, 329.6, 440, 329.6, 293.7, 261.6],
  step: 0, timer: null,
  start() {
    if (this.timer || SFX.muted) return;
    this.step = 0;
    this.timer = setInterval(() => {
      if (SFX.muted || !SFX.ctx) return;
      const i = this.step;
      SFX.tone(this.bass[i % 8], 1.1, "sine", 0.09, 0.05);
      SFX.tone(this.arp[i % 16], 0.42, "triangle", 0.045, 0.11);
      this.step++;
    }, 450);
  },
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } },
};
window.addEventListener("pointerdown", () => { SFX.ensure(); MUSIC.start(); }, { once: true });
// три кнопки времени: обычная скорость / пауза / ускорение ×5
$("btn-play").addEventListener("click", async () => {
  SFX.click();
  await api("fast_forward", { on: false });
  await api("pause", { on: false });
  poll();
});
$("btn-ff").addEventListener("click", async () => {
  SFX.click();
  await api("pause", { on: false });
  await api("fast_forward", { on: true });
  poll();
});
$("btn-pause").addEventListener("click", async () => {
  SFX.click();
  await api("pause", { on: true });
  poll();
});
$("btn-sound").addEventListener("click", () => { if (SFX.ctx && !SFX.muted) SFX.click(); SFX.toggleMute(); render(); });
$("btn-reset").addEventListener("click", async () => {
  SFX.click();
  if (confirm("Начать заново?")) { await api("reset"); poll(); }
});

$("btn-leaders").addEventListener("click", () => { SFX.click(); showLeaders(); });
poll();
setInterval(poll, 800);

// плавная анимация карты между поллингами
let lastRaf = 0;
function rafLoop(ts) {
  requestAnimationFrame(rafLoop);
  if (!state.data || document.hidden) return;
  if (ts - lastRaf < 30) return; // ~33 fps, плавное движение роверов
  lastRaf = ts;
  renderMap(state.data);
}
requestAnimationFrame(rafLoop);