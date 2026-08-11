/* Moon Courier Simulator — клиент */
"use strict";

const $ = (id) => document.getElementById(id);
const state = {
  selOrder: null, selRover: null, data: null, ticking: 0,
};

const RISK_COLOR = (r) => (r < 0.2 ? "#3ddc84" : r < 0.5 ? "#ffc44d" : "#ff5d5d");
const fmtKg = (k) => (k >= 1000 ? (k / 1000).toFixed(1) + " t" : Math.round(k) + " кг");
const STATUS_CLS = {
  idle: "st-idle", delivering: "st-busy", returning: "st-busy",
  stranded: "st-bad", maintenance: "st-warn",
};
const STATUS_TXT = {
  idle: "свободен", delivering: "в пути ▶", returning: "возврат ◀",
  stranded: "застрял ⚠", maintenance: "ТО/зарядка",
};

async function api(cmd, payload = {}) {
  try {
    const r = await fetch("/api/cmd", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd, payload }),
    });
    return await r.json();
  } catch (e) { return { ok: false, error: "нет связи с сервером" }; }
}

async function poll() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    state.data = await r.json();
    render();
  } catch (e) { /* сервер ещё не готов */ }
}

function render() {
  const d = state.data; if (!d) return;
  // топ-бар
  $("st-day").textContent = d.time.day + " / " + d.time.days_total;
  $("st-clock").textContent = d.time.clock;
  $("st-credits").textContent = d.credits;
  $("st-rating").style.width = d.rating + "%";
  $("btn-ff").textContent = d.time.ff ? "⏩⏩" : "⏩";
  renderOrders(d);
  renderRovers(d);
  renderMission(d);
  renderLog(d);
  renderMap(d);
  if (d.gameover) showGameOver(d);
}

/* ---------------- Заказы ---------------- */
function orderImpossibility(d, o) {
  const caps = Object.values(d.rovers).map((r) => r.cap_kg);
  if (o.weight_kg > Math.max(...caps)) return "груз слишком тяжёлый";
  if (d.storms[o.zone_id]) return "зона под бурей";
  return null;
}

function renderOrders(d) {
  const list = $("orders-list");
  const act = d.orders.filter((o) => o.status === "available").length;
  $("orders-count").textContent = act;
  list.innerHTML = "";
  for (const o of d.orders) {
    if (o.status !== "available") continue;
    const el = document.createElement("div");
    el.className = "order-card" + (state.selOrder === o.id ? " sel" : "");
    const left = o.expires_at - d.time.minute_total;
    const pct = Math.max(0, Math.min(100, (left / o.urgent) * 100));
    const im = orderImpossibility(d, o);
    const badge = im
      ? `<span class="badge b-im">✕ ${im}</span>`
      : left < 30
        ? `<span class="badge b-urg">срочный</span>`
        : `<span class="badge b-ok">${Math.ceil(left)} мин</span>`;
    el.innerHTML = `
      <div class="row1"><span class="dest">📍 ${o.outpost_name}</span>${badge}</div>
      <div class="weight">Груз: <b>${fmtKg(o.weight_kg)}</b><span class="reward">+${o.reward} ₵</span></div>
      <div class="meta"><span>зона: ${o.zone_id}</span><span>риск: <i style="color:${RISK_COLOR(o.zone_risk)}">${o.zone_risk.toFixed(2)}</i></span></div>
      <div class="tbar"><div style="width:${pct}%;background:${pct < 25 ? "var(--bad)" : "var(--warn)"}"></div></div>`;
    el.addEventListener("click", () => {
      state.selOrder = state.selOrder === o.id && state.selRover ? null : o.id;
      renderOrders(d); renderMission(d);
    });
    list.appendChild(el);
  }
}

/* ---------------- Роверы ---------------- */
function renderRovers(d) {
  const list = $("rovers-list");
  list.innerHTML = "";
  for (const r of d.rovers) {
    const el = document.createElement("div");
    el.className = "rover-card" + (state.selRover === r.id ? " sel" : "");
    const pct = Math.round((r.batt / r.batt_max) * 100);
    const batColor = pct > 50 ? "var(--good)" : pct > 25 ? "var(--warn)" : "var(--bad)";
    const prog = r.progress ? Math.round(r.progress * 50) : 0;
    el.innerHTML = `
      <div class="rname">🤖 ${r.name}<span class="status ${STATUS_CLS[r.status] || ""}">${STATUS_TXT[r.status] || r.status}</span></div>
      <div class="battbar"><div style="width:${pct}%;background:${batColor}"></div></div>
      <div class="spec">
        <span>🔋 ${Math.round(r.batt)} / ${r.batt_max} Вт·ч</span>
        <span>🧱 ${r.cap_kg} кг</span>
        <span>⚡ ${r.speed_kmh} км/ч</span>
      </div>
      <div class="spec"><span>✓ ${r.done} · ✗ ${r.failed}</span><span>доставлено: ${r.earned} ₵</span></div>
      ${r.journey ? `<div class="spec" style="color:var(--acc)">маршрут: ${r.phase_label} ${prog}% · ${Math.round(r.e_spent)} Вт·ч</div>` : ""}`;
    if (r.status === "idle" || r.status === "stranded" || r.status === "maintenance") {
      el.addEventListener("click", () => {
        state.selRover = state.selRover === r.id ? null : r.id;
        renderRovers(d); renderMission(d);
      });
    }
    list.appendChild(el);
  }
}

/* ---------------- Миссия ---------------- */
function missionEstimate(d) {
  const o = d.orders.find((x) => x.id === state.selOrder);
  const r = d.rovers.find((x) => x.id === state.selRover);
  if (!o || !r) return null;
  const out = d.outposts[o.outpost];
  const km = Math.hypot(out.x - r.x, out.y - r.y) * 0.05;
  return { o, r, km };
}

function renderMission(d) {
  const box = $("mission-box");
  const sel = missionEstimate(d);
  if (!sel) {
    box.innerHTML = `<div class="mt">Выберите заказ и ровер, чтобы рассчитать миссию.</div>
      <p>Батарея и грузоподъёмность проверяются автоматически.</p>`;
    return;
  }
  const { o, r, km } = sel;
  const stormy = d.storms[o.zone_id];
  const overweight = o.weight_kg > r.cap_kg;
  const timeMin = Math.ceil((km / r.speed_kmh) * 60 * 2);
  const energyGuess = Math.ceil(km * 2 * 1.1 * 1.35);
  const lowBat = energyGuess > r.batt;
  const blocking = stormy ? `зона под бурей` : overweight
    ? `вес ${fmtKg(o.weight_kg)} > ${r.cap_kg} кг` : lowBat ? `батарея (≈${energyGuess} Вт·ч)` : null;
  const rows = `
    <div class="mb-rows">
      <span>Груз</span><b>${fmtKg(o.weight_kg)} (${o.outpost_name})</b>
      <span>Дистанция</span><b>≈ ${km.toFixed(1)} км в один конец</b>
      <span>Награда</span><b>+${o.reward} ₵</b>
      <span>Срок</span><b>${Math.max(0, Math.ceil(o.expires_at - d.time.minute_total))} мин</b>
    </div>`;
  let actionHtml = "";
  if (r.status === "stranded") {
    const cost = Math.round(15 + km * 0.6);
    actionHtml = `<button class="full" id="btn-recover">Эвакуировать (−${cost} ₵)</button>`;
  } else if (blocking) {
    actionHtml = `<div class="err">✕ Доставка невозможна: ${blocking}</div>`;
  } else {
    actionHtml = `<button class="full" id="btn-launch">🚀 Запустить доставку</button>
      <button class="full" id="btn-charge">⚡ Быстрая зарядка<br><span style="font-size:11px">${Math.ceil((r.batt_max - r.batt) / 2)} ₵ → 100%</span></button>`;
  }
  box.innerHTML = `<div class="mt">Миссия: ${r.name} → 📍 ${o.outpost_name}</div>
    ${rows}
    <div id="mission-actions">${actionHtml}</div>
    <div id="mission-msg"></div>
    <p style="margin-top:8px;font-size:11px">Время туда-обратно ≈ ${timeMin} мин. Оценка энергии туда-обратно ≈ ${energyGuess} Вт·ч${lowBat ? (overweight ? "" : " — может не хватить!") : ""}.</p>`;

  const launch = $("btn-launch");
  if (launch) launch.addEventListener("click", async () => {
    const res = await api("launch", { order_id: o.id, rover_id: r.id });
    const msg = $("mission-msg");
    msg.textContent = res.ok ? "Маршрут проложен. Ровер выехал!" : res.error;
    msg.className = "err";
    state.selOrder = null; state.selRover = null;
    poll();
  });
  const charge = $("btn-charge");
  if (charge) charge.addEventListener("click", async () => {
    const res = await api("rush_charge", { rover_id: r.id });
    const msg = $("mission-msg");
    if (!res.ok) { msg.textContent = res.error; msg.className = "err"; }
    poll();
  });
  const recover = $("btn-recover");
  if (recover) recover.addEventListener("click", async () => {
    const res = await api("recover", { rover_id: r.id });
    const msg = $("mission-msg");
    if (!res.ok) { msg.textContent = res.error; msg.className = "err"; }
    poll();
  });
}

/* ---------------- Журнал ---------------- */
function renderLog(d) {
  const box = $("log");
  box.innerHTML = "";
  const cls = { delivery: "ok", hazard: "alert", storm: "alert", mission: "miss" };
  for (const e of d.events.slice(0, 30)) {
    const div = document.createElement("div");
    div.className = "ev " + (cls[e.kind] || "");
    div.innerHTML = `<span class="c">Д${Math.floor(e.minute / 1440) + 1} ${e.clock}</span>${e.text}`;
    box.appendChild(div);
  }
  box.scrollTop = 0;
}

/* ---------------- Карта ---------------- */
function renderMap(d) {
  const canvas = $("map");
  const parent = canvas.parentElement;
  const W = parent.clientWidth, H = parent.clientHeight;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext("2d");
  const S = Math.min(W / 1000, H / 700);
  const ox = (W - 1000 * S) / 2, oy = (H - 700 * S) / 2;
  const px = (x) => x * S + ox, py = (y) => y * S + oy;
  const hour = Math.floor(d.time.minute_total) % 1440;
  const night = hour < 360 || hour >= 1200;

  // фон Луны
  const bg = ctx.createRadialGradient(W * 0.55, H * 0.35, 40, W * 0.55, H * 0.35, Math.max(W, H) * 0.8);
  bg.addColorStop(0, "#1e2b45"); bg.addColorStop(1, "#0a0e17");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // кратеры
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) {
    const cx = px(60 + rnd() * 880), cy = py(60 + rnd() * 600), cr = 6 + rnd() * 22;
    ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,.22)"; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, cr * 0.82, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(120,150,190,.06)"; ctx.fill();
  }

  // зоны
  for (const zid of d.zone_order) {
    const z = d.zones[zid];
    ctx.beginPath();
    z.poly.forEach(([x, y], i) => i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)));
    ctx.closePath();
    const storm = d.storms[zid];
    ctx.fillStyle = storm ? "rgba(255,90,90,.14)" : "rgba(60,80,110,.10)";
    ctx.fill();
    ctx.strokeStyle = storm ? "#ff5d5d" : RISK_COLOR(z.risk);
    ctx.lineWidth = storm ? 2.5 : 1.4;
    ctx.setLineDash(storm ? [6, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    // подпись
    ctx.fillStyle = "rgba(219,228,245,.5)";
    ctx.font = `${Math.max(10, 13 * S)}px Segoe UI`;
    const cx = px(z.poly.reduce((a, p) => a + p[0], 0) / z.poly.length);
    const cy = py(z.poly.reduce((a, p) => a + p[1], 0) / z.poly.length);
    ctx.textAlign = "center";
    ctx.fillText(z.name + (storm ? " ☢ буря" : ""), cx, cy);
  }

  // база
  const bx = px(d.outposts.base.x), by = py(d.outposts.base.y);
  ctx.beginPath(); ctx.arc(bx, by, 9 * S, 0, Math.PI * 2);
  ctx.fillStyle = "#42c6ff"; ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = `${Math.max(10, 12 * S)}px Segoe UI`; ctx.fillStyle = "#42c6ff";
  ctx.textAlign = "center"; ctx.fillText("База", bx, by - 12 * S);

  // точки заказов
  for (const o of d.orders) {
    if (o.status !== "available") continue;
    const out = d.outposts[o.outpost];
    const ex = px(out.x), ey = py(out.y);
    const left = o.expires_at - d.time.minute_total;
    const im = orderImpossibility(d, o);
    ctx.beginPath(); ctx.arc(ex, ey, (im ? 8 : 6) * S, 0, Math.PI * 2);
    ctx.fillStyle = im ? "#ffc44d" : RISK_COLOR(Math.max(0.3, left / o.urgent * 0.8));
    ctx.fill();
    if (state.selOrder === o.id) {
      ctx.strokeStyle = "#42c6ff"; ctx.lineWidth = 2.5; ctx.stroke();
    }
    ctx.font = `${Math.max(9, 11 * S)}px Segoe UI`;
    ctx.fillStyle = "#fff";
    ctx.fillText(fmtKg(o.weight_kg) + " +" + o.reward, ex, ey - 8 * S);
  }

  // роверы
  for (const r of d.rovers) {
    const rx = px(r.x), ry = py(r.y);
    // тень/след при движении
    if (r.journey) {
      const oo = d.outposts[r.journey.outpost];
      ctx.strokeStyle = "rgba(66,198,255,.25)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(px(oo.x), py(oo.y)); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(rx, ry, 8 * S, 0, Math.PI * 2);
    ctx.fillStyle = "#1f2c46"; ctx.fill();
    ctx.strokeStyle = r.status === "stranded" ? "#ff5d5d" : r.status === "idle" ? "#3ddc84" : "#42c6ff";
    ctx.lineWidth = 2.5; ctx.stroke();
    const bp = Math.round((r.batt / r.batt_max) * 100);
    ctx.beginPath(); ctx.arc(rx, ry, 13 * S, -Math.PI / 2, -Math.PI / 2 + (bp / 100) * Math.PI * 2);
    ctx.strokeStyle = bp > 50 ? "#3ddc84" : bp > 25 ? "#ffc44d" : "#ff5d5d";
    ctx.lineWidth = 3; ctx.stroke();
    ctx.font = `${Math.max(9, 11 * S)}px Segoe UI`; ctx.fillStyle = "#dbe4f5"; ctx.textAlign = "center";
    ctx.fillText(r.name + (r.status === "stranded" ? " ✗" : ""), rx, ry + 22 * S);
    if (state.selRover === r.id) {
      ctx.strokeStyle = "#42c6ff"; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(rx, ry, 16 * S, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (night) {
    ctx.fillStyle = "rgba(30,40,80,.20)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(219,228,245,.35)";
    ctx.font = "12px Segoe UI"; ctx.textAlign = "right";
    ctx.fillText("🌙 ночь — зарядка базы медленнее", W - 8, H - 6);
  }
}

/* ---------------- Описание правил / овер / конец игры ---------------- */
const RULES = `
  <h2>🌙 Moon Courier — правила</h2>
  <p>Вы — диспетчер лунной базы. Выживите <b>7 дней</b>, не уронив рейтинг базы до 0 и заработав максимум кредитов.</p>
  <h3>Как играть</h3>
  <ul>
    <li>На карте — заказы на пайки в разных зонах Луны (дистанция, риск, награда).</li>
    <li>Выберите заказ и свободный ровер, нажмите <b>🚀 Запустить</b>.</li>
    <li>Батарея и грузоподъёмность проверяются автоматически — невыполнимый маршрут не запустится.</li>
    <li>Тяжёлый груз тратит больше энергии; зоны (кратеры, излучины) замедляют и повышают риск аварий.</li>
  </ul>
  <h3>Логика веса / батареи / риска</h3>
  <ul>
    <li><b>Вес</b>: груз > грузоподъёмности ровера — доставка невозможна.</li>
    <li><b>Батарея</b>: требуемая энергия (туда и обратно) должна влезть в заряд. Зарядка — только на базе (ночью медленнее), есть платная быстрая.</li>
    <li><b>Риск зоны</b>: чем выше, тем вероятнее пыль, ЭМИ, поломки и разрядка в пути. Застрявший ровер — штраф рейтинга и кредитов на эвакуацию.</li>
    <li><b>Бури</b>: зона под бурей полностью заблокирована — доставка туда невозможна, пока буря не пройдёт.</li>
  </ul>
  <h3>Цель и очки</h3>
  <ul>
    <li>Вовремя — +полная награда и +2 рейтинга. Опоздание — половина награды и −4.</li>
    <li>Просроченный заказ сгорает (−4 рейтинга).</li>
    <li>К концу 7 дня: чем больше кредитов и рейтинг выше — тем выше итоговый счёт.</li>
  </ul>
`;
function showHelp() {
  showModal(` ${RULES}` + `<button onclick="hideModal()">Понятно, вперёд 🚀</button>`);
}

function showGameOver(d) {
  if ($("overlay").classList.contains("hidden") === false || state.ticking) return;
  const success = d.gameover_reason === "success";
  $("modal").innerHTML = `
    <h2>${success ? "🏆 База выстояла 7 дней!" : "💀 База закрыта"}</h2>
    <div class="end-msg">${success ? "Превосходная работа, диспетчер." : d.gameover_reason}</div>
    <div class="score">
      <div class="sc"><b>${d.credits}</b><span>кредитов</span></div>
      <div class="sc"><b>${d.rating}</b><span>рейтинг</span></div>
      <div class="sc"><b>${d.deliveries.length}</b><span>доставок</span></div>
    </div>
    <div style="font-size:12px;color:var(--dim);text-align:center">Счёт: ${d.credits + d.rating * 30}</div>
    <button onclick="hideModal();api('reset')">Новая игра</button>`;
  $("overlay").classList.remove("hidden");
  state.ticking = true;
}

function showModal(html) {
  $("modal").innerHTML = html;
  $("overlay").classList.remove("hidden");
}
function hideModal() { $("overlay").classList.add("hidden"); }

/* ---------------- управление ---------------- */
$("btn-ff").addEventListener("click", async () => {
  const ff = !state.data.time.ff;
  await api("fast_forward", { on: ff });
  poll();
});
$("btn-help").addEventListener("click", showHelp);
$("btn-reset").addEventListener("click", async () => {
  if (confirm("Начать заново?")) { await api("reset"); poll(); }
});

poll();
setInterval(poll, 800);