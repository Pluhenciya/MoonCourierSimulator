#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Moon Courier Simulator — игровой симулятор лунной доставки.
Бэкенд: только стандартная библиотека Python. Рендер: браузер (см. public/).
Хранилище: JSON-файлы в data/.

Запуск:  python server.py   (по умолчанию порт 8000)
"""

import json
import math
import os
import random
import threading
import time
import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

# ----------------------------------------------------------------------------
# Конфигурация мира
# ----------------------------------------------------------------------------

SCALE_KM = 0.05          # 1 px карты = 0.05 км
GAME_MIN_PER_SEC = 1.0   # 1 реальная секунда = 1 игровая минута
FF_MULT = 5.0            # множитель при ускорении
DAYS_TO_SURVIVE = 7
START_RATING = 80
START_CREDITS = 120
REQ_BATTERY_EPS = 0.5    # запас при проверке батареи

ZONES = {
    "maria":     {"name": "Maria Plain",       "poly": [(180, 440), (820, 440), (820, 700), (180, 700)], "speed": 1.00, "risk": 0.06, "energy": 1.00, "bonus": 1.00, "color": "#4a6b8a"},
    "crater":    {"name": "Crater Field",      "poly": [(280, 230), (720, 230), (780, 430), (220, 430)], "speed": 0.75, "risk": 0.28, "energy": 1.35, "bonus": 1.15, "color": "#6b5b4a"},
    "taurus":    {"name": "Taurus Highlands",  "poly": [(0, 0), (300, 0), (300, 230), (0, 260)],          "speed": 0.60, "risk": 0.50, "energy": 1.50, "bonus": 1.40, "color": "#5a4a6b"},
    "radiation": {"name": "Radiation Valley",  "poly": [(700, 230), (1000, 0), (1000, 320), (700, 230)], "speed": 0.85, "risk": 0.80, "energy": 1.15, "bonus": 1.60, "color": "#6b4a4a"},
    "sanctum":   {"name": "Sanctum Ridge",     "poly": [(0, 430), (120, 430), (120, 700), (0, 700)],     "speed": 0.90, "risk": 0.12, "energy": 1.00, "bonus": 1.05, "color": "#3f6b5a"},
    "apollo":    {"name": "Apollo Basin",      "poly": [(880, 430), (1000, 430), (1000, 700), (880, 700)], "speed": 0.95, "risk": 0.18, "energy": 1.05, "bonus": 1.10, "color": "#6b5a3f"},
}
# порядок отрисовки (снизу вверх)
ZONE_ORDER = ["maria", "crater", "taurus", "radiation", "sanctum", "apollo"]

OUTPOSTS = {
    "base":       {"name": "Tranquility Hub", "x": 500, "y": 660},
    "bugtown":    {"name": "Bugtown",         "x": 300, "y": 580},
    "crater_edge": {"name": "Crater's Edge",  "x": 500, "y": 320},
    "serenity":   {"name": "Serenity Station","x": 150, "y": 120},
    "far_side":   {"name": "Far Side Relay",  "x": 880, "y": 150},
    "sanctum_yd": {"name": "Micro-Grav Yard", "x": 60,  "y": 560},
    "apollo_camp":{"name": "Apollo Camp",     "x": 940, "y": 580},
}

DEST_IDS = ["bugtown", "crater_edge", "serenity", "far_side", "sanctum_yd", "apollo_camp"]

ROVERS = {
    "bumble": {"name": "Bumble", "model": "Lunar Mule",    "cap_kg": 80,  "batt": 120, "speed_kmh": 25, "base_e": 1.2, "kw": 0.004},
    "atlas":  {"name": "Atlas",  "model": "Heavy Mover",   "cap_kg": 250, "batt": 180, "speed_kmh": 18, "base_e": 1.6, "kw": 0.002},
    "comet":  {"name": "Comet",  "model": "Fast Courier",  "cap_kg": 40,  "batt": 100, "speed_kmh": 45, "base_e": 1.0, "kw": 0.005},
}

# Улучшения флота: key -> prop (поле ровера), дельта за уровень, стоимость уровней
UPGRADES = [
    {"key": "up_kg",    "label": "Грузоподъёмность", "prop": "cap_kg",   "delta": 12, "icon": "🧱", "costs": [40, 75, 120, 180]},
    {"key": "up_batt",  "label": "Батарея",          "prop": "batt_max", "delta": 18, "icon": "🔋", "costs": [35, 65, 110, 170]},
    {"key": "up_speed", "label": "Скорость",         "prop": "speed_kmh","delta": 4,  "icon": "⚡", "costs": [30, 55, 90, 140]},
]

# Витрина верфи: модели генерируются случайно и растут с прогрессом игрока
SHOP_SIZE = 4
SHOP_REFRESH_MIN = (35, 70)      # игровые минуты между ротациями слота
MODEL_NAMES = ["Hunter", "Mammoth", "Viper", "Titan", "Swift", "Boulder", "Nomad", "Ranger",
               "Comet", "Drake", "Pegasus", "Raven", "Storm", "Echo", "Onyx"]
MODEL_TYPES = ["Scout", "Heavy Lifter", "Fast Courier", "Freighter", "Lunar Truck",
               "Courier", "Hauler", "Racer", "Workhorse", "Explorer"]


def roll_model(total_done):
    """Генерирует случайную модель для витрины. Чем больше доставок — тем сильнее модели."""
    tier = min(8, total_done // 3)
    cap_kg = RAND.randint(45, 90) + tier * RAND.randint(6, 14)
    batt = RAND.randint(90, 125) + tier * RAND.randint(5, 12)
    if cap_kg > 150:
        speed_kmh = RAND.randint(12, 20)
    elif cap_kg > 100:
        speed_kmh = RAND.randint(18, 28)
    else:
        speed_kmh = RAND.randint(26, 45)
    cost = int(cap_kg * 0.8 + batt * 0.6 + speed_kmh * 2)
    cost = max(120, int(cost / 10) * 10)
    min_done = max(0, (cost - 140) // 70)   # чем дороже — тем позже доступна
    return {
        "id": gen_id("shop"),
        "name": RAND.choice(MODEL_NAMES),
        "model": RAND.choice(MODEL_TYPES),
        "cap_kg": cap_kg,
        "batt": batt,
        "speed_kmh": speed_kmh,
        "base_e": round(0.9 + cap_kg / 350, 2),
        "kw": round(max(0.0015, 0.006 - cap_kg / 90000), 4),
        "cost": cost,
        "min_done": min_done,
    }


def shop_init():
    if not STATE.get("shop"):
        total = sum(x["done"] for x in DB["rovers.json"].values())
        STATE["shop"] = [roll_model(total) for _ in range(SHOP_SIZE)]
        STATE["shop_next"] = STATE["minute_total"] + RAND.randint(*SHOP_REFRESH_MIN)


def shop_tick(dt_min):
    """Периодически заменяет один слот витрины свежей моделью."""
    if STATE["minute_total"] < STATE.get("shop_next", 1 << 30):
        return
    total = sum(x["done"] for x in DB["rovers.json"].values())
    i = RAND.randrange(len(STATE["shop"]))
    old = STATE["shop"][i]
    STATE["shop"][i] = roll_model(total)
    log_event("mission", "Верфь обновила витрину: «%s %s» (%.0f кг, %d км/ч) — %d₵. Осталась: «%s»."
              % (STATE["shop"][i]["name"], STATE["shop"][i]["model"], STATE["shop"][i]["cap_kg"],
                 STATE["shop"][i]["speed_kmh"], STATE["shop"][i]["cost"], old["name"]))
    STATE["shop_next"] = STATE["minute_total"] + RAND.randint(*SHOP_REFRESH_MIN)

# ----------------------------------------------------------------------------
# Хранилище (JSON-файлы)
# ----------------------------------------------------------------------------

def _load(name, default):
    path = os.path.join(DATA_DIR, name)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def _save(name, data):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, name)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


DB = {
    "rovers.json":   {},
    "orders.json":   {},
    "deliveries.json": [],
    "events.json":   [],
    "state.json":    {},
}

def load_all():
    DB["rovers.json"] = _load("rovers.json", None)
    DB["orders.json"] = _load("orders.json", {})
    DB["deliveries.json"] = _load("deliveries.json", [])
    DB["events.json"] = _load("events.json", [])
    DB["state.json"] = _load("state.json", None)


def save_all():
    for name, data in DB.items():
        _save(name, data)


def reset_data():
    for name in DB:
        DB[name] = {} if "state" not in name else None
    DB["orders.json"] = {}
    DB["deliveries.json"] = []
    DB["events.json"] = []
    DB["state.json"] = None
    seed_game()
    save_all()
    log_event("game", "База развёрнута заново. Новые сутки начинаются.")


# ----------------------------------------------------------------------------
# Состояние игры
# ----------------------------------------------------------------------------

STATE = None          # dynamic state (credits, rating, clock...)
RAND = random.Random()


def gen_id(prefix):
    return "%s_%d" % (prefix, int(time.time() * 1000) + RAND.randint(0, 9999))


def point_in_poly(px, py, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py) != (yj > py):
            xint = (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi
            if px < xint:
                inside = not inside
        j = i
    return inside


def zone_at(px, py):
    for zid in ZONE_ORDER:
        if point_in_poly(px, py, ZONES[zid]["poly"]):
            return zid
    return None


def dist_km(x0, y0, x1, y1):
    return math.hypot(x1 - x0, y1 - y0) * SCALE_KM


def zone_bonus(zid):
    return ZONES[zid]["bonus"]


def path_profile(x0, y0, x1, y1, weight_kg, rover):
    """Считает полный профиль пути: километраж, время (мин), энергию (Вт*ч)."""
    total_km = dist_km(x0, y0, x1, y1)
    if total_km < 0.01:
        return 0.0, 0.0, 0.0
    n = max(2, int(total_km / 0.25))
    acc_speed = 0.0
    acc_energy = 0.0
    for i in range(n + 1):
        t = i / n
        px = x0 + (x1 - x0) * t
        py = y0 + (y1 - y0) * t
        zid = zone_at(px, py)
        z = ZONES.get(zid, {"speed": 1.0, "energy": 1.0})
        seg = total_km / n
        acc_speed += seg / z["speed"]
        acc_energy += seg * z["energy"] * (rover["base_e"] + rover["kw"] * weight_kg)
    time_min = acc_speed / rover["speed_kmh"] * 60.0  # результат в минутах
    return total_km, time_min, acc_energy


def seed_orders(sample=None):
    """Первичная генерация заказов (включая гарантированные «невозможные»)."""
    orders = DB["orders.json"]
    now = STATE["minute_total"]

    def add(dest_id, weight, urgency_min, reward_mult=1.0):
        oid = gen_id("order")
        out = OUTPOSTS[dest_id]
        zid = zone_at(out["x"], out["y"]) or "maria"
        runtime = now + urgency_min
        orders[oid] = {
            "id": oid,
            "outpost": dest_id,
            "outpost_name": out["name"],
            "zone_id": zid,
            "weight_kg": weight,
            "reward": int(weight * zone_bonus(zid) * reward_mult),
            "urgent": urgency_min,
            "expires_at": runtime,
            "status": "available",
            "zone_risk": ZONES[zid]["risk"],
        }

    # гарантированно «невозможные» сценарии на старте
    add("far_side", 260, 200, 1.4)          # тяжелее любой грузоподъёмности — невыполним
    add("far_side", 70, 60, 2.2)            # срочный и далёкий — на Bumble не хватит батареи
    add("bugtown", 45, 45, 2.0)             # срочный «лёгкий» для Comet
    add("crater_edge", 120, 120, 1.3)
    add("serenity", 90, 160, 1.5)
    add("sanctum_yd", 30, 70, 1.4)
    add("apollo_camp", 150, 180, 1.2)

    log_event("orders", "Радио приняло первичный пакет заказов (%d штук)." % len(orders))


def seed_game():
    global STATE
    STATE = {
        "day": 1,
        "minute_total": 0.0,          # игровые минуты от старта
        "credits": START_CREDITS,
        "rating": START_RATING,
        "ff": False,
        "paused": False,
        "gameover": False,
        "gameover_reason": "",
        "end_after_day": DAYS_TO_SURVIVE,
        "storms": {},                 # zone_id -> минута окончания бури
        "last_storm_check": 0,
    }
    rovers = {}
    for rid, r in ROVERS.items():
        rovers[rid] = {
            "id": rid, "name": r["name"], "model": r["model"],
            "cap_kg": r["cap_kg"], "batt": r["batt"],
            "batt_max": r["batt"], "speed_kmh": r["speed_kmh"],
            "base_e": r["base_e"], "kw": r["kw"],
            "x": OUTPOSTS["base"]["x"], "y": OUTPOSTS["base"]["y"],
            "status": "idle",          # idle | delivering | returning | stranded | maintenance
            "journey": None,
            "done": 0, "failed": 0, "earned": 0,
            "up_kg": 0, "up_batt": 0, "up_speed": 0,
        }
    DB["rovers.json"] = rovers
    DB["state.json"] = STATE
    shop_init()
    seed_orders()


def minute_now():
    return STATE["minute_total"]


def clock_text(total_min):
    m = int(total_min) % 1440
    return "%02d:%02d" % (m // 60, m % 60)


def log_event(kind, text):
    DB["events.json"].append({
        "kind": kind,
        "text": text,
        "minute": int(STATE["minute_total"]),
        "clock": clock_text(STATE["minute_total"]),
        "ts": int(time.time()),
    })
    if len(DB["events.json"]) > 400:
        DB["events.json"] = DB["events.json"][-300:]


# ----------------------------------------------------------------------------
# Симуляция
# ----------------------------------------------------------------------------

def active_storms():
    return {zid: end for zid, end in STATE["storms"].items() if end > STATE["minute_total"]}


def zone_stormy(zid):
    return zid in active_storms()


def resolve_storms():
    """Управление бурями: периодически поражает Radiation Valley, полностью блокируя маршрут."""
    # первая буря — на старте (демонстрация «невозможной» доставки)
    if STATE["last_storm_check"] == 0:
        STATE["storms"]["radiation"] = STATE["minute_total"] + 45
        log_event("storm", "Solar wind burst! Radiation Valley перекрыта на ~45 мин. Доставки туда невозможны.")
    STATE["last_storm_check"] = STATE["minute_total"]
    if RAND.random() < 0.02:   # ~2% в игровую минуту — новая буря куда-нибудь
        target = RAND.choice(["radiation", "crater", "taurus", "apollo"])
        dur = RAND.randint(20, 60)
        STATE["storms"][target] = STATE["minute_total"] + dur
        log_event("storm", "Буря накрыла зону «%s» на %d мин. Маршруты туда заблокированы." % (ZONES[target]["name"], dur))


def spawn_orders_loop():
    """Периодическое появление новых заказов."""
    now = STATE["minute_total"]
    if "next_spawn" not in STATE or now >= STATE["next_spawn"]:
        STATE["next_spawn"] = now + RAND.randint(70, 120)
        active = [o for o in DB["orders.json"].values() if o["status"] == "available"]
        if len(active) < 9:
            n = RAND.randint(1, 2)
            for _ in range(n):
                dest = RAND.choice(DEST_IDS)
                out = OUTPOSTS[dest]
                zid = zone_at(out["x"], out["y"]) or "maria"
                is_urgent = RAND.random() < 0.4
                weight = RAND.randint(6, 230)
                urg = RAND.randint(40, 90) if is_urgent else RAND.randint(150, 400)
                oid = gen_id("order")
                DB["orders.json"][oid] = {
                    "id": oid, "outpost": dest, "outpost_name": out["name"],
                    "zone_id": zid, "weight_kg": weight,
                    "reward": int(weight * zone_bonus(zid)),
                    "urgent": urg, "expires_at": now + urg,
                    "status": "available", "zone_risk": ZONES[zid]["risk"],
                }
            log_event("orders", "Приняты новые заказы радиосвязью.")


def simulate_step(dt_min):
    STATE["minute_total"] += dt_min
    resolve_storms()
    spawn_orders_loop()
    tick_deliveries(dt_min)
    recharge_rovers(dt_min)
    check_orders_expiry()
    shop_tick(dt_min)
    check_day_end()
    if STATE["rating"] <= 0 and not STATE["gameover"]:
        STATE["gameover"] = True
        STATE["gameover_reason"] = "Рейтинг базы упал до нуля. Базу закрыла EarthGov."
    if STATE["day"] > DAYS_TO_SURVIVE and not STATE["gameover"]:
        STATE["gameover"] = True
        STATE["gameover_reason"] = "success"


def recharge_rovers(dt_min):
    for r in DB["rovers.json"].values():
        if r["status"] == "idle" and dist_km(r["x"], r["y"], OUTPOSTS["base"]["x"], OUTPOSTS["base"]["y"]) < 1:
            hour_min = int(STATE["minute_total"]) % 1440
            night = hour_min < 360 or hour_min >= 1200
            rate = 3.0 if night else 7.0
            r["batt"] = min(r["batt_max"], r["batt"] + rate * dt_min)


def check_orders_expiry():
    now = STATE["minute_total"]
    for o in list(DB["orders.json"].values()):
        if o["status"] == "available" and o["expires_at"] <= now:
            o["status"] = "expired"
            STATE["rating"] = max(0, STATE["rating"] - 4)
            log_event("orders", "Заказ %s (%.0f кг → %s) сгорел. Награда упущена, рейтинг -4." %
                      (o["id"], o["weight_kg"], o["outpost_name"]))


def estimate_mission(order, rover):
    """Проверяет и считает миссию. Возвращает (ok, reason, profile)."""
    r = DB["rovers.json"][rover]
    if r["status"] != "idle":
        return False, "Ровер занят (%s)." % r["status"], None
    if dist_km(r["x"], r["y"], OUTPOSTS["base"]["x"], OUTPOSTS["base"]["y"]) > 1:
        return False, "Ровер должен находиться на базе для загрузки.", None
    if zone_stormy(order["zone_id"]):
        return False, "Зона заказчика перекрыта бурей. Доставка невозможна сейчас.", None
    if order["weight_kg"] > r["cap_kg"]:
        return False, "Вес груза (%.0f кг) превышает грузоподъёмность ровера (%.0f кг)." % (order["weight_kg"], r["cap_kg"]), None
    cfg = {"speed_kmh": r["speed_kmh"], "base_e": r.get("base_e", 1.2), "kw": r.get("kw", 0.004)}
    prof = path_profile(r["x"], r["y"], OUTPOSTS[order["outpost"]]["x"], OUTPOSTS[order["outpost"]]["y"],
                        order["weight_kg"], cfg)
    out_km, out_min, out_e = prof
    total_e = out_e * 2           # туда и обратно
    if total_e > r["batt"] + REQ_BATTERY_EPS:
        return False, ("Не хватит батареи: требуется %.0f Вт*ч, у ровера %.0f Вт*ч (включая обратный путь)." %
                       (total_e, r["batt"])), None
    return True, "", {"out_km": out_km, "out_min": out_min, "out_e": out_e, "total_e": total_e}


def launch(rover_id, order_id):
    order = DB["orders.json"].get(order_id)
    if not order or order["status"] != "available":
        return {"ok": False, "error": "Заказ недоступен."}
    ok, reason, prof = estimate_mission(order, rover_id)
    if not ok:
        return {"ok": False, "error": reason}
    r = DB["rovers.json"][rover_id]
    r["status"] = "delivering"
    r["journey"] = {
        "order_id": order_id,
        "outpost": order["outpost"],
        "phase": "out",
        "progress": 0.0,
        "leg_spent": 0.0,
        "start_minute": STATE["minute_total"],
        "out_min": prof["out_min"],
        "out_e": prof["out_e"],
        "e_spent": 0.0,
        "speed_penalty": 1.0,
        "events": 0,
        "batt_at_start": r["batt"],
        "base_x": OUTPOSTS["base"]["x"],
        "base_y": OUTPOSTS["base"]["y"],
    }
    order["status"] = "in_transit"
    order["rover_id"] = rover_id
    log_event("mission", "%s берёт заказ %s (%.0f кг → %s, награда %d). Маршрут: ~%.0f км, ~%.0f мин, %.0f Вт*ч." %
              (r["name"], order["id"], order["weight_kg"], order["outpost_name"], order["reward"],
               prof["out_km"], prof["out_min"] * 2, prof["total_e"]))
    save_all()
    return {"ok": True}


def tick_deliveries(dt_min):
    for r in DB["rovers.json"].values():
        j = r["journey"]
        if not j or r["status"] not in ("delivering", "returning"):
            continue
        out = OUTPOSTS[j["outpost"]]
        bx, by = j["base_x"], j["base_y"]
        remaining = dt_min
        guard = 0
        while remaining > 0.0001 and r["status"] in ("delivering", "returning") and guard < 6:
            guard += 1
            phase_left_min = max(0.0, (1.0 - j["progress"]) * j["out_min"])
            used = min(remaining, phase_left_min)
            frac = (used / j["out_min"]) if j["out_min"] > 0 else 1.0
            j["progress"] += frac
            j["leg_spent"] += j["out_e"] * frac
            j["e_spent"] += j["out_e"] * frac
            r["batt"] = max(0.0, j["batt_at_start"] - j["e_spent"])
            remaining -= used
            # позиция по текущей фазе
            if j["phase"] == "out":
                r["x"] = bx + (out["x"] - bx) * j["progress"]
                r["y"] = by + (out["y"] - by) * j["progress"]
            else:
                r["x"] = out["x"] + (bx - out["x"]) * j["progress"]
                r["y"] = out["y"] + (by - out["y"]) * j["progress"]
            if r["batt"] <= 0:
                strand(r, j)
                break
            if j["progress"] >= 1.0 - 1e-9:
                if j["phase"] == "out":
                    finish_delivery(r, j)
                else:
                    r["journey"] = None
                    r["status"] = "maintenance" if r["batt"] < 5 else "idle"
                    r["x"], r["y"] = bx, by
                    if r["batt"] < 5:
                        log_event("mission", "%s вернулся почти без заряда — на техобслуживании." % r["name"])
                    break
        maybe_event(r, j, dt_min)


def interpolate(phase, progress, out, r):
    bx, by = OUTPOSTS["base"]["x"], OUTPOSTS["base"]["y"]
    if phase == "out":
        return bx + (out["x"] - bx) * progress, by + (out["y"] - by) * progress
    return out["x"] + (bx - out["x"]) * progress, out["y"] + (by - out["y"]) * progress


def maybe_event(r, j, dt_min):
    px, py = r["x"], r["y"]
    zid = zone_at(px, py)
    z = ZONES.get(zid, {"risk": 0.05})
    # риск за минуту
    p = z["risk"] * dt_min * 0.02
    if RAND.random() > p:
        return
    j["events"] += 1
    name = r["name"]
    roll = RAND.random()
    if zid == "radiation" and RAND.random() < 0.35:
        log_event("hazard", "[%s] Радиационная вспышка! -15 Вт*ч." % name)
        r["batt"] = max(0.0, r["batt"] - 15)
        return
    if roll < 0.30:
        log_event("hazard", "[%s] Лунная пыль налипла на редукторы — расход +20%% (10 мин)." % name)
        r["batt"] = max(0.0, r["batt"] - (r["batt_max"] * 0.05))
        j["out_min"] += 10
    elif roll < 0.55:
        log_event("hazard", "[%s] Валун перекрыл путь — объезд (+25%% времени)." % name)
        j["out_min"] += max(1, j["out_min"] * 0.25)
        r["batt"] = max(0.0, r["batt"] - (r["batt_max"] * 0.10))
    elif roll < 0.75 and z["risk"] > 0.30:
        log_event("hazard", "[%s] Метеорит мимо. ЭМИ встряхнуло электронику (-12 Вт*ч)." % name)
        r["batt"] = max(0.0, r["batt"] - 12)
    elif roll < 0.92 and z["risk"] > 0.50:
        log_event("hazard", "[%s] Повреждён привод колеса — скорость -35%%." % name)
        j["speed_penalty"] = 0.65
        j["out_min"] /= 0.65
    else:
        log_event("hazard", "[%s] Контакт с породой — ось зажало, скорость -40%%." % name)
        j["speed_penalty"] = 0.60
        j["out_min"] /= 0.60
    if r["batt"] <= 0:
        strand(r, j)


def strand(r, j):
    r["status"] = "stranded"
    order = DB["orders.json"].get(j["order_id"])
    if order:
        order["status"] = "available"
        order["expires_at"] = STATE["minute_total"] + 30
    STATE["rating"] = max(0, STATE["rating"] - 8)
    log_event("hazard", "[%s] Батарея разряжена в пути. Ровер застрял. Заказ возвращён в очередь, рейтинг -8." % r["name"])
    save_all()


def finish_delivery(r, j):
    order = DB["orders.json"].get(j["order_id"])
    on_time = STATE["minute_total"] <= order["expires_at"]
    reward = order["reward"] + (int(order["reward"] * 0.05) if on_time else 0)
    STATE["credits"] += reward
    r["earned"] += reward
    r["done"] += 1
    r["status"] = "returning"
    j["phase"] = "returning"
    j["progress"] = 0.0
    order["status"] = "delivered"
    order["delivered_at"] = STATE["minute_total"]
    order["reward_earned"] = reward
    if on_time:
        STATE["rating"] = min(100, STATE["rating"] + 2)
        log_event("delivery", "Доставка %s завершена вовремя! +%d кредитов, рейтинг +2." % (r["name"], reward))
    else:
        STATE["rating"] = max(0, STATE["rating"] - 4)
        reward_late = int(reward / 2)
        log_event("delivery", "Доставка %s задержана: +%d (половина). Рейтинг -4." % (r["name"], reward_late))
    # запись в историю доставок
    DB["deliveries.json"].append({
        "order_id": order["id"],
        "rover": r["id"],
        "dest": order["outpost_name"],
        "weight_kg": order["weight_kg"],
        "reward": reward,
        "on_time": on_time,
        "start_minute": j["start_minute"],
        "end_minute": STATE["minute_total"],
        "events": j["events"],
        "batt_start": j["batt_at_start"],
        "batt_end": r["batt"],
    })
    save_all()


def check_day_end():
    day_new = int(STATE["minute_total"] // 1440) + 1
    if day_new > STATE["day"]:
        old_day = STATE["day"]
        STATE["day"] = min(day_new, DAYS_TO_SURVIVE + 1)
        log_event("day", "День %d завершён. Кредиты: %d, рейтинг: %d." % (old_day, STATE["credits"], STATE["rating"]))


# ----------------------------------------------------------------------------
# Действия игрока
# ----------------------------------------------------------------------------

def action_cmd(name, payload):
    if name == "reset":
        reset_data()
        return {"ok": True}
    if STATE.get("gameover"):
        return {"ok": False, "error": "Игра окончена. Нажмите «Новая игра»."}
    if name == "launch":
        return launch(payload.get("rover_id"), payload.get("order_id"))
    if name == "rush_charge":
        rid = payload.get("rover_id")
        r = DB["rovers.json"].get(rid)
        if not r or r["status"] != "idle":
            return {"ok": False, "error": "Ровер должен быть свободен."}
        to_fill = r["batt_max"] - r["batt"]
        cost = int(math.ceil(to_fill / 2))
        if cost > STATE["credits"]:
            return {"ok": False, "error": "Не хватает кредитов (%d нужен, есть %d)." % (cost, STATE["credits"])}
        STATE["credits"] -= cost
        r["batt"] = r["batt_max"]
        log_event("mission", "Экстренная зарядка %s: -%d кредитов, батарея 100%%." % (r["name"], cost))
        save_all()
        return {"ok": True}
    if name == "recover":
        rid = payload.get("rover_id")
        r = DB["rovers.json"].get(rid)
        if not r or r["status"] != "stranded":
            return {"ok": False, "error": "Ровер не застрял."}
        dist = dist_km(r["x"], r["y"], OUTPOSTS["base"]["x"], OUTPOSTS["base"]["y"])
        cost = int(15 + dist * 0.6)
        if cost > STATE["credits"]:
            return {"ok": False, "error": "Эвакуация стоит %d, у вас %d. Нужны кредиты." % (cost, STATE["credits"])}
        STATE["credits"] -= cost
        STATE["rating"] = max(0, STATE["rating"] - 3)
        r["status"] = "maintenance"
        r["batt"] = 15
        r["x"], r["y"] = OUTPOSTS["base"]["x"], OUTPOSTS["base"]["y"]
        r["journey"] = None
        log_event("mission", "Эвакуация %s: -%d кредитов. Рейтинг -3." % (r["name"], cost))
        save_all()
        return {"ok": True}
    if name == "fast_forward":
        STATE["ff"] = bool(payload.get("on"))
        return {"ok": True}
    if name == "pause":
        on = payload.get("on")
        STATE["paused"] = bool(payload.get("on")) if on is not None else not STATE.get("paused", False)
        return {"ok": True, "paused": STATE["paused"]}
    if name == "upgrade":
        rid = payload.get("rover_id")
        r = DB["rovers.json"].get(rid)
        if not r or r["status"] != "idle":
            return {"ok": False, "error": "Улучшать можно только свободный ровер на базе."}
        plan = next((u for u in UPGRADES if u["key"] == payload.get("stat")), None)
        if not plan:
            return {"ok": False, "error": "Неизвестная характеристика."}
        lvl = r.get(plan["key"], 0)
        if lvl >= len(plan["costs"]):
            return {"ok": False, "error": "Характеристика уже макс. уровня."}
        cost = plan["costs"][lvl]
        if cost > STATE["credits"]:
            return {"ok": False, "error": "Не хватает кредитов (%d нужен, есть %d)." % (cost, STATE["credits"])}
        STATE["credits"] -= cost
        r[plan["key"]] = lvl + 1
        r[plan["prop"]] = round(r[plan["prop"]] + plan["delta"])
        log_event("mission", "%s: улучшение «%s» %s%d → +%d %s. −%d₵" %
                  (r["name"], plan["label"], plan["icon"], lvl + 1, plan["delta"],
                   plan["label"], cost))
        save_all()
        return {"ok": True}
    if name == "buy_rover":
        shop_id = payload.get("shop_id")
        slot = next((s for s in STATE["shop"] if s["id"] == shop_id), None)
        if not slot:
            return {"ok": False, "error": "Этой модели больше нет в продаже — витрина обновилась."}
        total_done = sum(x["done"] for x in DB["rovers.json"].values())
        if total_done < slot["min_done"]:
            return {"ok": False, "error": "Доступно после %d выполненных доставок (сейчас %d)." % (slot["min_done"], total_done)}
        if slot["cost"] > STATE["credits"]:
            return {"ok": False, "error": "Не хватает кредитов (%d нужен, есть %d)." % (slot["cost"], STATE["credits"])}
        STATE["credits"] -= slot["cost"]
        m = slot
        rid = gen_id("rover")
        DB["rovers.json"][rid] = {
            "id": rid, "name": m["name"], "model": m["model"],
            "cap_kg": m["cap_kg"], "batt": m["batt"], "batt_max": m["batt"],
            "speed_kmh": m["speed_kmh"], "base_e": m["base_e"], "kw": m["kw"],
            "x": OUTPOSTS["base"]["x"], "y": OUTPOSTS["base"]["y"],
            "status": "idle", "journey": None,
            "done": 0, "failed": 0, "earned": 0,
            "up_kg": 0, "up_batt": 0, "up_speed": 0,
        }
        STATE["shop"].remove(slot)
        STATE["shop"].append(roll_model(total_done))  # витрина не пустеет
        log_event("mission", "Во флот прибыл новый ровер %s «%s» (%d кг, %d км/ч). −%d₵" %
                  (m["name"], m["model"], m["cap_kg"], m["speed_kmh"], m["cost"]))
        save_all()
        return {"ok": True}
    return {"ok": False, "error": "Неизвестная команда."}


# ----------------------------------------------------------------------------
# Таймер симуляции
# ----------------------------------------------------------------------------

def sim_loop():
    lock = threading.Lock()
    last_save = 0.0
    while True:
        dt_real = 0.25
        time.sleep(dt_real)
        dt_min = GAME_MIN_PER_SEC * dt_real * (FF_MULT if STATE and STATE["ff"] else 1.0)
        if STATE and not STATE["gameover"] and not STATE.get("paused"):
            with lock:
                simulate_step(dt_min)
                now = time.time()
                if now - last_save >= 1.0:
                    save_all()
                    last_save = now


# ----------------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------------

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body=b"", ctype="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _public_file(self, rel):
        path = os.path.normpath(os.path.join(PUBLIC_DIR, rel))
        if not path.startswith(PUBLIC_DIR) or not os.path.isfile(path):
            self._send(404, b"not found", "text/plain; charset=utf-8")
            return
        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as f:
            self._send(200, f.read(), MIME.get(ext, "application/octet-stream"))

    def do_GET(self):
        parsed = urlparse(self.path)
        p = parsed.path
        if p == "/api/state":
            self._json(public_state())
        elif p == "/" or p == "/index.html":
            self._public_file("index.html")
        elif p.startswith("/static/"):
            self._public_file(p[len("/static/"):])
        else:
            self._send(404, json.dumps({"error": "no route"}))

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/cmd":
            self._send(404, json.dumps({"error": "no route"}))
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            self._json({"ok": False, "error": "bad json"}, 400)
            return
        name = payload.get("cmd")
        resp = action_cmd(name, payload.get("payload", {}))
        self._json(resp)

    def log_message(self, *a):
        pass


def _ensure_initialized():
    """Возвращает (ok, reason): инициализированы ли данные игры."""
    if DB["rovers.json"] and DB["state.json"]:
        return True, ""
    if not DB["rovers.json"] and DB["state.json"] is None:
        return True, ""
    return False, "state missing"


def public_state():
    rovers = [dict(r) for r in DB["rovers.json"].values()]
    for r in rovers:
        if r.get("journey"):
            j = r["journey"]
            label = "out" if j["phase"] == "out" else "return"
            r["phase_label"] = ("в путь" if j["phase"] == "out" else "обратно")
            r["progress"] = round(j["progress"], 3)
            r["e_spent"] = round(j["e_spent"], 1)
            r["trip_est_min"] = int(j["out_min"] * 2)
    orders = sorted(DB["orders.json"].values(), key=lambda o: o["expires_at"])
    storms = {k: int(v) for k, v in STATE["storms"].items() if v > STATE["minute_total"]}
    total_done = sum(x["done"] for x in DB["rovers.json"].values())
    fleet_shop = [dict(s, unlocked=total_done >= s["min_done"]) for s in STATE["shop"]]
    return {
        "ok": True,
        "time": {
            "day": STATE["day"],
            "clock": clock_text(STATE["minute_total"]),
            "minute_total": STATE["minute_total"],
            "ff": STATE["ff"],
            "paused": STATE.get("paused", False),
            "days_total": DAYS_TO_SURVIVE,
        },
        "credits": STATE["credits"],
        "rating": STATE["rating"],
        "gameover": STATE["gameover"],
        "gameover_reason": STATE["gameover_reason"],
        "zones": {k: dict(v) for k, v in ZONES.items()},
        "zone_order": ZONE_ORDER,
        "outposts": OUTPOSTS,
        "rovers": rovers,
        "orders": orders,
        "storms": storms,
        "events": list(reversed(DB["events.json"][-40:])),
        "deliveries": list(reversed(DB["deliveries.json"][-15:])),
        "upgrade_plan": UPGRADES,
        "fleet_shop": fleet_shop,
        "total_done": total_done,
        "config": {"rcost_per_wh": 0.5},
    }


# ----------------------------------------------------------------------------
# Основной запуск
# ----------------------------------------------------------------------------

def main(port=8000):
    global STATE
    load_all()
    if DB["rovers.json"] is None or DB["state.json"] is None:
        seed_game()
        save_all()
    else:
        STATE = DB["state.json"]
        if STATE and STATE.get("gameover"):
            log_event("game", "Предыдущая партия была завершена — база развёрнута заново.")
            reset_data()
        else:
            shop_init()  # витрина для старых сейвов
    t = threading.Thread(target=sim_loop, daemon=True)
    t.start()
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("Moon Courier Simulator запущен:  http://localhost:%d/" % port)
    print("Ctrl+C — остановить. Данные сохраняются в data/*.json")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановка...")
        save_all()


if __name__ == "__main__":
    import sys
    p = 8000
    if len(sys.argv) > 1:
        p = int(sys.argv[1])
    main(p)