/* Moon Courier Simulator — клиент (редизайн) */
"use strict";

const $ = (id) => document.getElementById(id);
const state = { selOrder: null, selRover: null, data: null, roverPrev: {}, hoverOrder: null };
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
      state.data.rovers.forEach((r) => { state.roverPrev[r.id] = { x: r.x, y: r.y, t }; });
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
  $("btn-play").innerHTML = d.time.paused ? IC.play : d.time.ff ? IC.ff + IC.ff : IC.pause;
  $("btn-play").classList.toggle("on", d.time.paused);
  $("btn-play").title = d.time.paused ? "Продолжить" : d.time.ff ? "Пауза" : "Ускорение (×5)";
  if (d.time.paused) $("st-clock").textContent = "⏸ " + d.time.clock;
  renderOrders(d); renderRovers(d); renderMission(d); renderLog(d); renderMap(d);
  tutTick(d);
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
    el.addEventListener("click", () => { state.selOrder = o.id; state.hoverOrder = null; renderOrders(d); renderMission(d); });
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
    if (clickable) el.addEventListener("click", () => { state.selRover = r.id; renderRovers(d); renderMission(d); });
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
      if (res && res.ok) { state.selOrder = null; state.selRover = null; }
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

  // роверы (плавная интерполяция между поллингами)
  const selR = d.rovers.find((x) => x.id === state.selRover);
  const nowMs = performance.now();
  d.rovers.forEach((r) => {
    const pv = state.roverPrev[r.id];
    const dx = r.x - (pv ? pv.x : r.x), dy = r.y - (pv ? pv.y : r.y);
    const teleport = !pv || Math.hypot(dx, dy) > 250;
    const a = teleport || !pv ? 1 : Math.min(1, (nowMs - pv.t) / 800);
    const rx = px(pv && !teleport ? pv.x + dx * a : r.x);
    const ry = py(pv && !teleport ? pv.y + dy * a : r.y);
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
  leaderSave(d);
  const ok = d.gameover_reason === "success";
  $("modal").innerHTML = `
    <h2>${ok ? "🏆 База выстояла 7 дней!" : "💀 База закрыта"}</h2>
    <div class="end-msg">${ok ? "Превосходная работа, диспетчер." : d.gameover_reason}</div>
    <div class="score">
      <div class="sc"><b class="good">${d.credits}</b><span>долларов</span></div>
      <div class="sc"><b class="${ok ? "good" : "warn"}">${d.rating}</b><span>рейтинг</span></div>
      <div class="sc"><b>${d.deliveries.length}</b><span>доставок</span></div>
      <div class="sc"><b>${d.credits + d.rating * 30}</b><span>итог</span></div>
    </div>
    <button onclick="hideModal();api('reset').then(poll)">Новая игра</button>`;
  $("overlay").classList.remove("hidden");
}
function showModal(html) { $("modal").innerHTML = html; $("overlay").classList.remove("hidden"); }
function hideModal() { $("overlay").classList.add("hidden"); }

/* -------- главное меню / настройки / лидеры -------- */
const MENU_STORAGE = "mcs_scores";
function menuShow() { $("menu").classList.remove("hidden"); api("pause", { on: true }); }
function menuHide() { $("menu").classList.add("hidden"); api("pause", { on: false }); }
function menuScreen(which) {
  ["menu-screen", "menu-settings-screen", "menu-scores-screen"].forEach((id) => $(id).classList.toggle("hidden", id !== which));
}
function leaderSave(d) {
  try {
    const name = (localStorage.getItem("mcs_name") || "Диспетчер").trim() || "Диспетчер";
    const score = d.credits + d.rating * 30;
    const list = JSON.parse(localStorage.getItem(MENU_STORAGE) || "[]");
    list.push({ name, score, rating: d.rating, done: d.total_done, day: d.time.day, ts: Date.now() });
    list.sort((a, b) => b.score - a.score);
    localStorage.setItem(MENU_STORAGE, JSON.stringify(list.slice(0, 10)));
  } catch { /* localStorage недоступен */ }
}
function leaderRender() {
  const box = $("menu-scores-list");
  try {
    const list = JSON.parse(localStorage.getItem(MENU_STORAGE) || "[]");
    if (!list.length) { box.innerHTML = `<div class="menu-empty">Пока нет результатов. Заверши партию — и появишься здесь!</div>`; return; }
    box.innerHTML = `<table class="scores"><tr><th>#</th><th>Пилот</th><th>Итог</th><th>Рейтинг</th><th>Доставок</th></tr>` +
      list.map((e, i) => `<tr><td>${i + 1}</td><td>${e.name}</td><td><b>${e.score}$</b></td><td>${e.rating}</td><td>${e.done}</td></tr>`).join("") +
      `</table>`;
  } catch { box.innerHTML = `<div class="menu-empty">—</div>`; }
}
function initMenu() {
  $("menu-play").addEventListener("click", () => {
    const s = $("menu-name").value.trim();
    if (s) localStorage.setItem("mcs_name", s);
    menuHide(); poll();
  });
  $("menu-settings").addEventListener("click", () => {
    $("menu-name").value = localStorage.getItem("mcs_name") || "";
    menuScreen("menu-settings-screen");
  });
  $("menu-settings-ok").addEventListener("click", () => {
    const s = $("menu-name").value.trim();
    if (s) localStorage.setItem("mcs_name", s);
    menuScreen("menu-screen");
  });
  $("menu-settings-back").addEventListener("click", () => menuScreen("menu-screen"));
  $("menu-scores").addEventListener("click", () => { leaderRender(); menuScreen("menu-scores-screen"); });
  $("menu-scores-back").addEventListener("click", () => menuScreen("menu-screen"));
  menuShow();
}

/* -------- кнопки -------- */
// одна кнопка: игра → ×5 → пауза → игра (в прежнем режиме)
$("btn-play").addEventListener("click", async () => {
  const t = state.data.time;
  if (t.paused) await api("pause", { on: false });
  else if (t.ff) await api("pause", { on: true });
  else await api("fast_forward", { on: true });
  poll();
});
$("btn-reset").addEventListener("click", async () => {
  if (confirm("Начать заново?")) { await api("reset"); poll(); }
});

initMenu();
poll();
setInterval(poll, 800);

// плавная анимация карты между поллингами
let lastRaf = 0;
function rafLoop(ts) {
  requestAnimationFrame(rafLoop);
  if (!state.data || document.hidden) return;
  if (ts - lastRaf < 40) return; // ~25 fps достаточно
  lastRaf = ts;
  renderMap(state.data);
}
requestAnimationFrame(rafLoop);