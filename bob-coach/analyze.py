"""
analyze.py — 决策反馈离线分析器

读取 sessions/decisions.log，按场景分组分析决策质量，
输出 decision_tables.json 调整建议。

用法: python analyze.py [--sessions-dir <path>] [--output suggestions.json]
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime

SESSIONS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sessions")


def load_decisions(sessions_dir):
    """读取 decisions.log，返回按 session 分组的决策列表。"""
    log_path = os.path.join(sessions_dir, "decisions.log")
    if not os.path.exists(log_path):
        print(f"[analyze] 未找到决策日志: {log_path}")
        return []

    sessions = defaultdict(list)
    with open(log_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            sid = entry.get("sessionId", "unknown")
            sessions[sid].append(entry)

    return list(sessions.values())


def group_by_scenario(all_turns):
    """将回合按场景（建议类型 + 回合范围 + 血量区间）分组。"""
    scenarios = defaultdict(list)

    for session in all_turns:
        final_rank = None
        for entry in session:
            if entry.get("type") == "session_end":
                final_rank = entry.get("finalRank")
                break

        for entry in session:
            if entry.get("type") != "turn_decision":
                continue
            sug = entry.get("suggestion")
            if not sug:
                continue

            turn = entry.get("turn", 0)
            health = entry.get("health", 30)

            # 回合区间
            if turn <= 3:
                turn_range = "early(1-3)"
            elif turn <= 7:
                turn_range = "mid(4-7)"
            else:
                turn_range = "late(8+)"

            # 血量区间
            if health <= 10:
                hp_range = "critical(<10)"
            elif health <= 20:
                hp_range = "warning(10-20)"
            else:
                hp_range = "safe(>20)"

            scenario_key = f"{sug['type']}|{turn_range}|{hp_range}"
            scenarios[scenario_key].append({
                "turn": turn,
                "health": health,
                "gold": entry.get("gold", 0),
                "suggestion_type": sug["type"],
                "suggestion_confidence": sug.get("confidence", 0),
                "playerAction": entry.get("playerAction"),
                "finalRank": final_rank,
            })

    return dict(scenarios)


def analyze(scenarios):
    """分析每个场景，输出调整建议。"""
    suggestions = []

    for key, entries in sorted(scenarios.items()):
        sug_type, turn_range, hp_range = key.split("|")

        # 分离有/无玩家行为的条目
        with_action = [e for e in entries if e.get("playerAction")]
        without_action = [e for e in entries if not e.get("playerAction")]

        total = len(entries)
        if total < 3:
            continue  # 样本太少，跳过

        # 有最终排名的条目
        ranked = [e for e in entries if e.get("finalRank") is not None]
        avg_rank = sum(e["finalRank"] for e in ranked) / len(ranked) if ranked else None

        issue = None
        # 如果建议置信度很高但缺乏玩家行动数据，提示需要标注
        if not with_action and total >= 5:
            issue = {
                "type": "needs_labeling",
                "scenario": key,
                "message": (
                    f"场景 [{sug_type}] 回合{turn_range} 血量{hp_range}: "
                    f"共{total}条记录但无玩家行为标注，建议手动标注 playerAction 字段"
                ),
            }

        # 如果有玩家行为数据且对比明显
        if with_action and len(with_action) >= 3:
            followed = [e for e in with_action if e["playerAction"] == e["suggestion_type"]]
            not_followed = [e for e in with_action if e["playerAction"] != e["suggestion_type"]]

            if followed and not_followed:
                followed_avg = sum(e["finalRank"] or 4.5 for e in followed) / len(followed)
                not_avg = sum(e["finalRank"] or 4.5 for e in not_followed) / len(not_followed)

                if not_avg > followed_avg + 1.0:
                    issue = {
                        "type": "rule_works",
                        "scenario": key,
                        "message": (
                            f"✓ 场景 [{sug_type}]: 遵循建议平均排名 {followed_avg:.1f} "
                            f"优于不遵循 {not_avg:.1f}，规则有效"
                        ),
                    }
                elif followed_avg > not_avg + 1.0:
                    issue = {
                        "type": "rule_broken",
                        "scenario": key,
                        "message": (
                            f"⚠ 场景 [{sug_type}]: 不遵循建议反而排名更好 "
                            f"({not_avg:.1f} vs {followed_avg:.1f})，建议降低 confidence"
                        ),
                    }

        suggestions.append({
            "scenario": key,
            "total_entries": total,
            "with_action": len(with_action),
            "avg_rank": round(avg_rank, 2) if avg_rank else None,
            "issue": issue,
        })

    return suggestions


def print_report(suggestions):
    """打印可读的分析报告。"""
    print("=" * 60)
    print(f"Bob教练 决策反馈分析 — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)
    print()

    if not suggestions:
        print("暂无足够数据生成分析建议。")
        print("继续对局后，决策记录将自动累积。")
        return

    needs_label = [s for s in suggestions if s["issue"] and s["issue"]["type"] == "needs_labeling"]
    rules_ok = [s for s in suggestions if s["issue"] and s["issue"]["type"] == "rule_works"]
    rules_bad = [s for s in suggestions if s["issue"] and s["issue"]["type"] == "rule_broken"]

    print(f"📊 总计 {len(suggestions)} 个场景，覆盖 {sum(s['total_entries'] for s in suggestions)} 条决策记录")
    print()

    if rules_ok:
        print("✅ 有效规则:")
        for s in rules_ok:
            print(f"  {s['issue']['message']}")
        print()

    if rules_bad:
        print("⚠️ 需要调整:")
        for s in rules_bad:
            print(f"  {s['issue']['message']}")
        print()

    if needs_label:
        print("📝 待标注:")
        for s in needs_label:
            print(f"  {s['issue']['message']}")
        print()

    # 场景汇总
    print("─" * 60)
    print(f"{'场景':<45} {'记录':>5} {'已标注':>5} {'均排名':>7}")
    print("─" * 60)
    for s in suggestions:
        key_short = s["scenario"][:43]
        labeled = s["with_action"]
        avg = f"{s['avg_rank']:.1f}" if s["avg_rank"] else "--"
        print(f"{key_short:<45} {s['total_entries']:>5} {labeled:>5} {avg:>7}")
    print("─" * 60)

    print()
    print("💡 提示：在 decisions.log 中手动填写 playerAction 和 finalRank 字段后重新运行分析，可获取更精准的调参建议。")


def main():
    sessions_dir = SESSIONS_DIR
    for i, arg in enumerate(sys.argv):
        if arg == "--sessions-dir" and i + 1 < len(sys.argv):
            sessions_dir = sys.argv[i + 1]

    sessions = load_decisions(sessions_dir)
    if not sessions:
        print("[analyze] 无决策数据。开始对局后将自动记录。")
        return

    all_turns = [turn for session in sessions for turn in session]
    turn_decisions = sum(1 for t in all_turns if t.get("type") == "turn_decision")
    print(f"[analyze] 加载 {len(sessions)} 个对局, {turn_decisions} 条回合决策")

    scenarios = group_by_scenario(sessions)
    suggestions = analyze(scenarios)
    print_report(suggestions)


if __name__ == "__main__":
    main()
