/* Moon Courier Simulator — клиент (редизайн) */
"use strict";

const moonTex = new Image();
moonTex.src = "/static/assets/moon_texture.jpg";

const $ = (id) => document.getElementById(id);
const state = { selOrder: null, selRover: null, data: null };

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
  try { state.data = await (await fetch("/api/state", { cache: "no-store" })).json(); render(); }
  catch { /* сервер не готов */ }
}

function render() {
  const d = state.data; if (!d) return;
  $("st-day").textContent = d.time.day + "/" + d.time.days_total;
  $("st-clock").textContent = d.time.clock;
  $("st-credits").textContent = d.credits + " ₵";
  $("st-rating").style.width = d.rating + "%";
  $("btn-ff").textContent = d.time.ff ? "⏩⏩" : "⏩";
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
let stars = [];
function initStars(W, H) {
  if (stars.length) return;
  for (let i = 0; i < 90; i++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.3 + 0.3, a: Math.random() * 0.5 + 0.25 });
  stars.size = { W, H };
}
function renderMap(d) {
  const canvas = $("map");
  const W = canvas.parentElement.clientWidth, H = canvas.parentElement.clientHeight;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  initStars(W, H);
  const ctx = canvas.getContext("2d");
  const S = Math.min(W / 1000, H / 700);
  const ox = (W - 1000 * S) / 2, oy = (H - 700 * S) / 2;
  const px = (x) => x * S + ox, py = (y) => y * S + oy;
  const hour = Math.floor(d.time.minute_total) % 1440;
  const night = hour < 360 || hour >= 1200;

  // фон: текстура Луны (или процедурный запасной вариант)
  const textureOK = moonTex.complete && moonTex.naturalWidth > 0;
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, W, H);
  if (textureOK) {
    const sc = Math.max(W / moonTex.naturalWidth, H / moonTex.naturalHeight);
    const tw = moonTex.naturalWidth * sc, th = moonTex.naturalHeight * sc;
    ctx.drawImage(moonTex, (W - tw) / 2, (H - th) / 2, tw, th);
    ctx.fillStyle = "rgba(4,7,14,.4)";
    ctx.fillRect(0, 0, W, H);
  }
  stars.forEach((s) => { ctx.globalAlpha = s.a; ctx.fillStyle = "#cdd9ef"; ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 7); ctx.fill(); });
  ctx.globalAlpha = 1;

  // кратеры (мягкие), только при процедурном фоне
  if (!textureOK) {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    ctx.fillStyle = "rgba(255,255,255,.018)";
    for (let i = 0; i < 24; i++) {
      const cx = px(50 + rnd() * 900), cy = py(50 + rnd() * 600), cr = 8 + rnd() * 26;
      ctx.beginPath(); ctx.arc(cx, cy, cr, 0, 7); ctx.fill();
    }
  }

  // зоны
  d.zone_order.forEach((zid) => {
    const z = d.zones[zid];
    const storm = d.storms[zid];
    ctx.beginPath();
    z.poly.forEach(([x, y], i) => i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)));
    ctx.closePath();
    ctx.fillStyle = storm ? "rgba(248,113,113,.10)" : "rgba(148,163,184,.045)";
    ctx.fill();
    ctx.strokeStyle = storm ? "rgba(248,113,113,.8)" : riskColor(z.risk) + "55";
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

  // база
  drawBase(ctx, px(d.outposts.base.x), py(d.outposts.base.y), S);

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

  // роверы
  const selR = d.rovers.find((x) => x.id === state.selRover);
  d.rovers.forEach((r) => {
    const rx = px(r.x), ry = py(r.y);
    if (r.journey) {
      const oo = d.outposts[r.journey.outpost];
      ctx.strokeStyle = "rgba(56,189,248,.18)"; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(px(oo.x), py(oo.y)); ctx.lineTo(rx, ry); ctx.stroke();
      ctx.setLineDash([]);
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
$("btn-reset").addEventListener("click", async () => {
  if (confirm("Начать заново?")) { await api("reset"); poll(); }
});

poll();
setInterval(poll, 800);