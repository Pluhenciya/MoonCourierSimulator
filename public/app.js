/* Moon Courier Simulator — клиент (редизайн) */
"use strict";

const $ = (id) => document.getElementById(id);
const state = { selOrder: null, selRover: null, data: null, roverPrev: {} };
window.tutMap = null; // цель подсветки обучалки на карте: {kind:"base"|"order"|"rover", id?}

const STATUS = {
  idle: ["st-idle", "свободен"], delivering: ["st-busy", "в пути"],
  returning: ["st-busy", "возврат"], stranded: ["st-hard", "застрял"],
  maintenance: ["st-soft", "зарядка"],
};
const riskColor = (r) => (r < 0.2 ? "#34d399" : r < 0.5 ? "#fbbf24" : "#f87171");
const kg = (k) => (k >= 1000 ? (k / 1000).toFixed(1) + " т" : Math.round(k) + " кг");

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
  $("st-credits").textContent = d.credits + " ₵";
  $("st-rating").style.width = d.rating + "%";
  $("btn-ff").textContent = d.time.ff ? "⏩⏩" : "⏩";
  $("btn-pause").textContent = d.time.paused ? "▶" : "⏸";
  $("btn-pause").classList.toggle("on", d.time.paused);
  $("btn-ff").disabled = d.time.paused;
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
      <div class="mid"><span class="w">${kg(o.weight_kg)}</span><span class="r">+${o.reward}₵</span></div>
      <div class="risk"><i style="--dot:${riskColor(o.zone_risk)}"></i>риск ${Math.round(o.zone_risk * 100)}%</div>
      <div class="obar"><div style="width:${Math.max(0, Math.min(100, (left / o.urgent) * 100))}%"></div></div>`;
    el.addEventListener("click", () => { state.selOrder = o.id; renderOrders(d); renderMission(d); });
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
      : `<div class="triple"><span>доставок <b>${r.done}</b></span><span>заработано <b>${r.earned}₵</b></span></div>`;
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
      <span>Награда</span><b>+${o.reward}₵</b>
      <span>Туда-обратно</span><b>≈${timeM}′ · ${estE} Вт·ч</b>
      <span>Срок</span><b>${Math.max(0, Math.ceil(o.expires_at - d.time.minute_total))}′</b>
    </div>
    <div id="ma">${actionsHtml(d, r, o, block)}</div>`;
  wireActions(d, r, o, block);
}
function actionsHtml(d, r, o, block) {
  if (r.status === "stranded") {
    const cost = Math.round(15 + Math.hypot(d.outposts[o.outpost].x - r.x, d.outposts[o.outpost].y - r.y) * 0.05 * 0.6);
    return `<button class="recover" data-a="recover">Эвакуировать ${r.name} · −${cost}₵</button>`;
  }
  if (block) return `<div class="err">✕ Доставка невозможна: ${block}</div>`;
  const cost = Math.ceil((r.batt_max - r.batt) / 2);
  return `<button class="launch" data-a="launch">🚀 Запустить доставку</button>
    <button class="charge" data-a="charge">⚡ Быстрая зарядка · −${cost}₵</button>`;
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
function renderLog(d) {
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

  // поверхность Луны: мягкий рельеф
  const surf = cx.createRadialGradient(W * 0.5, H * 0.42, 60, W * 0.5, H * 0.42, Math.max(W, H) * 0.75);
  surf.addColorStop(0, "#2a3856");
  surf.addColorStop(0.55, "#1a2438");
  surf.addColorStop(1, "#0b1120");
  cx.fillStyle = surf; cx.fillRect(0, 0, W, H);

  // лунные моря — большие тёмные пятна
  const seas = [[0.28, 0.32, 0.22], [0.68, 0.25, 0.18], [0.78, 0.62, 0.25], [0.35, 0.72, 0.17], [0.55, 0.45, 0.12]];
  seas.forEach(([sx, sy, sr]) => {
    const g = cx.createRadialGradient(W * sx, H * sy, 5, W * sx, H * sy, H * sr);
    g.addColorStop(0, "rgba(8,14,28,.55)");
    g.addColorStop(1, "rgba(8,14,28,0)");
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
  });

  // лунный свет (блик сверху слева)
  const light = cx.createRadialGradient(W * 0.3, H * 0.2, 20, W * 0.3, H * 0.2, W * 0.9);
  light.addColorStop(0, "rgba(190,210,240,.10)");
  light.addColorStop(1, "rgba(190,210,240,0)");
  cx.fillStyle = light; cx.fillRect(0, 0, W, H);

  // кратеры: тень (дно) + светлая кромка со стороны света (верх слева)
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const crater = (cxp, cyp, cr) => {
    cx.beginPath(); cx.arc(cxp, cyp, cr, 0, 7);
    cx.fillStyle = "rgba(6,11,22,.42)"; cx.fill();
    cx.beginPath(); cx.arc(cxp, cyp, cr * 0.82, 0, 7);
    cx.fillStyle = "rgba(3,6,14,.35)"; cx.fill();
    cx.lineWidth = Math.max(1.2, cr * 0.16);
    cx.beginPath(); cx.arc(cxp, cyp, cr * 0.9, Math.PI, Math.PI * 1.5); // тёмная кромка (низ справа)
    cx.strokeStyle = "rgba(4,8,18,.5)"; cx.stroke();
    cx.beginPath(); cx.arc(cxp, cyp, cr * 0.94, Math.PI * 1.5, Math.PI * 2.05); // светлая кромка (верх слева)
    cx.strokeStyle = "rgba(190,210,240,.22)"; cx.stroke();
  };
  const craters = [
    [100, 110, 30], [250, 90, 16], [400, 60, 42], [620, 100, 22], [800, 70, 34],
    [930, 140, 18], [60, 260, 20], [300, 240, 12], [520, 200, 28], [730, 230, 15],
    [880, 300, 40], [140, 400, 26], [330, 380, 34], [560, 360, 14], [690, 420, 30],
    [860, 500, 20], [240, 540, 40], [450, 520, 24], [620, 560, 16], [780, 590, 30],
    [120, 620, 14], [380, 640, 22], [900, 620, 26], [520, 660, 12],
  ];
  craters.forEach(([a, b, c]) => crater(px2(a), py2(b), c * S));
  // мелкие кратеры
  for (let i = 0; i < 40; i++) crater(px2(30 + rnd() * 940), py2(30 + rnd() * 640), (2 + rnd() * 5) * S);

  // слабое виньетирование
  const vin = cx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
  vin.addColorStop(0, "rgba(0,0,0,0)");
  vin.addColorStop(1, "rgba(0,0,0,.45)");
  cx.fillStyle = vin; cx.fillRect(0, 0, W, H);

  drawBase(cx, px2(d.outposts.base.x), py2(d.outposts.base.y), S);
  return cv;
}
function renderMap(d) {
  const canvas = $("map");
  const W = canvas.parentElement.clientWidth, H = canvas.parentElement.clientHeight;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  initStars(W, H);
  const key = W + "x" + H;
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

  // заказы
  const selO = d.orders.find((x) => x.id === state.selOrder);
  d.orders.forEach((o) => {
    if (o.status !== "available") return;
    const out = d.outposts[o.outpost];
    const ex = px(out.x), ey = py(out.y);
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
  });

  // роверы (плавная интерполяция между поллингами)
  const selR = d.rovers.find((x) => x.id === state.selRover);
  const nowMs = performance.now();
  d.rovers.forEach((r) => {
    const pv = state.roverPrev[r.id];
    const dx = r.x - (pv ? pv.x : r.x), dy = r.y - (pv ? pv.y : r.y);
    const teleport = !pv || Math.hypot(dx, dy) > 30;
    const a = teleport || !pv ? 1 : Math.min(1, (nowMs - pv.t) / 800);
    const rx = px(pv && !teleport ? pv.x + dx * a : r.x);
    const ry = py(pv && !teleport ? pv.y + dy * a : r.y);
    if (r.journey) {
      const oo = d.outposts[r.journey.outpost];
      ctx.strokeStyle = "rgba(56,189,248,.18)"; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(px(oo.x), py(oo.y)); ctx.lineTo(rx, ry); ctx.stroke();
      ctx.setLineDash([]);
    }
    const inSel = selR && selR.id === r.id;
    const moving = r.status === "delivering" || r.status === "returning";
    const wob = moving ? Math.sin(nowMs / 120) * 1.2 * S : 0;
    const wob2 = moving ? Math.cos(nowMs / 160) * 1.2 * S : 0;
    ctx.beginPath(); ctx.arc(rx + wob, ry + wob2, (inSel ? 8.5 : 6.5) * S, 0, 7);
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
  <p>Вы — диспетчер лунной базы. Выживите <b>7 дней</b>, не уронив рейтинг до 0, и заработайте максимум кредитов.</p>
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
    <li>Финал 7-го дня: счёт = кредиты + рейтинг × 30.</li>
  </ul>`;
function showHelp() { showModal(RULES + `<button onclick="hideModal()">Понятно 🚀</button>`); }

function showGameOver(d) {
  if (!$("overlay").classList.contains("hidden")) return;
  const ok = d.gameover_reason === "success";
  $("modal").innerHTML = `
    <h2>${ok ? "🏆 База выстояла 7 дней!" : "💀 База закрыта"}</h2>
    <div class="end-msg">${ok ? "Превосходная работа, диспетчер." : d.gameover_reason}</div>
    <div class="score">
      <div class="sc"><b class="good">${d.credits}</b><span>кредитов</span></div>
      <div class="sc"><b class="${ok ? "good" : "warn"}">${d.rating}</b><span>рейтинг</span></div>
      <div class="sc"><b>${d.deliveries.length}</b><span>доставок</span></div>
      <div class="sc"><b>${d.credits + d.rating * 30}</b><span>итог</span></div>
    </div>
    <button onclick="hideModal();api('reset').then(poll)">Новая игра</button>`;
  $("overlay").classList.remove("hidden");
}
function showModal(html) { $("modal").innerHTML = html; $("overlay").classList.remove("hidden"); }
function hideModal() { $("overlay").classList.add("hidden"); }

/* -------- кнопки -------- */
$("btn-ff").addEventListener("click", async () => {
  await api("fast_forward", { on: !state.data.time.ff });
  poll();
});
$("btn-pause").addEventListener("click", async () => {
  await api("pause", {});
  poll();
});
$("btn-reset").addEventListener("click", async () => {
  if (confirm("Начать заново?")) { await api("reset"); poll(); }
});

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