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
import sys
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
GAME_MIN_PER_SEC = 2.0   # 1 реальная секунда = 2 игровые минуты (день ≈ 12 минут)
FF_MULT = 5.0            # множитель при ускорении
DAYS_TO_SURVIVE = 7
START_RATING = 80
START_CREDITS = 120
REQ_BATTERY_EPS = 0.5    # запас при проверке батареи

# Характеристики зон (полигоны генерируются случайно при старте — см. gen_world)
ZONE_META = {
    "maria":     {"name": "Maria Plain",       "speed": 1.00, "risk": 0.06, "energy": 1.00, "bonus": 1.00, "color": "#4a6b8a"},
    "crater":    {"name": "Crater Field",      "speed": 0.75, "risk": 0.28, "energy": 1.35, "bonus": 1.15, "color": "#6b5b4a"},
    "taurus":    {"name": "Taurus Highlands",  "speed": 0.60, "risk": 0.50, "energy": 1.50, "bonus": 1.40, "color": "#5a4a6b"},
    "radiation": {"name": "Radiation Valley",  "speed": 0.85, "risk": 0.80, "energy": 1.15, "bonus": 1.60, "color": "#6b4a4a"},
    "sanctum":   {"name": "Sanctum Ridge",     "speed": 0.90, "risk": 0.12, "energy": 1.00, "bonus": 1.05, "color": "#3f6b5a"},
    "apollo":    {"name": "Apollo Basin",      "speed": 0.95, "risk": 0.18, "energy": 1.05, "bonus": 1.10, "color": "#6b5a3f"},
}
ZONE_ORDER = ["maria", "crater", "taurus", "radiation", "sanctum", "apollo"]

ZONES = {}      # заполняется gen_world()
CRATERS = []    # заполняется gen_world()


def gen_world(rand):
    """Генерирует случайную мозаику зон (общие ломаные границы) и кратеры.
    Топология — 3 колонны (taurus+sanctum / crater+maria / radiation+apollo),
    в каждой колонне верх/низ разделён ломаной. Каждая зона соседствует с
    обходной колонной, поэтому буря в одной зоне не блокирует весь маршрут."""
    def jit(v, a):
        return v + rand.uniform(-a, a)

    # вертикальные границы колонн (x≈345 и x≈560) — общие для соседей
    v1 = [(345, 0), (jit(345, 22), 80), (jit(345, 22), 160), (jit(345, 22), 230),
          (jit(345, 22), 320), (jit(345, 22), 350), (jit(345, 22), 400),
          (jit(345, 22), 480), (jit(345, 22), 560), (jit(345, 22), 640), (345, 700)]
    v2 = [(560, 0), (jit(560, 22), 80), (jit(560, 22), 160), (jit(560, 22), 230),
          (jit(560, 22), 320), (jit(560, 22), 440), (jit(560, 22), 480),
          (jit(560, 22), 560), (jit(560, 22), 640), (560, 700)]
    # горизонтальные границы внутри колонн (концы — точно на вертикальных)
    h1 = [(0, jit(350, 22)), (jit(90, 26), 420), (jit(190, 26), 330), (jit(280, 26), 380),
          (v1[5][0], 350)]                       # taurus|sanctum
    h2 = [(v1[5][0], 350), (jit(430, 26), 470), (jit(430, 26), 420), (jit(430, 26), 460),
          (v2[5][0], 440)]                       # crater|maria
    h3 = [(v2[5][0], 440), (jit(700, 26), 470), (jit(790, 26), 420), (jit(880, 26), 460),
          (1000, jit(440, 22))]                  # radiation|apollo

    zones = {
        "taurus": [(0, 0), (345, 0), (v1[1][0], 80), (v1[2][0], 160), (v1[3][0], 230),
                   (v1[4][0], 320), (v1[5][0], 350),
                   (h1[3][0], 380), (h1[2][0], 330), (h1[1][0], 420), (0, h1[0][1])],
        "sanctum": [(0, h1[0][1]), (h1[1][0], 420), (h1[2][0], 330), (h1[3][0], 380),
                    (v1[5][0], 350), (v1[6][0], 400), (v1[7][0], 480), (v1[8][0], 560),
                    (v1[9][0], 640), (345, 700), (0, 700)],
        "crater": [(345, 0), (560, 0), (v2[1][0], 80), (v2[2][0], 160), (v2[3][0], 230),
                   (v2[4][0], 320), (v2[5][0], 440),
                   (h2[3][0], 460), (h2[2][0], 420), (h2[1][0], 470), (v1[5][0], 350),
                   (v1[4][0], 320), (v1[3][0], 230), (v1[2][0], 160), (v1[1][0], 80)],
        "maria": [(v1[5][0], 350), (h2[1][0], 470), (h2[2][0], 420), (h2[3][0], 460),
                  (v2[5][0], 440), (v2[6][0], 480), (v2[7][0], 560), (v2[8][0], 640),
                  (560, 700), (345, 700),
                  (v1[9][0], 640), (v1[8][0], 560), (v1[7][0], 480), (v1[6][0], 400)],
        "radiation": [(560, 0), (1000, 0), (1000, h3[4][1]), (h3[3][0], 460),
                      (h3[2][0], 420), (h3[1][0], 470), (v2[5][0], 440),
                      (v2[4][0], 320), (v2[3][0], 230), (v2[2][0], 160), (v2[1][0], 80)],
        "apollo": [(v2[5][0], 440), (h3[1][0], 470), (h3[2][0], 420), (h3[3][0], 460),
                   (1000, h3[4][1]), (1000, 700), (560, 700),
                   (v2[8][0], 640), (v2[7][0], 560), (v2[6][0], 480)],
    }
    zones = {k: dict(ZONE_META[k], poly=[(round(x, 1), round(y, 1)) for (x, y) in poly])
             for k, poly in zones.items()}

    # кратеры: случайно, но не мешая базе и форпостам
    craters = []
    tries = 0
    outposts = list(OUTPOSTS.values())
    while len(craters) < 32 and tries < 500:
        tries += 1
        x = rand.uniform(25, 975)
        y = rand.uniform(25, 675)
        r = rand.uniform(8, 38)
        if math.hypot(x - 500, y - 660) < 95 + r:
            continue
        if any(math.hypot(x - o["x"], y - o["y"]) < 55 + r for o in outposts):
            continue
        if any(math.hypot(x - cx, y - cy) < r + cr + 22 for (cx, cy, cr) in craters):
            continue
        craters.append((round(x, 1), round(y, 1), round(r, 1)))
    return zones, craters


def apply_world(zones, craters):
    global ZONES, CRATERS
    ZONES = zones
    CRATERS = craters

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
SHOP_REFRESH_MIN = (10, 20)     # игровые минуты между ротациями слота витрины
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
    """Периодически заменяет слоты витрины свежими моделями."""
    if STATE["minute_total"] < STATE.get("shop_next", 1 << 30):
        return
    total = sum(x["done"] for x in DB["rovers.json"].values())
    for _ in range(2):  # обновляем два слота за раз
        i = RAND.randrange(len(STATE["shop"]))
        old = STATE["shop"][i]
        STATE["shop"][i] = roll_model(total)
        log_event("mission", "Верфь обновила витрину: «%s %s» (%.0f кг, %d км/ч) — %d$. Осталась: «%s»."
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
    """Сохраняет файл. OneDrive может держать файл — пробуем повторно и отступаем к прямой записи."""
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, name)
    tmp = path + ".tmp"
    for attempt in range(3):
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
            return
        except OSError:
            time.sleep(0.3)
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except OSError:
        pass


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


# ----------------------------------------------------------------------------
# Маршруты: объезд кратеров и активных бурь (A* по сетке)
# ----------------------------------------------------------------------------

# Кратеры генерируются в gen_world() (CRATERS) — совпадают с отрисовкой клиента
PATH_GRID = 25.0           # шаг сетки, px
PATH_CLEAR = 12.0          # запас вокруг кратера/бури, px


def _cell_center(ci, cj):
    return (ci * PATH_GRID + PATH_GRID / 2, cj * PATH_GRID + PATH_GRID / 2)


def _cell_blocked(ci, cj, storm_polys):
    cx, cy = _cell_center(ci, cj)
    for (x, y, r) in CRATERS:
        if math.hypot(cx - x, cy - y) < r + PATH_CLEAR:
            return True
    for poly in storm_polys:
        if point_in_poly(cx, cy, poly):
            return True
    return False


def _seg_clear(x0, y0, x1, y1, storm_polys):
    """Проверяет, что отрезок не пересекает кратеры и бури."""
    d = math.hypot(x1 - x0, y1 - y0)
    n = max(1, int(d / 8))
    for i in range(n + 1):
        t = i / n
        px = x0 + (x1 - x0) * t
        py = y0 + (y1 - y0) * t
        for (x, y, r) in CRATERS:
            if math.hypot(px - x, py - y) < r + PATH_CLEAR - 4:
                return False
        for poly in storm_polys:
            if point_in_poly(px, py, poly):
                return False
    return True


def _nearest_free(ci, cj, cols, rows, storm_polys):
    """Ближайшая свободная клетка (если старт/цель в препятствии)."""
    if not _cell_blocked(ci, cj, storm_polys):
        return (ci, cj)
    for r in range(1, max(cols, rows)):
        for di in range(-r, r + 1):
            for dj in (-r, r):
                ni, nj = ci + di, cj + dj
                if 0 <= ni < cols and 0 <= nj < rows and not _cell_blocked(ni, nj, storm_polys):
                    return (ni, nj)
        for dj in range(-r + 1, r):
            for di in (-r, r):
                ni, nj = ci + di, cj + dj
                if 0 <= ni < cols and 0 <= nj < rows and not _cell_blocked(ni, nj, storm_polys):
                    return (ni, nj)
    return (ci, cj)


def _a_star(x0, y0, x1, y1, storm_polys):
    """Ищет путь вокруг препятствий. Возвращает список клеток (ci, cj) или None."""
    cols = int(round(1000.0 / PATH_GRID))
    rows = int(round(700.0 / PATH_GRID))
    def cell(x): return int(min(max(x / PATH_GRID, 0), cols - 1))
    s = _nearest_free(cell(x0), cell(y0), cols, rows, storm_polys)
    e = _nearest_free(cell(x1), cell(y1), cols, rows, storm_polys)
    if s == e:
        return [s]
    import heapq
    def h(ci, cj): return math.hypot(ci - e[0], cj - e[1])
    g = {s: 0.0}
    prev = {}
    open_heap = [(h(*s), 0.0, s)]
    closed = set()
    while open_heap:
        _, gc, cur = heapq.heappop(open_heap)
        if cur in closed:
            continue
        closed.add(cur)
        if cur == e:
            break
        for di, dj, w in ((1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1),
                          (1, 1, 1.414), (1, -1, 1.414), (-1, 1, 1.414), (-1, -1, 1.414)):
            ni, nj = cur[0] + di, cur[1] + dj
            if ni < 0 or nj < 0 or ni >= cols or nj >= rows:
                continue
            nxt = (ni, nj)
            if nxt in closed or _cell_blocked(ni, nj, storm_polys):
                continue
            ng = gc + w
            if ng < g.get(nxt, 1e18):
                g[nxt] = ng
                prev[nxt] = cur
                heapq.heappush(open_heap, (ng + h(ni, nj), ng, nxt))
    if e not in g:
        return None
    path = []
    cur = e
    while cur in prev:
        path.append(cur)
        cur = prev[cur]
    path.append(s)
    path.reverse()
    return path


def _smooth_path(path, storm_polys):
    """Превращает клетки A* в полилинию точек и убирает лишние углы."""
    if not path:
        return []
    pts = [_cell_center(ci, cj) for (ci, cj) in path]
    if len(pts) <= 2:
        return pts
    # «спрямление»: убираем точки, если отрезок вокруг не пересекает препятствия
    res = [pts[0]]
    i = 0
    while i < len(pts) - 1:
        j = len(pts) - 1
        while j > i + 1:
            if _seg_clear(pts[i][0], pts[i][1], pts[j][0], pts[j][1], storm_polys):
                break
            j -= 1
        res.append(pts[j])
        i = j
    return res


def route_points(x0, y0, x1, y1):
    """Полилиния маршрута от (x0,y0) к (x1,y1) с объездом кратеров и активных бурь."""
    storms = active_storms()
    storm_polys = [ZONES[zid]["poly"] for zid in storms]
    direct = [(x0, y0), (x1, y1)]
    if _seg_clear(x0, y0, x1, y1, storm_polys):
        return direct
    path = _a_star(x0, y0, x1, y1, storm_polys)
    if not path:
        return direct
    pts = _smooth_path(path, storm_polys)
    pts[0] = (x0, y0)
    pts[-1] = (x1, y1)
    return pts


def _seg_lens(pts):
    out = []
    for i in range(len(pts) - 1):
        out.append(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]))
    return out


def point_along(pts, seg_lens, frac):
    """Точка на полилинии на доле frac её полной длины."""
    total = sum(seg_lens)
    if total <= 0:
        return pts[0]
    tgt = frac * total
    acc = 0.0
    for i in range(len(seg_lens)):
        d = seg_lens[i]
        if acc + d >= tgt and d > 0:
            u = (tgt - acc) / d
            return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u,
                    pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u)
        acc += d
    return pts[-1]


def zone_bonus(zid):
    return ZONES[zid]["bonus"]


def path_profile(x0, y0, x1, y1, weight_kg, rover):
    """Считает полный профиль пути с объездом кратеров и бурь.
    Возвращает (total_km, time_min, acc_energy, pts)."""
    pts = route_points(x0, y0, x1, y1)
    lens = _seg_lens(pts)
    total_km = sum(lens) * SCALE_KM
    if total_km < 0.01:
        return 0.0, 0.0, 0.0, pts
    n = max(2, int(total_km / 0.25))
    acc_speed = 0.0
    acc_energy = 0.0
    for i in range(n + 1):
        px, py = point_along(pts, lens, i / n)
        zid = zone_at(px, py)
        z = ZONES.get(zid, {"speed": 1.0, "energy": 1.0})
        seg = total_km / n
        acc_speed += seg / z["speed"]
        acc_energy += seg * z["energy"] * (rover["base_e"] + rover["kw"] * weight_kg)
    time_min = acc_speed / rover["speed_kmh"] * 60.0  # результат в минутах
    return total_km, time_min, acc_energy, pts


def seed_orders(sample=None):
    """Первичная генерация заказов.

    Ровно один гарантированно «невозможный» (260 кг > любого ровера) — это
    обязательный по ТЗ сценарий «доставка невозможна». Остальные подобраны
    так, чтобы стартовый флот (Bumble 80 кг / Comet 40 кг / Atlas 250 кг)
    реально мог их доставить: вес ≤ грузоподъёмности и окно ≥ времени пути."""
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

    # демонстрация «невозможной доставки»: тяжелее любой грузоподъёмности
    add("far_side", 260, 240, 1.4)
    # выполнимые стартовые заказы (окно с запасом на реальное время пути)
    add("bugtown", 45, 100, 2.0)        # Bumble: туда-обратно ~54 мин
    add("crater_edge", 70, 120, 1.3)    # Bumble: ~109 мин
    add("serenity", 35, 160, 1.5)       # только Comet: ~133 мин
    add("sanctum_yd", 30, 80, 1.4)      # Comet: ~67 мин
    add("apollo_camp", 60, 130, 1.2)    # Bumble: ~112 мин
    add("bugtown", 20, 90, 2.0)         # быстрый «разогрев» для любого ровера

    log_event("orders", "Радио приняло первичный пакет заказов (%d штук)." % len(orders))


def seed_game():
    global STATE
    zones, craters = gen_world(RAND)
    apply_world(zones, craters)
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
        "zones": zones,               # случайный мир этой партии
        "craters": craters,
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
    """Периодическое появление новых заказов.
    Срок всегда с запасом на доставку: если окно меньше, чем реально нужно
    самому быстрому роверу на этот пункт, заказ был бы гарантированно
    невыполним — такие не генерируются (кроме намеренно «невозможных» в seed_orders)."""
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
                # минимально необходимое время на доставку самому быстрому роверу
                fastest = max(DB["rovers.json"].values(), key=lambda r: r["speed_kmh"])
                cfg = {"speed_kmh": fastest["speed_kmh"], "base_e": 1.2, "kw": 0.004}
                _, rt_min, _, _ = path_profile(OUTPOSTS["base"]["x"], OUTPOSTS["base"]["y"],
                                               out["x"], out["y"], 0, cfg)
                min_window = int(rt_min * 2 * 1.5) + 25   # туда-обратно + запас на события
                urg = max(urg, min_window)
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
        log_event("game", "База закрыта EarthGov: рейтинг пал до нуля. Партия окончена.")
    if STATE["day"] > DAYS_TO_SURVIVE and not STATE["gameover"]:
        STATE["gameover"] = True
        STATE["gameover_reason"] = "success"
        log_event("game", "Прогон завершён — база устояла 7 дней. Условия контракта выполнены.")


def recharge_rovers(dt_min):
    for r in DB["rovers.json"].values():
        if r["status"] not in ("idle", "maintenance"):
            continue
        if dist_km(r["x"], r["y"], OUTPOSTS["base"]["x"], OUTPOSTS["base"]["y"]) < 1:
            hour_min = int(STATE["minute_total"]) % 1440
            night = hour_min < 360 or hour_min >= 1200
            rate = 3.0 if night else 7.0
            r["batt"] = min(r["batt_max"], r["batt"] + rate * dt_min)
            if r["status"] == "maintenance" and r["batt"] >= 30:
                r["status"] = "idle"
                log_event("mission", "%s завершил техобслуживание и снова готов к работе." % r["name"])


def check_orders_expiry():
    now = STATE["minute_total"]
    for o in list(DB["orders.json"].values()):
        if o["status"] == "available" and o["expires_at"] <= now:
            o["status"] = "expired"
            STATE["rating"] = max(0, STATE["rating"] - 2)
            log_event("orders", "Заказ %s (%.0f кг → %s) сгорел. Награда упущена, рейтинг -2." %
                      (o["id"], o["weight_kg"], o["outpost_name"]))


def estimate_mission(order, rover):
    """Проверяет и считает миссию. Возвращает (ok, reason, profile)."""
    r = DB["rovers.json"][rover]
    if r["status"] not in ("idle", "maintenance"):
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
    out_km, out_min, out_e, pts = prof
    total_e = out_e * 2           # туда и обратно
    if total_e > r["batt"] + REQ_BATTERY_EPS:
        return False, ("Не хватит батареи: требуется %.0f Вт*ч, у ровера %.0f Вт*ч (включая обратный путь)." %
                       (total_e, r["batt"])), None
    return True, "", {"out_km": out_km, "out_min": out_min, "out_e": out_e, "total_e": total_e, "pts": pts}


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
        "path": [list(p) for p in prof["pts"]],
        "path_len": sum(_seg_lens(prof["pts"])),
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
            # позиция по текущей фазе (по полилинии пути с объездом)
            r["x"], r["y"] = interpolate(j, r)
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


def interpolate(j, r=None):
    """Позиция ровера на полилинии пути по текущему прогрессу фазы."""
    bx, by = j["base_x"], j["base_y"]
    out = OUTPOSTS[j["outpost"]]
    pts = j.get("path")
    if not pts:
        if j["phase"] == "out":
            return bx + (out["x"] - bx) * j["progress"], by + (out["y"] - by) * j["progress"]
        return out["x"] + (bx - out["x"]) * j["progress"], out["y"] + (by - out["y"]) * j["progress"]
    ordered = pts if j["phase"] == "out" else list(reversed(pts))
    return point_along(ordered, _seg_lens(ordered), j["progress"])


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
    spent_min = (1.0 - j["progress"]) * j["out_min"]   # осталось до конца фазы
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
        return
    elif roll < 0.92 and z["risk"] > 0.50:
        log_event("hazard", "[%s] Повреждён привод колеса — скорость -35%%." % name)
        j["speed_penalty"] = 0.65
        j["out_min"] /= 0.65
    else:
        log_event("hazard", "[%s] Контакт с породой — ось зажало, скорость -40%%." % name)
        j["speed_penalty"] = 0.60
        j["out_min"] /= 0.60
    # время фазы изменилось — сохраняем пройденное время, чтобы ровер не «откатывался»
    j["progress"] = 1.0 - min(1.0, spent_min / max(0.01, j["out_min"]))
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
        log_event("delivery", "Доставка %s завершена вовремя! +%d долларов, рейтинг +2." % (r["name"], reward))
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
        if not r or r["status"] not in ("idle", "maintenance"):
            return {"ok": False, "error": "Ровер должен быть свободен."}
        to_fill = r["batt_max"] - r["batt"]
        cost = int(math.ceil(to_fill / 2))
        if cost > STATE["credits"]:
            return {"ok": False, "error": "Не хватает долларов (%d нужен, есть %d)." % (cost, STATE["credits"])}
        STATE["credits"] -= cost
        r["batt"] = r["batt_max"]
        log_event("mission", "Экстренная зарядка %s: -%d долларов, батарея 100%%." % (r["name"], cost))
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
        log_event("mission", "Эвакуация %s: -%d долларов. Рейтинг -3." % (r["name"], cost))
        save_all()
        return {"ok": True}
    if name == "fast_forward":
        STATE["ff"] = bool(payload.get("on"))
        if STATE["ff"]:
            STATE["paused"] = False
        return {"ok": True}
    if name == "pause":
        on = payload.get("on")
        if on is not None:
            STATE["paused"] = bool(on)
            if on:
                STATE["ff"] = False
        else:
            STATE["paused"] = not STATE.get("paused", False)
            if STATE["paused"]:
                STATE["ff"] = False
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
            return {"ok": False, "error": "Не хватает долларов (%d нужен, есть %d)." % (cost, STATE["credits"])}
        STATE["credits"] -= cost
        r[plan["key"]] = lvl + 1
        r[plan["prop"]] = round(r[plan["prop"]] + plan["delta"])
        log_event("mission", "%s: улучшение «%s» %s%d → +%d %s. −%d$" %
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
            return {"ok": False, "error": "Не хватает долларов (%d нужен, есть %d)." % (slot["cost"], STATE["credits"])}
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
        log_event("mission", "Во флот прибыл новый ровер %s «%s» (%d кг, %d км/ч). −%d$" %
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
        try:
            dt_min = GAME_MIN_PER_SEC * dt_real * (FF_MULT if STATE and STATE["ff"] else 1.0)
            if STATE and not STATE["gameover"] and not STATE.get("paused"):
                with lock:
                    simulate_step(dt_min)
                    now = time.time()
                    if now - last_save >= 1.0:
                        save_all()
                        last_save = now
        except Exception as e:
            try:
                sys.stderr.write("sim_loop error: %r\n" % (e,))
            except Exception:
                pass


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
        if isinstance(body, str):
            body = body.encode("utf-8")
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
            r["path"] = j.get("path")
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
        "craters": STATE.get("craters", CRATERS),
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
        # мир: восстанавливаем или генерируем заново
        if STATE and STATE.get("zones"):
            apply_world(STATE["zones"], STATE.get("craters", []))
        else:
            zones, craters = gen_world(RAND)
            apply_world(zones, craters)
            if STATE is not None:
                STATE["zones"] = zones
                STATE["craters"] = craters
                save_all()
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