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

const tut = { active: false, step: 0, started: false, pending: false, scrollStep: -1 };

function startTutorial() {
  tut.active = true; tut.step = 0; tut.pending = false;
  tutRender();
}
function closeTutorial() {
  tut.active = false;
  clearTutGlow();
  $("tut").classList.add("hidden");
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
  clearTutGlow();
  if (s.target) {
    const el = findTutTarget(s.target);
    if (el) {
      el.classList.add("tut-glow");
      if (tut.scrollStep !== tut.step) { tut.scrollStep = tut.step; el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    }
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

function tutTick() {
  if (!tut.active) return;
  const s = tutStep();
  if (s.auto && canProceed(s)) {
    if (!tut.pending) {
      tut.pending = true;
      setTimeout(() => { if (tut.active && tut.pending) { tut.step++; tut.pending = false; tutRender(); } }, 1500);
    }
  } else if (!canProceed(s)) {
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
if (!localStorage.getItem("mcs_tut")) {
  localStorage.setItem("mcs_tut", "1");
  setTimeout(startTutorial, 600);
}

/* ===================== ФЛОТ ===================== */

$("btn-fleet").addEventListener("click", showFleet);

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

  html += `<div class="f-h">Верфь <span class="fr">новые модели</span></div>`;
  for (const [mid, m] of Object.entries(d.fleet_shop)) {
    const owned = m.owned;
    html += `
      <div class="f-shop">
        <div class="nm">${m.name} <small>· ${m.model}</small></div>
        <div class="dst">груз ${m.cap_kg} кг · батарея ${m.batt} Вт·ч · скорость ${m.speed_kmh} км/ч</div>
        <div class="sp"><span>стоимость <b>${m.cost}₵</b></span><span>нужно доставок <b>${m.min_done}</b></span></div>
        <button class="buy ${owned || !m.unlocked ? "lock" : "ok"}" data-fa="buy" data-m="${mid}" ${owned || !m.unlocked ? "disabled" : ""}>
          ${owned ? "В вашем флоте ✓" : m.unlocked ? `Купить за ${m.cost}₵` : `Доступно после ${m.min_done} доставок`}
        </button>
      </div>`;
  }

  html += `<button onclick="hideModal()">Закрыть</button>`;
  showModal(html);

  document.querySelectorAll("[data-fa]").forEach((b) => {
    b.addEventListener("click", async () => {
      const res = b.dataset.fa === "upgrade"
        ? await api("upgrade", { rover_id: b.dataset.r, stat: b.dataset.u })
        : await api("buy_rover", { model_id: b.dataset.m });
      if (res && !res.ok) {
        document.querySelector("#modal .f-h")?.insertAdjacentHTML("afterend", `<div class="err">${res.error}</div>`);
        return;
      }
      await poll();
      showFleet();
    });
  });
}