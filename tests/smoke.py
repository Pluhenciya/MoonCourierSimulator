#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Дымовые тесты ключевой игровой логики Moon Courier Simulator.
Запуск:  python tests/smoke.py            (из корня репозитория)
Тесты не трогают сохранение: save_all() заменяется заглушкой.
"""
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server as s


def setup_game():
    s.DB["events.json"] = []
    s.DB["deliveries.json"] = []
    s.DB["orders.json"] = {}
    s.RAND.seed(42)          # детерминированный мир и события
    s.seed_game()
    s.save_all = lambda: None


def make_order(dest, weight, expires=600):
    return {
        "id": "t_order", "outpost": dest, "outpost_name": s.OUTPOSTS[dest]["name"],
        "zone_id": s.zone_at(s.OUTPOSTS[dest]["x"], s.OUTPOSTS[dest]["y"]),
        "weight_kg": weight, "reward": 100, "expires_at": s.STATE["minute_total"] + expires,
        "status": "available",
    }


class TestWorld(unittest.TestCase):
    """Мир: мозаика зон без «дыр», форпосты в своих зонах, объезд бурь/кратеров."""

    @classmethod
    def setUpClass(cls):
        setup_game()

    def test_no_holes_in_zone_mosaic(self):
        for x in range(5, 1000, 25):
            for y in range(5, 696, 25):
                self.assertIsNotNone(s.zone_at(x, y), "нет зоны в точке (%d,%d) — дыра в карте" % (x, y))

    def test_outposts_inside_zones(self):
        for zid, op in s.OUTPOSTS.items():
            self.assertIsNotNone(s.zone_at(op["x"], op["y"]), "форпост %s вне зон" % zid)

    def test_zones_differ_in_risk_and_speed(self):
        risks = {m["risk"] for m in s.ZONE_META.values()}
        speeds = {m["speed"] for m in s.ZONE_META.values()}
        self.assertGreater(len(risks), 1, "зоны должны отличаться по риску")
        self.assertGreater(len(speeds), 1, "зоны должны отличаться по скорости")

    def test_craters_do_not_block_base_or_each_other(self):
        base = s.OUTPOSTS["base"]
        for (cx, cy, cr) in s.CRATERS:
            self.assertGreaterEqual(math.hypot(cx - base["x"], cy - base["y"]), 95 + cr - 1e-6,
                                    "кратер слишком близко к базе")
            for op in s.OUTPOSTS.values():
                self.assertGreaterEqual(math.hypot(cx - op["x"], cy - op["y"]), 55 + cr - 1e-6,
                                        "кратер слишком близко к форпосту")
        for i, (ax, ay, ar) in enumerate(s.CRATERS):
            for (bx, by, br) in s.CRATERS[i + 1:]:
                self.assertGreaterEqual(math.hypot(ax - bx, ay - by), ar + br + 22 - 1e-6,
                                        "кратеры пересекаются")

    def test_route_avoids_craters(self):
        import math as _m
        src, dst = s.OUTPOSTS["base"], s.OUTPOSTS["far_side"]
        pts = s.route_points(src["x"], src["y"], dst["x"], dst["y"])
        for (x, y) in pts:
            for (cx, cy, cr) in s.CRATERS:
                self.assertGreater(_m.hypot(x - cx, y - cy), cr,
                                   "маршрут проходит сквозь кратер (%d,%d)" % (x, y))


class TestImpossibleDeliveries(unittest.TestCase):
    """Сценарии «доставка невозможна»: вес, батарея, буря, занятый ровер."""

    def setUp(self):
        setup_game()

    def test_heavy_order_rejected_by_any_rover(self):
        order = make_order("far_side", 260)  # тяжелее груза Atlas (250 кг) — невыполним в принципе
        for rid in s.DB["rovers.json"]:
            ok, reason, _ = s.estimate_mission(order, rid)
            self.assertFalse(ok, "%s не должен везти 260 кг" % rid)
            self.assertIn("грузоподъёмность", reason)

    def test_battery_not_enough_rejected(self):
        order = make_order("far_side", 70)   # далёкий маршрут, энергии много
        r = s.DB["rovers.json"]["bumble"]
        ok, reason, _ = s.estimate_mission(order, r["id"])
        self.assertTrue(ok, "с полным зарядом миссия выполнима: " + reason)
        r["batt"] = 2                         # а с почти пустой батареей — нет
        ok, reason, _ = s.estimate_mission(order, r["id"])
        self.assertFalse(ok)
        self.assertIn("батареи", reason)

    def test_storm_blocks_delivery(self):
        order = make_order("bugtown", 20)
        s.STATE["storms"] = {order["zone_id"]: s.STATE["minute_total"] + 60}
        ok, reason, _ = s.estimate_mission(order, "comet")
        self.assertFalse(ok)
        self.assertIn("бурей", reason)
        s.STATE["storms"] = {}

    def test_busy_rover_rejected(self):
        order = make_order("bugtown", 20)
        r = s.DB["rovers.json"]["comet"]
        r["status"] = "delivering"
        ok, reason, _ = s.estimate_mission(order, r["id"])
        self.assertFalse(ok)
        self.assertIn("занят", reason)


class TestDeliveryCycle(unittest.TestCase):
    """Полный цикл: запуск → в пути → доставка: деньги, батарея, статусы."""

    def setUp(self):
        setup_game()

    def test_full_delivery_updates_everything(self):
        order = make_order("bugtown", 20, expires=999999)
        s.DB["orders.json"][order["id"]] = order
        r = s.DB["rovers.json"]["comet"]
        before = (s.STATE["credits"], r["batt"], r["done"])
        self.assertIsNone(r["journey"])

        res = s.launch(r["id"], order["id"])
        self.assertTrue(res["ok"], res)
        self.assertEqual(order["status"], "in_transit")
        self.assertEqual(r["status"], "delivering")

        s.STATE["minute_total"] += 240  # в реальном цикле время идёт до отрисовки
        s.tick_deliveries(240)          # прогнать время — ровер долетит и вернётся
        self.assertEqual(order["status"], "delivered")
        self.assertIsNone(r["journey"])
        self.assertIn(r["status"], ("idle", "maintenance"))
        self.assertGreater(s.STATE["credits"], before[0], "деньги должны вырасти")
        self.assertLess(r["batt"], before[1], "батарея должна израсходоваться")
        self.assertEqual(r["done"], before[2] + 1)
        row = s.DB["deliveries.json"][-1]
        self.assertEqual(row["order_id"], order["id"])
        self.assertGreater(row["reward"], 0)

    def test_late_delivery_penalizes_rating(self):
        order = make_order("crater_edge", 30, expires=1)  # срок почти сразу
        s.DB["orders.json"][order["id"]] = order
        r = s.DB["rovers.json"]["bumble"]
        rating_before = s.STATE["rating"]
        s.launch(r["id"], order["id"])
        s.STATE["minute_total"] += 600
        s.tick_deliveries(600)
        self.assertEqual(order["status"], "delivered")
        self.assertLess(s.STATE["rating"], rating_before, "просрочка должна ударить по рейтингу")


if __name__ == "__main__":
    unittest.main(verbosity=2)