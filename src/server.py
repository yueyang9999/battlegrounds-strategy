"""HTTP server: serve board HTML + card data API."""
import json
import http.server
import urllib.parse
import os
from .registry import get_registry
from .meta_registry import get_meta_registry


class BoardHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/cards":
            self._serve_json(self._get_all_cards())
        elif parsed.path == "/api/heroes":
            self._serve_json(self._get_heroes())
        elif parsed.path == "/api/minions":
            self._serve_json(self._get_minions())
        elif parsed.path == "/api/trinkets":
            self._serve_json(self._get_trinkets())
        elif parsed.path == "/api/companions":
            self._serve_json(self._get_companions())
        elif parsed.path == "/api/quests_rewards":
            self._serve_json(self._get_quests_rewards())
        elif parsed.path == "/api/anomalies":
            self._serve_json(self._get_anomalies())
        elif parsed.path == "/api/timewarps":
            self._serve_json(self._get_timewarps())
        elif parsed.path == "/api/hero_stats":
            self._serve_json(self._get_hero_stats())
        elif parsed.path == "/api/hero_powers":
            self._serve_json(self._get_hero_powers())
        elif parsed.path == "/api/comps":
            self._serve_json(self._get_comps())
        elif parsed.path == "/api/trinket_tips":
            self._serve_json(self._get_trinket_tips())
        elif parsed.path == "/api/hero_strategies":
            self._serve_json(self._get_hero_strategies())
        elif parsed.path == "/" or parsed.path == "/panel":
            self._serve_panel()
        elif parsed.path == "/team-builder":
            self._serve_page("team-builder.html")
        elif parsed.path.startswith("/images/"):
            # Proxy card images
            card_id = parsed.path.replace("/images/", "")
            card = get_registry().get(card_id)
            if card and card.img:
                self.send_response(302)
                self.send_header("Location", card.img)
                self.end_headers()
            else:
                self.send_error(404)
        else:
            super().do_GET()

    def _serve_json(self, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _serve_panel(self):
        self._serve_page("panel.html")

    def _serve_page(self, filename):
        page_path = os.path.join(os.path.dirname(__file__), filename)
        with open(page_path, "r", encoding="utf-8") as f:
            html = f.read()
        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _get_all_cards(self):
        reg = get_registry()
        return [{
            "str_id": c.str_id, "name": c.name, "name_cn": c.name_cn,
            "card_type": c.card_type, "text_cn": c.text_cn,
            "tier": getattr(c, "tier", None),
            "attack": getattr(c, "attack", None),
            "health": getattr(c, "health", None),
            "armor": getattr(c, "armor", None),
            "mana_cost": getattr(c, "mana_cost", None),
            "minion_types_cn": getattr(c, "minion_types_cn", []),
            "mechanics": c.mechanics,
            "img": c.img,
            "lesser": getattr(c, "lesser", None),
        } for c in reg.cards.values()]

    def _get_heroes(self):
        reg = get_registry()
        return [{
            "str_id": c.str_id, "name_cn": c.name_cn,
            "armor": c.armor, "health": c.health,
            "hp_ids": c.hp_ids, "buddy_id": c.buddy_id,
            "img": c.img,
        } for c in reg.cards.values() if c.card_type == "hero"]

    def _get_hero_powers(self):
        reg = get_registry()
        return [{
            "str_id": c.str_id, "name_cn": c.name_cn,
            "text_cn": c.text_cn, "mana_cost": c.mana_cost, "img": c.img,
        } for c in reg.cards.values() if c.card_type == "hero_power"]

    def _get_minions(self):
        reg = get_registry()
        return [{
            "str_id": c.str_id, "name_cn": c.name_cn,
            "tier": c.tier, "attack": c.attack, "health": c.health,
            "minion_types_cn": c.minion_types_cn,
            "text_cn": c.text_cn, "mechanics": c.mechanics, "img": c.img,
        } for c in reg.cards.values() if c.card_type == "minion" and c.tier]

    def _get_trinkets(self):
        reg = get_registry()
        return [{
            "str_id": c.str_id, "name_cn": c.name_cn,
            "text_cn": c.text_cn, "mana_cost": c.mana_cost,
            "lesser": c.lesser, "img": c.img,
        } for c in reg.cards.values() if c.card_type == "trinket"]

    def _get_companions(self):
        reg = get_registry()
        return [{
            "str_id": c.str_id, "name_cn": c.name_cn,
            "tier": c.tier, "attack": c.attack, "health": c.health,
            "text_cn": c.text_cn, "img": c.img,
            "buddy_hero_id": c.buddy_hero_id,
        } for c in reg.cards.values() if c.card_type == "companion"]

    def _get_quests_rewards(self):
        reg = get_registry()
        quests = [{"str_id": c.str_id, "name_cn": c.name_cn, "text_cn": c.text_cn, "img": c.img}
                  for c in reg.cards.values() if c.card_type == "quest"]
        rewards = [{"str_id": c.str_id, "name_cn": c.name_cn, "text_cn": c.text_cn, "img": c.img}
                   for c in reg.cards.values() if c.card_type == "reward"]
        return {"quests": quests, "rewards": rewards}

    def _get_anomalies(self):
        reg = get_registry()
        return [{"str_id": c.str_id, "name_cn": c.name_cn, "text_cn": c.text_cn, "img": c.img}
                for c in reg.cards.values() if c.card_type == "anomaly"]

    def _get_timewarps(self):
        reg = get_registry()
        return [{
            "str_id": c.str_id, "name_cn": c.name_cn,
            "text_cn": c.text_cn, "tier": c.tier,
            "lesser": c.lesser, "mana_cost": c.mana_cost, "img": c.img,
        } for c in reg.cards.values() if c.card_type == "timewarp"]

    def _get_hero_stats(self):
        meta = get_meta_registry()
        reg = get_registry()
        result = []
        for hid, hs in meta.hero_stats.items():
            card = reg.get(hid)
            result.append({
                "hero_card_id": hid,
                "name_cn": card.name_cn if card else hid,
                "avg_position": hs["avg_position"],
                "data_points": hs["data_points"],
                "placements": hs["placement_dist"],
            })
        result.sort(key=lambda x: x["avg_position"])
        return result

    def _get_comps(self):
        meta = get_meta_registry()
        return meta.get_comp_strategies()

    def _get_trinket_tips(self):
        meta = get_meta_registry()
        return meta.trinket_tips

    def _get_hero_strategies(self):
        meta = get_meta_registry()
        return {"tips": meta.hero_tips, "curves": meta.curves}

    def log_message(self, format, *args):
        pass  # suppress logs


def run_server(port=8765):
    reg = get_registry()
    meta = get_meta_registry()
    print(f"[server] 卡牌: {len(reg.cards)} 张, 英雄环境: {meta.hero_count} 个")
    print(f"[server] 面板地址: http://localhost:{port}")
    server = http.server.HTTPServer(("127.0.0.1", port), BoardHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[server] 已停止")


if __name__ == "__main__":
    run_server()
