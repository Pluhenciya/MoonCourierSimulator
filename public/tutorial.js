/* Moon Courier Simulator — интерактивный онбординг + флот */
"use strict";

/* ===================== ТУТОРИАЛ ===================== */

const TUT = [
  {
    title: "Добро пожаловать, диспетчер 🌙",
    txt: "Вы — диспетчер лунной базы Tranquility. По Луне разбросаны заказы на пайки, и только ваши роверы могут их доставить.<br><br><b>Цель:</b> продержаться <b>7 дней</b>, не уронив рейтинг базы до 0, и заработать как можно больше кредитов.",
    target: null, need: null, hint: "", btn: "Начать обучение 🚀",
  },
  {
    title: "Заказы",
    txt: "<b>Слева</b> — входящие заказы. У каждого: вес груза, награда, срок и риск зоны. У срочных — красный чип, полоса показывает, сколько времени осталось.<br><br>Некоторые заказы могут быть <b>невыполнимы</b> (слишком тяжёлые или зона под бурей) — они отмечены.",
    target: "#orders-list", need: () => state.selOrder != null, hint: "▶ Кликни на срочный заказ",
    btn: "Дальше →",
  },
  {
    title: "Роверы",
    txt: "<b>Справа</b> — ваш флот. У ровера есть батарея, грузоподъёмность и скорость. Зелёная батарея — полный заряд; она тратится в пути и заряжается только на базе.",
    target: "#rovers-list", need: () => state.selRover != null, hint: "▶ Теперь выбери ровер",
    btn: "Дальше →",
  },
  {
    title: "Карта и зоны",
    txt: "В центре — карта Луны. Цвет рамки зоны показывает риск: <span style='color:#34d399'>зелёный</span> — спокойно, <span style='color:#fbbf24'>жёлтый</span> — опасно, <span style='color:#f87171'>красный</span> — очень рискованно.<br><br>Зоны с пунктиром — <b>под бурей</b>: туда сейчас нельзя. Зелёная точка внизу — база. Оранжевые кружки — заказы.",
    target: "#map-wrap", need: null, hint: "", btn: "Дальше →",
  },
  {
    title: "Расчёт миссии",
    txt: "Выбрав заказ и ровер, смотрите панель <b>«Миссия»</b>: дистанция, награда, время и энергия туда-обратно.<br><br><b>Важно:</b> система сама не запустит доставку, если не хватит батареи или груз не влезет в ровер — вы увидите причину.",
    target: "#mission-box", need: null, hint: "", btn: "Дальше →",
  },
  {
    title: "Запуск доставки",
    txt: "Нажми <b>🚀 Запустить доставку</b> — ровер поедет по карте. В пути на него действует риск зоны: пыль, метеориты, поломки. Следи за журналом событий внизу.",
    target: "#ma .launch",
    need: () => state.data.rovers.some((r) => r.status === "delivering" || r.status === "returning"),
    auto: true,
    hint: "▶ Нажми «Запустить доставку»",
    btn: "Дальше →",
  },
  {
    title: "Ускорение времени",
    txt: "Кнопка <b>⏩</b> ускоряет время в 5 раз — удобно ждать возвращения ровера. Вовремя доставленный заказ даёт полную награду и +2 к рейтингу, опоздание — половину и −4.",
    target: "#btn-ff", need: null, hint: "", btn: "Дальше →",
  },
  {
    title: "Развивай флот",
    txt: "На заработанные кредиты открывается кнопка <b>🛰</b> справа: улучшай грузоподъёмность, батарею и скорость роверов, а после нескольких доставок — покупай новые модели в верфи.",
    target: "#btn-fleet", need: null, hint: "", btn: "Дальше →",
  },
  {
    title: "Всё готово!",
    txt: "Итог дня 7-го: <b>счёт = кредиты + рейтинг × 30</b>. Если рейтинг упадёт в 0 — базу закроют.<br><br>Совет: не гоняй тяжёлые грузы на слабых роверах, заряжайся на базе и обходи бури.<br><br><a onclick=\"showHelp()\">Открыть полные правила</a>",
    target: null, need: null, hint: "", btn: "Играть 🚀",
  },
];

const tut = { active: false, step: 0, started: false, pending: false, scrollStep: -1, posStep: -1 };
window.addEventListener("resize", () => { if (tut.active) tutPlace(); });

function startTutorial() {
  tut.active = true; tut.step = 0; tut.pending = false;
  api("pause", { on: true });
  tutRender();
}
function closeTutorial() {
  tut.active = false;
  api("pause", { on: false });
  window.tutMap = null;
  window.tutMapScreen = null;
  clearTutGlow();
  $("tut").classList.add("hidden");
  localStorage.setItem("mcs_tut", "1");  // обучение показано — больше не показываем
}
function tutStep() { return TUT[tut.step]; }

function canProceed(s) {
  if (!s.need) return true;
  try { return !!s.need(); } catch { return false; }
}

function tutRender() {
  const box = $("tut");
  if (!tut.active) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  const s = tutStep();
  box.querySelector(".tut-t").textContent = s.title;
  box.querySelector(".tut-x").innerHTML = s.txt;
  box.querySelector(".tut-hint").textContent = s.hint || "";
  const dots = box.querySelector(".tut-dots");
  dots.innerHTML = "";
  TUT.forEach((_, i) => {
    const d = document.createElement("span");
    d.className = "dot" + (i === tut.step ? " on" : "") + (i < tut.step ? " done" : "");
    dots.appendChild(d);
  });
  const next = $("tut-next");
  next.disabled = !canProceed(s);
  next.textContent = s.btn || "Дальше →";
  next.hidden = !!(s.need || s.auto); // на шагах-действиях кнопки нет — переход сам после действия
  clearTutGlow();
  if (s.target) {
    const el = findTutTarget(s.target);
    if (el) {
      el.classList.add("tut-glow");
      if (tut.scrollStep !== tut.step) { tut.scrollStep = tut.step; el.scrollIntoView({ block: "nearest" }); }
    }
  }
  window.tutMap = tutMapFor(state.data);
  // позиционируем только при смене шага или ресайзе — иначе пузырь дёргается при перерисовке панелей
  if (tut.posStep !== tut.step) { tut.posStep = tut.step; tutPlace(); }
}

// позиционирует пузырь тутора рядом с целью (DOM-элемент или точка на карте), со стрелкой
function tutPlace() {
  const box = $("tut");
  const s = tutStep();
  box.classList.remove("placed", "t-above", "t-below", "t-left", "t-right");
  let r = null;
  const el = s.target ? findTutTarget(s.target) : null;
  if (el && s.target !== "#map-wrap") {
    r = el.getBoundingClientRect();
  } else if (window.tutMapScreen) {
    r = { left: window.tutMapScreen.x, top: window.tutMapScreen.y, right: window.tutMapScreen.x, bottom: window.tutMapScreen.y, width: 0, height: 0 };
  }
  if (!r) return;
  const W = box.offsetWidth, H = box.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight, gap = 16;
  if (r.top - H - gap > 4) {
    box.classList.add("placed", "t-above");
    box.style.left = Math.min(Math.max(r.left + r.width / 2 - W / 2, 10), vw - W - 10) + "px";
    box.style.top = (r.top - H - gap) + "px";
  } else if (vh - r.bottom - H - gap > 4) {
    box.classList.add("placed", "t-below");
    box.style.left = Math.min(Math.max(r.left + r.width / 2 - W / 2, 10), vw - W - 10) + "px";
    box.style.top = (r.bottom + gap) + "px";
  } else if (r.left - W - gap > 4) {
    box.classList.add("placed", "t-left");
    box.style.top = Math.min(Math.max(r.top + r.height / 2 - H / 2, 10), vh - H - 10) + "px";
    box.style.left = (r.left - W - gap) + "px";
  } else {
    box.classList.add("placed", "t-right");
    box.style.top = Math.min(Math.max(r.top + r.height / 2 - H / 2, 10), vh - H - 10) + "px";
    box.style.left = (r.right + gap) + "px";
  }
}
function findTutTarget(sel) {
  if (sel === "#orders-list") return $("orders-list");
  if (sel === "#rovers-list") return $("rovers-list");
  if (sel === "#map-wrap") return document.querySelector("#map-wrap");
  if (sel === "#mission-box") return $("mission-box");
  if (sel === "#ma .launch") return document.querySelector("#ma .launch");
  if (sel === "#btn-ff") return $("btn-ff");
  if (sel === "#btn-fleet") return $("btn-fleet");
  return document.querySelector(sel);
}
function clearTutGlow() { document.querySelectorAll(".tut-glow").forEach((e) => e.classList.remove("tut-glow")); }

// куда показать на карте: {kind:"base"|"order"|"rover", id}
function tutMapFor(d) {
  if (!d) return null;
  switch (tut.step) {
    case 1: { // Заказы — самый срочный доступный
      const list = d.orders.filter((o) => o.status === "available");
      if (!list.length) return null;
      const urgent = list.reduce((a, b) => (b.expires_at < a.expires_at ? b : a));
      return { kind: "order", id: urgent.id };
    }
    case 2: { // Роверы — первый свободный
      const r = d.rovers.find((x) => x.status === "idle" || x.status === "maintenance");
      return r ? { kind: "rover", id: r.id } : null;
    }
    case 3: return { kind: "base" }; // Карта и зоны — база
    case 4: { // Расчёт миссии — выбранный заказ
      const o = d.orders.find((x) => x.id === state.selOrder);
      return o ? { kind: "order", id: o.id } : null;
    }
    case 5: { // Запуск доставки — выбранный заказ
      const o = d.orders.find((x) => x.id === state.selOrder);
      return o ? { kind: "order", id: o.id } : null;
    }
    default: return null;
  }
}

function tutTick() {
  if (!tut.active) return;
  const s = tutStep();
  const stepDone = canProceed(s);
  if ((s.auto || s.need) && stepDone) {
    if (!tut.pending) {
      tut.pending = true;
      setTimeout(() => { if (tut.active && tut.pending) { tut.step++; tut.pending = false; tutRender(); } }, 1400);
    }
  } else if (!stepDone) {
    tut.pending = false;
  }
  tutRender();
}
$("tut-next").addEventListener("click", () => {
  if (!canProceed(tutStep())) return;
  if (tut.step >= TUT.length - 1) { closeTutorial(); return; }
  tut.step++; tut.pending = false; tutRender();
});
$("tut-skip").addEventListener("click", closeTutorial);
$("btn-help").addEventListener("click", startTutorial);
// обучение — только при первом входе (флаг ставится при завершении/пропуске)
if (!localStorage.getItem("mcs_tut")) {
  setTimeout(startTutorial, 600);
}

/* ===================== ФЛОТ ===================== */

$("btn-fleet").addEventListener("click", showFleet);
$("btn-shop").addEventListener("click", showShop);

function showFleet() {
  const d = state.data; if (!d) return;
  let html = `<h2>🛰 Флот и улучшения</h2>
    <div class="score" style="margin:6px 0 0">
      <div class="sc"><b class="good">${d.credits}</b><span>₵ в наличии</span></div>
      <div class="sc"><b>${d.total_done}</b><span>доставок</span></div>
    </div>`;

  html += `<div class="f-h">Ваши роверы</div>`;
  for (const r of d.rovers) {
    const st = STATUS[r.status];
    html += `<div class="f-card"><div class="nm">${r.name} <small>· ${r.model}</small>
      ${st ? `<span class="st ${st[0]}">${st[1]}</span>` : ""}</div>`;
    for (const u of d.upgrade_plan) {
      const lvl = r[u.key] ?? 0;
      const maxed = lvl >= u.costs.length;
      const cost = maxed ? 0 : u.costs[lvl];
      const can = !maxed && r.status === "idle";
      html += `
        <div class="f-row">
          <span class="lab">${u.icon} ${u.label}</span>
          <span class="val"><b>${r[u.prop]}</b></span>
          <span class="cost">${maxed ? "максимум" : "+" + u.delta + " · " + cost + "₵"}</span>
          <button data-fa="upgrade" data-r="${r.id}" data-u="${u.key}" ${can ? "" : "disabled"}>${maxed ? "✓" : cost > d.credits ? "↑" : "Улучшить"}</button>
        </div>`;
    }
    html += `</div>`;
  }

  html += `<button onclick="hideModal()">Закрыть</button>`;
  showModal(html);

  document.querySelectorAll("[data-fa='upgrade']").forEach((b) => {
    b.addEventListener("click", async () => {
      const res = await api("upgrade", { rover_id: b.dataset.r, stat: b.dataset.u });
      if (res && !res.ok) {
        document.querySelector("#modal .f-h")?.insertAdjacentHTML("afterend", `<div class="err">${res.error}</div>`);
        return;
      }
      await poll();
      showFleet();
    });
  });
}

function showShop() {
  const d = state.data; if (!d) return;
  let html = `<h2>🛒 Верфь</h2>
    <div class="score" style="margin:6px 0 0">
      <div class="sc"><b class="good">${d.credits}</b><span>₵ в наличии</span></div>
      <div class="sc"><b>${d.total_done}</b><span>доставок</span></div>
    </div>
    <div class="f-h">Новые модели <span class="fr">витрина обновляется каждые 35–70 мин</span></div>`;
  for (const m of d.fleet_shop) {
    html += `
      <div class="f-shop">
        <div class="nm">${m.name} <small>· ${m.model}</small></div>
        <div class="dst">груз ${m.cap_kg} кг · батарея ${m.batt} Вт·ч · скорость ${m.speed_kmh} км/ч</div>
        <div class="sp"><span>стоимость <b>${m.cost}₵</b></span><span>нужно доставок <b>${m.min_done}</b></span></div>
        <button class="buy ${m.unlocked ? "ok" : "lock"}" data-m="${m.id}" ${m.unlocked ? "" : "disabled"}>
          ${m.unlocked ? `Купить за ${m.cost}₵` : `Доступно после ${m.min_done} доставок`}
        </button>
      </div>`;
  }
  html += `<button onclick="hideModal()">Закрыть</button>`;
  showModal(html);

  document.querySelectorAll("[data-m]").forEach((b) => {
    b.addEventListener("click", async () => {
      const res = await api("buy_rover", { shop_id: b.dataset.m });
      if (res && !res.ok) {
        document.querySelector("#modal .f-h")?.insertAdjacentHTML("afterend", `<div class="err">${res.error}</div>`);
        return;
      }
      await poll();
      showShop();
    });
  });
}