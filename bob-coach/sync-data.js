"use strict";

// ═══════════════════════════════════════════════════════════
// Bob教练 — 数据同步模块
// 从上游 API 拉取卡牌/环境数据，英文内容翻译为中文，写入 data/*.json
// 7 天自动检查 + 手动检查更新
// ═══════════════════════════════════════════════════════════

const https = require("https");
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

// ── API 端点 ──
const GAMERHUB_CARDS_URL = "https://battlegrounds.gamerhub.cn/api/cards/get_full_cards";
const FIRESTONE_HERO_STATS =
  "https://static.zerotoheroes.com/api/bgs/hero-stats/mmr-100/last-patch/overview-from-hourly.gz.json";
const FIRESTONE_HERO_STRAT =
  "https://static.zerotoheroes.com/hearthstone/data/battlegrounds-strategies/bgs-hero-strategies.gz.json";
const FIRESTONE_COMP_STRAT =
  "https://static.zerotoheroes.com/hearthstone/data/battlegrounds-strategies/bgs-comps-strategies.gz.json";
const FIRESTONE_TRINKET_STRAT =
  "https://static.zerotoheroes.com/hearthstone/data/battlegrounds-strategies/bgs-trinket-strategies.gz.json";

const DATA_DIR = path.join(__dirname, "data");
const META_INFO_PATH = path.join(DATA_DIR, "meta_info.json");

// ═══════════════════════════════════════════════════════════
// 流派名称中英对照
// ═══════════════════════════════════════════════════════════

const COMP_NAME_CN = {
  "Beast Self-Damage": "野兽自残流",
  "Beast Stegodon": "野兽剑龙流",
  "Demon Fodder": "恶魔饲料流",
  "Dragon Kalecgos": "龙族卡雷流",
  "Elemental Tier 2 Bailers": "元素二本滚球流",
  "Quilboar Avenge": "野猪人复仇流",
  "Quilboar Smuggler": "野猪人宝石走私者流",
  "Mech Automaton": "机械自动机流",
  "Mech Shield": "机械圣盾流",
  "Murloc Mrrglton": "鱼人摩戈尔顿流",
  "Murloc Handbuff": "鱼人手牌强化流",
  "Murloc Scam": "鱼人偷鸡流",
  "Naga Deep Blue": "娜迦深蓝流",
  "Pirate Bounty": "海盗赏金流",
  "Undead Attack": "亡灵攻击力流",
  "Undead End of turn": "亡灵回合结束流",
  "Undead Overflow": "亡灵亡语溢出流",
  "Back to Back": "背靠背法术流",
  "Dragon Ring Bearer": "龙族持戒流",
  "Elemental Shop Buff": "元素酒馆Buff流",
  "Beast Leviathan": "野兽利维坦流",
  "Naga Spell Buff": "娜迦法术Buff流",
};

// ═══════════════════════════════════════════════════════════
// 游戏术语中英对照（用于 Tip 翻译）
// ═══════════════════════════════════════════════════════════

// Phrases first (longest→shortest), then single words
// Phrases first (longest→shortest), sorted by length descending for proper matching
const TERM_CN_LIST = [
  // ── 战斗/回合机制 ──
  ["Start of Combat", "战斗开始时"],
  ["start of combat", "战斗开始时"],
  ["End of Turn", "回合结束时"],
  ["end of turn", "回合结束时"],
  ["Divine Shields", "圣盾"],
  ["Divine Shield", "圣盾"],
  ["divine shields", "圣盾"],
  ["divine shield", "圣盾"],
  ["Hero Powers", "英雄技能"],
  ["Hero Power", "英雄技能"],
  ["hero powers", "英雄技能"],
  ["hero power", "英雄技能"],
  ["Tavern Spells", "酒馆法术"],
  ["Tavern Spell", "酒馆法术"],
  ["tavern spells", "酒馆法术"],
  ["tavern spell", "酒馆法术"],
  ["tier 7", "7本"],
  ["Tier 7", "7本"],
  ["tier 6", "6本"],
  ["Tier 6", "6本"],
  ["tier 5", "5本"],
  ["Tier 5", "5本"],
  ["tier 4", "4本"],
  ["Tier 4", "4本"],
  ["tier 3", "3本"],
  ["Tier 3", "3本"],
  ["tier 2", "2本"],
  ["Tier 2", "2本"],
  ["Battlecries", "战吼"],
  ["Battlecry", "战吼"],
  ["battlecries", "战吼"],
  ["battlecry", "战吼"],
  ["Deathrattles", "亡语"],
  ["Deathrattle", "亡语"],
  ["deathrattles", "亡语"],
  ["deathrattle", "亡语"],
  ["Reborns", "复生"],
  ["Reborn", "复生"],
  ["reborns", "复生"],
  ["reborn", "复生"],
  ["Windfury", "风怒"],
  ["windfury", "风怒"],
  ["Spellcraft", "法术迸发"],
  ["spellcraft", "法术迸发"],
  ["Poisonous", "剧毒"],
  ["poisonous", "剧毒"],
  ["Avenge", "复仇"],
  ["avenge", "复仇"],
  ["Taunt", "嘲讽"],
  ["taunt", "嘲讽"],
  ["taunts", "嘲讽"],
  ["Golden", "金色"],
  ["golden", "金色"],
  ["Venomous", "烈毒"],
  ["venomous", "烈毒"],
  ["Cleave", "顺劈"],
  ["cleave", "顺劈"],

  // ── 游戏名称 ──
  ["Battlegrounds", "酒馆战棋"],
  ["battlegrounds", "酒馆战棋"],

  // ── 多词短语 ──
  ["as much as you can", "尽可能多"],
  ["as soon as possible", "尽可能快"],
  ["as you can", "尽可能"],
  ["as much", "尽可能多"],
  ["make use of", "利用"],
  ["make the most of", "充分利用"],
  ["a lot of", "大量"],
  ["lots of", "大量"],
  ["kind of", "有点"],
  ["try to", "尝试"],
  ["need to", "需要"],
  ["want to", "想要"],
  ["able to", "能够"],
  ["have to", "必须"],
  ["going to", "即将"],
  ["based on", "基于"],
  ["depending on", "根据"],
  ["look for", "寻找"],
  ["looking for", "寻找"],
  ["build on", "构建于"],
  ["figure out", "判断"],
  ["on the spot", "当下"],
  ["on the left", "在左侧"],
  ["on the right", "在右侧"],
  ["on first", "在首位"],
  ["at the end", "在末尾"],
  ["in fight", "在战斗中"],
  ["in the early", "在早期"],
  ["in the late", "在后期"],
  ["in the mid", "在中期"],
  ["in most", "在大多数"],
  ["for example", "例如"],
  ["for ex", "例如"],
  ["If possible", "如有可能"],
  ["if you can", "如果可以"],
  ["the best", "最佳"],
  ["is the best", "是最佳选择"],
  ["works better", "效果更好"],
  ["works best", "效果最好"],
  ["does that", "这样做"],
  ["doing that", "这样做"],
  ["spend your", "使用你的"],
  ["you have to", "你必须"],
  ["You have to", "你必须"],
  ["you should", "你应该"],
  ["you can", "你可以"],
  ["you dont", "你不"],
  ["there are", "有"],
  ["There are", "有"],
  ["on this hero", "用这个英雄"],
  ["for you", "对你"],
  ["what works", "什么有效"],
  ["a few", "一些"],
  ["right now", "现在"],
  ["even if", "即使"],
  ["at least", "至少"],
  ["at worst", "最差"],
  ["unless you", "除非你"],
  ["as soon", "尽快"],
  ["as well", "也"],
  ["instead of", "替代"],
  ["because of", "因为"],

  // ── 游戏概念 ──
  ["early game", "前期"],
  ["early-game", "前期"],
  ["late game", "后期"],
  ["late-game", "后期"],
  ["mid game", "中期"],
  ["mid-game", "中期"],
  ["end game", "终局"],
  ["cost spell", "费用法术"],
  ["cost spells", "费用法术"],
  ["coin", "铸币"],
  ["coins", "铸币"],
  ["economy", "经济"],
  ["tempo", "节奏"],
  ["scaling", "成长"],
  ["direction", "方向"],
  ["win condition", "制胜手段"],
  ["win condition", "制胜手段"],

  // ── 流派/种族（仅翻译，不匹配卡牌名）──
  ["Dragons", "龙"],
  ["dragons", "龙"],
  ["Mechs", "机械"],
  ["mechs", "机械"],
  ["Demons", "恶魔"],
  ["demons", "恶魔"],
  ["Beasts", "野兽"],
  ["beasts", "野兽"],
  ["Murlocs", "鱼人"],
  ["murlocs", "鱼人"],
  ["Nagas", "娜迦"],
  ["nagas", "娜迦"],
  ["Pirates", "海盗"],
  ["pirates", "海盗"],
  ["Quilboars", "野猪人"],
  ["quilboars", "野猪人"],
  ["Undead", "亡灵"],
  ["undead", "亡灵"],
  ["Elementals", "元素"],
  ["elementals", "元素"],

  // ── 多词概念 ──
  ["value generating", "资源生成"],
  ["value generation", "资源生成"],
  ["stat buff", "身材buff"],
  ["stat buffs", "身材buff"],
  ["shop buff", "酒馆buff"],
  ["board space", "场面空间"],
  ["board buff", "场面buff"],
  ["combat buff", "战斗buff"],

  // ── 常用动词/形容词 ──
  ["prioritize", "优先"],
  ["Prioritize", "优先"],
  ["recommend", "推荐"],
  ["recommended", "推荐"],
  ["conservative", "保守"],
  ["aggressive", "激进"],
  ["aggressively", "激进地"],
  ["greedier", "更贪"],
  ["Greedier", "更贪"],
  ["greedy", "贪"],
  ["normally", "通常"],
  ["usually", "通常"],
  ["always", "总是"],
  ["never", "绝不要"],
  ["Never", "绝不要"],
  ["sometimes", "有时"],
  ["possible", "尽可能"],
  ["whenever", "每当"],
  ["available", "可用"],
  ["potential", "潜在"],
  ["extra", "额外"],
  ["additional", "额外"],
  ["specific", "特定"],
  ["different", "不同"],
  ["important", "重要"],
  ["especially", "特别是"],
  ["permanent", "永久"],
  ["temporary", "临时"],
  ["popular", "流行"],
  ["powerful", "强力"],
  ["sticky", "粘性"],
  ["Sticky", "粘性"],
  ["standard", "标准"],
  ["similar", "类似"],
  ["decent", "不错"],
  ["enough", "足够"],
  ["multiple", "多个"],
  ["single", "单个"],
  ["second", "第二个"],
  ["third", "第三个"],
  ["fourth", "第四个"],
  ["against", "针对"],
  ["between", "之间"],
  ["without", "没有"],
  ["really", "确实"],
  ["still", "仍然"],
  ["also", "也"],
  ["just", "就"],
  ["only", "仅"],
  ["very", "非常"],
  ["even", "甚至"],
  ["well", "好地"],
  ["most", "大多数"],
  ["many", "许多"],
  ["makes", "使"],
  ["make", "使"],
  ["around", "大约"],
  ["going", "升到"],
  ["look", "找"],
  ["looking", "寻找"],
  ["getting", "获得"],
  ["depends", "取决于"],
  ["depends on", "取决于"],
  ["ideally", "理想情况"],
  ["Ideally", "理想情况"],
  ["dont", "不"],
  ["doesnt", "不"],
  ["wont", "不会"],
  ["shouldnt", "不应该"],
  ["wouldnt", "不会"],
  ["havent", "没有"],
  ["arent", "不是"],
  ["isnt", "不是"],
  ["wasnt", "不是"],
  ["werent", "不是"],
  ["hadnt", "没有"],
  ["didnt", "没有"],
  ["hasnt", "没有"],
  ["cant", "不能"],
  ["cannot", "不能"],
  ["direction", "方向"],
  ["directions", "方向"],
  ["synergy", "配合"],
  ["synergies", "配合"],
  ["instead", "替代"],
  ["mostly", "主要"],
  ["likely", "可能"],
  ["lucky", "幸运"],
  ["cheaper", "更便宜"],
  ["easier", "更轻松"],
  ["harder", "更难"],
  ["better", "更好"],
  ["worse", "更差"],
  ["perfect", "完美"],
  ["strong", "强"],
  ["stronger", "更强"],
  ["bigger", "更大"],
  ["smaller", "更小"],
  ["higher", "更高"],
  ["lower", "更低"],
  ["longer", "更长"],
  ["shorter", "更短"],
  ["early on", "早期"],
  ["late game", "后期"],
  ["mid game", "中期"],
  ["pair", "对子"],
  ["pairs", "对子"],
  ["copy", "复制"],
  ["copies", "复制"],
  ["copies of", "复制"],
  ["discovers", "发现"],
  ["discovers of", "发现"],
  ["amount", "数量"],
  ["amount of", "数量"],
  ["lots of", "大量"],
  ["full board", "满场"],
  ["full hand", "满手牌"],
  ["openings", "开局"],
  ["opener", "开局"],
  ["let you", "让你"],
  ["lets you", "让你"],
  ["allow you", "允许你"],
  ["allows you", "允许你"],
  ["helps you", "帮助你"],
  ["give you", "给你"],
  ["gives you", "给你"],
  ["get you", "让你"],
  ["sell off", "卖掉"],
  ["level early", "早升本"],
  ["level late", "晚升本"],
  ["generally", "一般"],
  ["usually", "通常"],
  ["situational", "视情况"],
  ["overall", "总体"],
  ["anyways", "无论如何"],
  ["otherwise", "否则"],
  ["whether", "是否"],
  ["however", "但是"],
  ["alongside", "连同"],
  ["together", "一起"],
  ["throughout", "贯穿"],
  ["somewhat", "有点"],
  ["unless", "除非"],
  ["towards", "朝着"],
  ["already", "已经"],
  ["almost", "几乎"],
  ["enough", "足够"],
  ["though", "虽然"],
  ["although", "虽然"],
  ["perhaps", "也许"],
  ["maybe", "也许"],
  ["anything", "任何"],
  ["nothing", "没有"],
  ["something", "一些东西"],
  ["everything", "一切"],
  ["everyone", "所有人"],
  ["anyone", "任何人"],
  ["someone", "某人"],
  ["exactly", "确切"],
  ["basically", "基本上"],
  ["certainly", "必然"],
  ["definitely", "绝对"],
  ["absolutely", "绝对"],
  ["especially", "特别"],
  ["particular", "特定"],
  ["giving", "给予"],
  ["finding", "找到"],
  ["taking", "拿取"],
  ["making", "使"],
  ["selling", "卖出"],
  ["keeping", "保留"],
  ["picking", "选取"],
  ["choosing", "选择"],
  ["letting", "让"],
  ["setting", "设置"],
  ["starting", "开始"],
  ["assuming", "假设"],
  ["depending", "根据"],
  ["including", "包括"],
  ["according", "根据"],
  ["following", "遵循"],
  ["providing", "提供"],
  ["allowing", "允许"],
  ["helping", "帮助"],
  ["seems", "似乎"],
  ["becomes", "变成"],
  ["means", "意味着"],
  ["know", "知道"],
  ["think", "认为"],
  ["comes", "来"],
  ["turn into", "变成"],
  ["game changing", "改变战局"],
  ["game-changing", "改变战局"],
  ["divine shielded", "圣盾"],
  ["divine shield", "圣盾"],
  ["against divine", "针对圣盾"],
  ["against taunt", "针对嘲讽"],
  ["try and", "尝试"],
  ["pick up", "拿取"],
  ["sell off", "卖掉"],
  ["level up", "升本"],
  ["level early", "早升本"],
  ["level late", "晚升本"],
  ["level fast", "速升本"],
  ["level aggressively", "激进升本"],
  ["press the button", "按技能"],
  ["press button", "按技能"],
  ["push the button", "按技能"],
  ["hero power button", "技能按钮"],
  ["early on", "早期"],
  ["late game", "后期"],
  ["mid game", "中期"],
  ["early turns", "早期回合"],
  ["late turns", "后期回合"],
  ["value generating card", "资源生成卡"],
  ["generating card", "生成卡"],
  ["value card", "价值卡"],
  ["stat buff", "身材buff"],
  ["combat buff", "战斗buff"],
  ["shop buff", "酒馆buff"],
  ["in combat", "战斗中"],
  ["end of turn", "回合结束时"],
  ["start of turn", "回合开始时"],
  ["start of combat", "战斗开始时"],
  ["a lot", "很多"],
  ["a lot of", "很多"],
  ["lots of", "很多"],
  ["kind of", "有点"],
  ["sort of", "有点"],
  ["full board", "满场"],
  ["full hand", "满手牌"],
  ["board space", "场面空间"],
  ["let you", "让你"],
  ["lets you", "让你"],
  ["allow you", "允许你"],
  ["allows you", "允许你"],
  ["helps you", "帮助你"],
  ["give you", "给你"],
  ["gives you", "给你"],
  ["get you", "让你"],
  ["gets you", "让你"],
  ["on its own", "本身"],
  ["on their own", "本身"],
  ["by itself", "本身"],
  ["by themselves", "本身"],
  ["most of", "大部分"],
  ["some of", "一些"],
  ["one of", "其中之一"],
  ["end up", "最终"],
  ["ends up", "最终"],
  ["set up", "设置"],
  ["sets up", "设置"],
  ["show up", "出现"],
  ["shows up", "出现"],
  ["pop off", "爆发"],
  ["pops off", "爆发"],
  ["turn on", "开启"],
  ["turns on", "开启"],
  ["rely on", "依赖"],
  ["relies on", "依赖"],
  ["focus on", "专注"],
  ["focuses on", "专注"],
  ["focus", "专注"],
  ["adapt", "适应"],
  ["adapts", "适应"],
  ["adjust", "调整"],
  ["adjusts", "调整"],
  ["committed", "锁定"],
  ["commit", "锁定"],
  ["stabilize", "稳住"],
  ["stabilizes", "稳住"],
  ["stabilizing", "稳住"],
  ["survive", "存活"],
  ["survives", "存活"],
  ["surviving", "存活"],
  ["rush to", "速冲到"],
  ["rush", "速冲"],
  ["climb", "爬分"],
  ["climbing", "爬分"],
  ["push", "推进"],
  ["pushing", "推进"],
  ["transition", "转型"],
  ["transitions", "转型"],
  ["transitioning", "转型"],
  ["pivot", "转向"],
  ["pivots", "转向"],
  ["pivoting", "转向"],
  ["tavern", "酒馆"],
  ["tavern tier", "酒馆等级"],
  ["shop tier", "酒馆等级"],
  ["golden", "金色"],
  ["gold card", "金色卡牌"],
  ["gold cards", "金色卡牌"],
  ["triple reward", "三连奖励"],
  ["triple into", "三连出"],
  ["triple a", "三连"],
  ["look for triple", "找三连"],
  ["go for triple", "冲三连"],
  ["dont force", "不要强玩"],
  ["dont try", "不要尝试"],
  ["dont need", "不需要"],
  ["dont have", "没有"],
  ["dont get", "拿不到"],
  ["you dont", "你不"],
  ["you cant", "你不能"],
  ["you wont", "你不会"],
  ["youre", "你是"],
  ["youll", "你将会"],
  ["theyre", "他们是"],
  ["theyve", "他们已经"],
  ["isnt", "不是"],
  ["arent", "不是"],
  ["wasnt", "不是"],
  ["werent", "不是"],
  ["havent", "没有"],
  ["hasnt", "没有"],
  ["hadnt", "没有"],
  ["didnt", "没有"],
  ["doesnt", "不"],
  ["wont", "不会"],
  ["shouldnt", "不应该"],
  ["wouldnt", "不会"],
  ["couldnt", "不能"],
  ["cant", "不能"],
  ["cannot", "不能"],
  ["thats", "那是"],
  ["whats", "什么"],
  ["heres", "这里是"],
  ["theres", "有"],
  ["change", "改变"],
  ["changes", "改变"],
  ["changing", "改变"],
  ["changed", "改变"],
  ["since", "因为"],
  ["normal", "正常"],
  ["follow", "遵循"],
  ["follows", "遵循"],
  ["following", "遵循"],
  ["start", "开始"],
  ["starts", "开始"],
  ["starting", "开始"],
  ["case", "情况"],
  ["cases", "情况"],
  ["for", "为了"],
  ["find", "找到"],
  ["gain", "获得"],
  ["gains", "获得"],
  ["gaining", "获得"],
  ["either", "任一"],
  ["often", "经常"],
  ["assume", "假设"],
  ["assumes", "假设"],
  ["bit", "一点"],
  ["drop", "掉落"],
  ["drops", "掉落"],
  ["dropped", "掉落"],
  ["poison", "剧毒"],
  ["venom", "烈毒"],
  ["venomous", "烈毒"],
  ["great", "很棒"],
  ["isolate", "隔离"],
  ["isolates", "隔离"],
  ["isolating", "隔离"],
  ["information", "信息"],
  ["info", "信息"],
  ["cleave", "顺劈"],
  ["cleaves", "顺劈"],
  ["adjacent", "相邻"],
  ["rest", "其余"],
  ["others", "其他"],
  ["etc", "等等"],
  ["example", "例如"],
  ["examples", "例如"],
  ["lots", "很多"],
  ["main", "主要"],
  ["secondary", "次要"],
  ["plan", "计划"],
  ["backup", "备选"],
  ["huge", "巨大"],
  ["massive", "巨大"],
  ["solid", "扎实"],
  ["weak", "弱"],
  ["weaker", "更弱"],
  ["strong", "强"],
  ["stronger", "更强"],
  ["situational", "视情况"],
  ["overall", "总体"],
  ["anyways", "无论如何"],
  ["otherwise", "否则"],
  ["whether", "是否"],
  ["however", "但是"],
  ["alongside", "连同"],
  ["together", "一起"],
  ["throughout", "贯穿"],
  ["somewhat", "有点"],
  ["unless", "除非"],
  ["towards", "朝着"],
  ["already", "已经"],
  ["almost", "几乎"],
  ["though", "虽然"],
  ["although", "虽然"],
  ["perhaps", "也许"],
  ["maybe", "也许"],
  ["anything", "任何"],
  ["nothing", "没有"],
  ["something", "一些东西"],
  ["everything", "一切"],
  ["everyone", "所有人"],
  ["anyone", "任何人"],
  ["someone", "某人"],
  ["exactly", "确切"],
  ["basically", "基本上"],
  ["certainly", "必然"],
  ["definitely", "绝对"],
  ["absolutely", "绝对"],
  ["particular", "特定"],
  ["particularly", "特别地"],
  ["discovery", "发现"],
  ["discoveries", "发现"],
  ["I", "我"],
  ["we", "我们"],
  ["me", "我"],
  ["my", "我的"],
  ["us", "我们"],
  ["our", "我们的"],
  ["good", "好"],
  ["one", "一个"],
  ["two", "两个"],
  ["three", "三个"],
  ["people", "对手"],
  ["opponent", "对手"],
  ["opponents", "对手"],
  ["attacking", "攻击"],
  ["attacks", "攻击"],
  ["attacked", "攻击"],
  ["used", "使用"],
  ["uses", "使用"],
  ["like", "如"],
  ["want", "想要"],
  ["wants", "想要"],
  ["know", "知道"],
  ["knows", "知道"],
  ["called", "叫做"],
  ["death", "死亡"],
  ["deaths", "死亡"],
  ["summoned", "召唤"],
  ["summoning", "召唤"],
  ["generated", "生成"],
  ["generating", "生成"],
  ["generation", "生成"],
  ["triggered", "触发"],
  ["triggering", "触发"],
  ["protected", "保护"],
  ["protecting", "保护"],
  ["scaled", "成长"],
  ["boosted", "提升"],
  ["boosting", "提升"],
  ["buffed", "buff"],
  ["leveled", "升本"],
  ["leveling", "升本"],
  ["rolled", "刷新"],
  ["rolling", "刷新"],
  ["sold", "卖出"],
  ["held", "保留"],
  ["holding", "保留"],
  ["placed", "放置"],
  ["placing", "放置"],
  ["become", "变成"],
  ["becomes", "变成"],
  ["come", "来"],
  ["comes", "来"],
  ["came", "来了"],
  ["gonna", "将要"],
  ["wanna", "想要"],
  ["out of", "超出"],
  ["due to", "由于"],
  ["thanks to", "多亏"],
  ["rather than", "而不是"],
  ["in front", "在前方"],
  ["in back", "在后方"],
  ["in order to", "为了"],
  ["so that", "以便"],
  ["such as", "比如"],
  ["as well as", "以及"],
  ["as long as", "只要"],
  ["right away", "立刻"],
  ["straight away", "立刻"],
  ["no longer", "不再"],
  ["any more", "再"],
  ["anymore", "再"],
  ["every time", "每次"],
  ["each time", "每次"],
  ["most of the time", "大部分时间"],
  ["make sure", "确保"],
  ["take advantage", "利用"],
  ["get value", "获得价值"],
  ["worth it", "值得"],
  ["not worth", "不值得"],
  ["pair with", "搭配"],
  ["pairs with", "搭配"],
  ["paired with", "搭配"],
  ["combine with", "与...组合"],
  ["combined with", "与...组合"],
  ["works well with", "与…搭配好"],
  ["counters", "克制"],
  ["counter", "克制"],
  ["countered", "被克制"],
  ["highroll", "天胡"],
  ["high roll", "天胡"],
  ["high rolling", "天胡"],
  ["lowroll", "天崩"],
  ["low roll", "天崩"],
  ["power spike", "强势期"],
  ["power level", "强度"],
  ["win rate", "胜率"],
  ["win more", "扩大优势"],
  ["tempo play", "节奏打法"],
  ["final board", "最终阵容"],
  ["final comp", "最终流派"],
  ["transition point", "转型点"],
  ["turn by turn", "逐回合"],
  ["all in", "全押"],
  ["go all in", "全押"],
  ["sell your board", "卖场面"],
  ["sell board", "卖场面"],
  ["level to", "升到"],
  ["level to tier", "升到"],
  ["go to level", "升到等级"],
  ["go to tier", "升到"],
  ["stay on tier", "停在"],
  ["stay at", "停在"],
  ["stay on", "停在"],
  ["roll for", "刷新找"],
  ["roll down", "刷干"],
  ["roll until", "刷到"],
  ["freeze for", "冻结等"],
  ["freeze until", "冻结直到"],
  ["freeze the shop", "冻结酒馆"],
  ["buy time", "争取时间"],
  ["buy you time", "争取时间"],
  ["stall", "拖延"],
  ["stalling", "拖延"],
  ["out tempo", "节奏压制"],
  ["out scale", "成长压制"],
  ["outscaling", "成长压制"],
  ["among the best", "最强的之一"],
  ["one of the best", "最强的之一"],
  ["pretty good", "相当好"],
  ["pretty strong", "相当强"],
  ["really good", "非常好"],
  ["really strong", "非常强"],
  ["not bad", "不错"],
  ["not great", "不太好"],
  ["too slow", "太慢"],
  ["too fast", "太快"],
  ["too greedy", "太贪"],
  ["more aggressive", "更激进"],
  ["more conservative", "更保守"],
  ["too", "太"],
  ["build", "构建"],
  ["builds", "构建"],
  ["building", "构建"],
  ["way", "方式"],
  ["ways", "方式"],
  ["because", "因为"],
  ["big", "大"],
  ["powering", "使用技能"],
  ["bad", "坏"],
  ["mind", "记住"],
  ["plays", "打出"],
  ["power", "技能"],
  ["help", "帮助"],
  ["helps", "帮助"],
  ["fast", "快速"],
  ["advantage", "优势"],
  ["hit", "击中"],
  ["effect", "效果"],
  ["effects", "效果"],
  ["at", "在"],
  ["player", "玩家"],
  ["players", "玩家"],
  ["afterwards", "之后"],
  ["efficient", "高效"],
  ["pretty", "相当"],
  ["next", "下一个"],
  ["low", "低"],
  ["yourself", "自己"],
  ["cheap", "便宜"],
  ["rather", "宁可"],
  ["basic", "基础"],
  ["leftover", "剩余"],
  ["stays", "留在"],
  ["backline", "后排"],
  ["frontline", "前排"],
  ["health", "血量"],
  ["attack", "攻击力"],
  ["offer", "提供"],
  ["offers", "提供"],
  ["insane", "离谱"],
  ["free", "免费"],
  ["easy", "容易"],
  ["hard", "难"],
  ["safe", "安全"],
  ["safer", "更安全"],
  ["risky", "冒险"],
  ["slow", "慢"],
  ["quick", "快"],
  ["clear", "清楚"],
  ["whole", "整个"],
  ["half", "一半"],
  ["double", "双倍"],
  ["triple", "三连"],
  ["simple", "简单"],
  ["simply", "仅仅"],
  ["usually", "通常"],
  ["especially", "尤其是"],
  ["finally", "最后"],
  ["currently", "当前"],
  ["recently", "最近"],
  ["generally", "一般"],
  ["naturally", "自然"],
  ["honestly", "老实说"],
  ["obviously", "显然"],
  ["probably", "可能"],
  ["luckily", "幸运地"],
  ["unluckily", "不幸地"],
  ["sadly", "可惜"],
  ["fortunately", "幸运的是"],
  ["unfortunately", "不幸的是"],
  ["in general", "一般来说"],
  ["for sure", "肯定的"],
  ["for free", "免费"],
  ["for now", "目前"],
  ["for later", "备用"],
  ["for value", "为了价值"],
  ["for tempo", "为了节奏"],
  ["dont forget", "别忘了"],
  ["keep an eye", "留意"],
  ["watch out", "注意"],
  ["Id", ""],

  // ── 单字高频词 ──
  ["Tavern", "酒馆"],
  ["tavern", "酒馆"],
  ["minions", "随从"],
  ["minion", "随从"],
  ["heroes", "英雄"],
  ["hero", "英雄"],
  ["spells", "法术"],
  ["spell", "法术"],
  ["tribes", "种族"],
  ["tribe", "种族"],
  ["cards", "卡牌"],
  ["card", "卡牌"],
  ["triples", "三连"],
  ["triple", "三连"],
  ["turns", "回合"],
  ["turn", "回合"],
  ["stats", "身材"],
  ["board", "场面"],
  ["shop", "酒馆"],
  ["fight", "战斗"],
  ["fights", "战斗"],
  ["combat", "战斗"],
  ["game", "对局"],
  ["games", "对局"],
  ["lobby", "对局"],
  ["lobbies", "对局"],
  ["rank", "分段"],
  ["meta", "环境"],
  ["patch", "版本"],
  ["comps", "流派"],
  ["comp", "流派"],
  ["curve", "曲线"],
  ["armor", "护甲"],
  ["health", "血量"],
  ["damage", "伤害"],
  ["attack", "攻击力"],
  ["level", "等级"],
  ["discover", "发现"],
  ["freeze", "冻结"],
  ["roll", "刷新"],
  ["sell", "卖出"],
  ["pick", "选取"],
  ["picks", "选取"],
  ["pick up", "拿取"],
  ["pickup", "拿取"],
  ["take", "拿取"],
  ["keep", "保留"],
  ["hold", "保留"],
  ["play", "打出"],
  ["playing", "打出"],
  ["played", "打出"],
  ["put", "放置"],
  ["place", "放置"],
  ["try", "尝试"],
  ["trying", "尝试"],
  ["get", "获得"],
  ["give", "给予"],
  ["use", "使用"],
  ["using", "使用"],
  ["add", "添加"],
  ["lose", "输掉"],
  ["win", "赢下"],
  ["buy", "购买"],
  ["buying", "购买"],
  ["cost", "花费"],
  ["costs", "花费"],
  ["run", "使用"],
  ["running", "使用"],
  ["work", "有效"],
  ["works", "有效"],
  ["working", "有效"],
  ["buff", "buff"],
  ["buffing", "buff"],
  ["buffs", "buff"],
  ["buff your", "buff你的"],
  ["generate", "生成"],
  ["generates", "生成"],
  ["summon", "召唤"],
  ["summons", "召唤"],
  ["trigger", "触发"],
  ["triggers", "触发"],
  ["protect", "保护"],
  ["protects", "保护"],
  ["cycle", "循环"],
  ["Cycling", "循环"],
  ["cycling", "循环"],
  ["scale", "成长"],
  ["scales", "成长"],
  ["boost", "提升"],
  ["boosts", "提升"],
  ["synergy", "配合"],
  ["synergies", "配合"],
  ["combo", "组合"],
  ["combos", "组合"],
  ["strategy", "策略"],
  ["strategies", "策略"],
  ["complete", "完成"],
  ["beginning", "开局"],
  ["faster", "更快"],
  ["behind", "后方"],
  ["front", "前方"],
  ["early", "早期"],
  ["late", "后期"],
  ["mid", "中期"],
  ["value", "价值"],
  ["tempo", "节奏"],
  ["curve", "曲线"],
  ["pick", "选取"],
  ["picks", "选取"],
  ["pick up", "拿取"],
  ["gold", "铸币"],
  ["Gold", "铸币"],
  ["leveling", "升本"],
  ["level up", "升本"],
  ["level to", "升到"],
  ["rush", "速冲"],
  ["rushing", "速冲"],
  ["force", "强制"],
  ["forcing", "强制"],
  ["freeze", "冻结"],
  ["freezing", "冻结"],
  ["position", "站位"],
  ["positioning", "站位"],
  ["positioned", "站位"],
  ["tech", "针对卡"],
  ["techs", "针对卡"],
  ["discover", "发现"],

  // ── 代词/介词/连词 ──
  ["your", "你的"],
  ["you", "你"],
  ["you re", "你是"],
  ["you ll", "你将会"],
  ["not", "不要"],
  ["it", "它"],
  ["its", "它的"],
  ["they", "他们"],
  ["their", "他们的"],
  ["them", "他们"],
  ["this", "这个"],
  ["that", "那个"],
  ["these", "这些"],
  ["those", "那些"],
  ["there", "那里"],
  ["here", "这里"],
  ["then", "然后"],
  ["than", "比"],
  ["when", "当"],
  ["where", "哪里"],
  ["what", "什么"],
  ["which", ""],
  ["who", "谁"],
  ["how", "如何"],
  ["before", "之前"],
  ["after", "之后"],
  ["during", "期间"],
  ["until", "直到"],
  ["while", "同时"],
  ["through", "通过"],
  ["with", "配合"],
  ["without", "没有"],
  ["into", "成为"],
  ["onto", "到"],
  ["from", "从"],
  ["about", "关于"],
  ["over", "超过"],
  ["under", "之下"],
  ["other", "其他"],
  ["another", "另一个"],
  ["same", "相同"],
  ["own", "自己"],
  ["all", "所有"],
  ["any", "任何"],
  ["few", "少数"],
  ["less", "更少"],
  ["more", "更多"],
  ["much", "多"],
  ["some", "一些"],
  ["each", "每个"],
  ["every", "每个"],
  ["both", "两者"],
  ["once", "一旦"],
  ["again", "再次"],
  ["back", "回"],
  ["now", "现在"],
  ["later", "稍后"],
  ["soon", "很快"],
  ["off", "关闭"],
  ["out", "出"],
  ["up", "上"],
  ["down", "下"],
  ["in", "在"],
  ["on", "在"],
  ["or", "或"],
  ["and", "和"],
  ["but", "但是"],
  ["if", "如果"],
  ["so", "所以"],
  ["to", "到"],
  ["do", "做"],
  ["does", "做"],
  ["did", "做了"],
  ["done", "完成"],
  ["go", "去"],
  ["goes", "去"],
  ["went", "去了"],
  ["got", "得到了"],
  ["get", "得到"],
  ["gets", "得到"],
  ["has", "有"],
  ["had", "有"],
  ["have", "有"],
  ["will", "将"],
  ["would", "会"],
  ["could", "可以"],
  ["should", "应该"],
  ["might", "可能"],
  ["may", "可能"],
  ["can", "可以"],
  ["cannot", "不能"],
  ["wont", "不会"],
  ["dont", "不要"],
  ["doesnt", "不"],
  ["didnt", "没有"],
  ["isnt", "不是"],
  ["was", "是"],
  ["are", "是"],
  ["were", "是"],
  ["been", "被"],
  ["being", "被"],
  ["is", "是"],
  ["be", "是"],
  ["am", "是"],
  ["a", ""],
  ["the", ""],
  ["an", ""],
  ["of", "的"],
  ["as", "作为"],
  ["by", "通过"],
  ["no", "没有"],
  ["not", "不"],
  ["nor", "也不"],

  // ── 方向/位置 ──
  ["left", "左侧"],
  ["right", "右侧"],
  ["first position", "首位"],
  ["first", "首位"],
  ["last position", "末位"],
  ["last", "末位"],
  ["front", "前方"],
  ["behind", "后"],
  ["adjacent", "相邻"],
  ["opposite", "对面"],

  // ── 选牌/发现 ──
  ["discover", "发现"],
  ["discovering", "发现"],
  ["triple reward", "三连奖励"],
  ["triple into", "三连出"],
  ["triple a", "三连"],
  ["tripling", "三连"],
  ["golden", "金色"],
  ["sell", "卖出"],

  // ── 巴布/法术 ──
  ["buddies", "伙伴"],
  ["buddy", "伙伴"],
  ["trinket", "饰品"],
  ["trinkets", "饰品"],
  ["quest", "任务"],
  ["quests", "任务"],
  ["anomaly", "畸变"],
  ["anomalies", "畸变"],

  // ── 数值 ──
  ["attack", "攻击力"],
  ["health", "生命值"],
  ["armor", "护甲"],
  ["cost", "费用"],
  ["stats", "身材"],
];

// ═══════════════════════════════════════════════════════════
// HTTP 工具
// ═══════════════════════════════════════════════════════════

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "bob-coach/1.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return httpGet(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            buffer: Buffer.concat(chunks),
            encoding: res.headers["content-encoding"] || "",
          });
        });
      })
      .on("error", reject);
  });
}

async function fetchJSON(url) {
  const { buffer, encoding } = await httpGet(url);
  if (encoding === "gzip" || (buffer[0] === 0x1f && buffer[1] === 0x8b)) {
    return JSON.parse(zlib.gunzipSync(buffer).toString("utf-8"));
  }
  return JSON.parse(buffer.toString("utf-8"));
}

// ── 本地 meta_info ──
function loadMetaInfo() {
  try {
    if (fs.existsSync(META_INFO_PATH)) {
      return JSON.parse(fs.readFileSync(META_INFO_PATH, "utf-8"));
    }
  } catch (_) {}
  return {};
}

function saveMetaInfo(info) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(META_INFO_PATH, JSON.stringify(info, null, 2), "utf-8");
}

// ═══════════════════════════════════════════════════════════
// 卡牌名翻译表构建（从 Gamerhub 数据 English→Chinese）
// ═══════════════════════════════════════════════════════════

function normaliseName(name) {
  return name.replace(/[,']/g, "").replace(/['’‘]/g, "").replace(/\s+/g, " ").trim();
}

// 已知卡牌简称（Firestone tips 常用简称 → 中文全名）
const CARD_NICKNAME_CN = {
  Brann: "布莱恩·铜须",
  Titus: "提图斯·瑞文戴尔",
  Kalecgos: "卡雷苟斯",
  "Kalecgos Arcane Aspect": "卡雷苟斯",
  Rylak: "重金属双头飞龙",
  Murkeye: "老瞎眼",
  MurkEye: "老瞎眼",
  Sneed: "斯尼德",
  "Sneeds": "斯尼德",
  Rivendare: "瑞文戴尔",
  "Baron Rivendare": "瑞文戴尔",
  Goldrinn: "巨狼戈德林",
  Macaw: "巨大的金刚鹦鹉",
  Mekkatorque: "格尔宾·梅卡托克",
  Toki: "时光修补匠托奇",
  Jaraxxus: "加拉克苏斯",
  Nzoth: "恩佐斯",
  "N'Zoth": "恩佐斯",
  Cthun: "克苏恩",
  "C'Thun": "克苏恩",
  Yogg: "尤格萨隆",
  "Yogg-Saron": "尤格萨隆",
  Sylvanas: "希尔瓦娜斯",
  Teron: "塔隆·血魔",
  Guff: "古夫·符文图腾",
  Rakanishu: "拉卡尼休",
  Shudderwock: "沙德沃克",
  Alakir: "奥拉基尔",
  "Al'Akir": "奥拉基尔",
  Zephrys: "杰弗里斯",
  Elise: "伊莉斯·逐星",
  George: "乔治",
  Flurgl: "弗洛格尔",
  Tavish: "塔维什",
  LichKing: "巫妖王",
  "The Lich King": "巫妖王",
  "lich king": "巫妖王",
  Automaton: "星元自动机",
  "Deflect-o-Bot": "偏折机器人",
  "Deflecto Bot": "偏折机器人",
  "Pack Tactics": "兽群战术",
  "pack tactics": "兽群战术",
  Venomstrike: "烈毒打击",
  venomstrike: "烈毒打击",
  Mecaw: "巨大的金刚鹦鹉",
  mecaw: "巨大的金刚鹦鹉",
  "Persistent Poet": "执念诗心龙",
  Tarecgosa: "泰蕾苟萨",
  "Kalycgos": "卡雷苟斯",
};

function buildCardNameMap(cardsData) {
  const inner = cardsData.data || cardsData;
  const categories = Object.keys(inner).filter((k) => Array.isArray(inner[k]));
  const map = {};

  for (const cat of categories) {
    for (const c of inner[cat]) {
      if (c.name && c.nameCN) {
        map[c.name] = c.nameCN;
        const norm = normaliseName(c.name);
        if (norm !== c.name) map[norm] = c.nameCN;
        map[c.name.toLowerCase()] = c.nameCN;
        if (norm !== c.name) map[norm.toLowerCase()] = c.nameCN;
      }
      if (c.strId && c.nameCN) {
        map["__ID__" + c.strId] = c.nameCN;
      }
    }
  }
  // 合并已知简称
  for (const [nick, cn] of Object.entries(CARD_NICKNAME_CN)) {
    if (!map[nick]) map[nick] = cn;
    if (!map[nick.toLowerCase()]) map[nick.toLowerCase()] = cn;
  }
  return map;
}

// ═══════════════════════════════════════════════════════════
// Tip 文本翻译：替换英文卡牌名和游戏术语为中文
// ═══════════════════════════════════════════════════════════

// 这些英文单词即使 >=4 字符也不应被当作卡牌名替换
const STOP_WORDS = new Set([
  "into", "your", "with", "that", "this", "from", "they", "them", "their",
  "have", "will", "when", "then", "than", "what", "some", "more", "each",
  "every", "both", "once", "like", "just", "only", "also", "very", "even",
  "well", "most", "many", "much", "make", "made", "good", "best", "keep",
  "take", "play", "need", "want", "give", "find", "look", "come", "goes",
  "back", "down", "over", "about", "other", "same", "still", "really",
  "there", "here", "where", "while", "until", "after", "before", "during",
  "could", "would", "should", "might", "never", "always", "first", "last",
  "next", "left", "right", "hand", "face", "turn", "shop", "minion",
  "spell", "hero", "card", "cost", "attack", "health", "armor", "level",
  "early", "late", "away", "work", "used", "gets", "does", "game", "fight",
  "gold", "pick", "case", "power", "beast", "dragon", "demon", "mech",
  "murloc", "naga", "pirate", "quillboar", "undead", "elemental",
  "neutral", "tier", "board",
]);

function translateTipText(text, cardNameMap) {
  if (!text) return "";
  let result = normaliseName(text);

  // Pre-process: split hyphenated compounds "game-changing" → "game changing"
  result = result.replace(/([a-z])-([a-z])/gi, "$1 $2");

  // Pre-process: split camelCase compounds "Earlygame" → "Early game", "midgame" → "mid game"
  result = result.replace(/([a-z])([A-Z])/g, "$1 $2");
  result = result.replace(/\b([A-Z][a-z]+)([A-Z][a-z]+)\b/g, "$1 $2");

  // Pre-process: split common fused compounds
  result = result.replace(/\bearlygame\b/gi, "early game");
  result = result.replace(/\bmidgame\b/gi, "mid game");
  result = result.replace(/\blategame\b/gi, "late game");
  result = result.replace(/\bendgame\b/gi, "end game");
  result = result.replace(/\bheropower\b/gi, "hero power");
  result = result.replace(/\bheropowering\b/gi, "hero powering");
  result = result.replace(/\bheros\b/gi, "heroes");
  result = result.replace(/\byoud\b/gi, "you would");
  result = result.replace(/\btaverns\b/gi, "tavern");
  result = result.replace(/\bunits\b/gi, "minions");
  result = result.replace(/\bunit\b/gi, "minion");
  result = result.replace(/\bhim\b/gi, "他");
  result = result.replace(/\bbeast\b/gi, "野兽");

  // Pre-process: normalize apostrophe contractions
  // "don't"→"dont", "won't"→"wont" etc. are handled via TERM_CN_LIST entries
  // but "I'll"→"I will", "you're"→"you are" need expansion
  result = result.replace(/\bI'll\b/gi, "I will");
  result = result.replace(/\bI've\b/gi, "I have");
  result = result.replace(/\bI'd\b/gi, "I would");
  result = result.replace(/\bwe'll\b/gi, "we will");
  result = result.replace(/\bwe've\b/gi, "we have");
  result = result.replace(/\bwe're\b/gi, "we are");
  result = result.replace(/\bit's\b/gi, "it is");
  result = result.replace(/\bthat's\b/gi, "that is");
  result = result.replace(/\bwhat's\b/gi, "what is");
  result = result.replace(/\bhere's\b/gi, "here is");
  result = result.replace(/\bthere's\b/gi, "there is");
  result = result.replace(/\blet's\b/gi, "let us");

  // Step 1: Replace card names FIRST (protect them from term regex corruption)
  const seen = new Set();
  const namesByLength = Object.keys(cardNameMap)
    .filter((k) => !k.startsWith("__ID__") && k.length >= 4 && !STOP_WORDS.has(k.toLowerCase()))
    .filter((k) => !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()))
    .sort((a, b) => b.length - a.length);

  for (const en of namesByLength) {
    const escaped = en.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const re = new RegExp("\\b" + escaped + "\\b", "gi");
    result = result.replace(re, (match) => cardNameMap[match] || cardNameMap[match.toLowerCase()] || cardNameMap[en]);
  }

  // Step 2: Apply game terms sorted longest-first, with word boundaries
  const sortedTerms = [...TERM_CN_LIST].sort((a, b) => b[0].length - a[0].length);
  for (const [en, cn] of sortedTerms) {
    const escaped = en.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const bounded = /^[a-zA-Z0-9\s]+$/.test(en) ? "\\b" + escaped + "\\b" : escaped;
    const re = new RegExp(bounded, "gi");
    result = result.replace(re, cn);
  }

  // Step 3: Clean up double spaces
  result = result.replace(/\s{2,}/g, " ").trim();

  return result;
}

function translateCardInComp(card, cardNameMap) {
  const en = card.name || "";
  return {
    ...card,
    name_cn: cardNameMap[en] || cardNameMap[normaliseName(en)] || cardNameMap[en.toLowerCase()] || en,
    tips: (card.tips || []).map((t) =>
      typeof t === "string" ? translateTipText(t, cardNameMap) : t
    ),
  };
}

function translateTips(tips, cardNameMap) {
  return tips.map((t) => {
    if (typeof t === "string") return translateTipText(t, cardNameMap);
    return {
      ...t,
      tip: translateTipText(t.tip || "", cardNameMap),
      summary: translateTipText(t.summary || "", cardNameMap),
      whenToCommit: translateTipText(t.whenToCommit || "", cardNameMap),
    };
  });
}

// ═══════════════════════════════════════════════════════════
// 数据转换（含翻译）
// ═══════════════════════════════════════════════════════════

function transformCards(apiData) {
  const inner = apiData.data || apiData;
  const categories = Object.keys(inner).filter((k) => Array.isArray(inner[k]));
  const allCards = [];
  for (const cat of categories) {
    for (const c of inner[cat]) {
      const card = {
        str_id: c.strId,
        name: c.name || "",
        name_cn: c.nameCN || "",
        card_type: c.cardType || "",
        text_cn: c.text || "",
        mechanics: c.mechanics || [],
        img: c.img || "",
      };
      const ct = c.cardType;
      if (ct === "minion" || ct === "companion") {
        card.tier = c.tier || 0;
        card.attack = c.attack || 0;
        card.health = c.health || 0;
        card.minion_types_cn = c.minionTypesCN || [];
        card.upgrade_id = (c.upgradeCard && c.upgradeCard.strId) || "";
      } else if (ct === "hero") {
        card.armor = c.armor || 0;
        card.health = c.health || 30;
        card.hp_ids = (c.heroPowerList || []).map((hp) => hp.strId || "").filter(Boolean);
        card.buddy_id = (c.buddy && c.buddy.strId) || "";
      } else if (ct === "hero power") {
        card.mana_cost = c.manaCost || 0;
      } else if (ct === "trinket" || ct === "timewarp") {
        card.mana_cost = c.manaCost || 0;
        card.lesser = c.lesser || false;
        card.extra = c.extra || [];
        if (ct === "timewarp") card.tier = c.tier || 0;
      }
      allCards.push(card);
    }
  }
  return { cards: allCards };
}

function transformHeroStats(apiData, cardNameMap) {
  const heroStats = apiData.heroStats || [];
  return {
    heroStats: heroStats.map((h) => ({
      hero_card_id: h.heroCardId,
      name_cn: cardNameMap["__ID__" + h.heroCardId] || h.heroCardId,
      avg_position: h.averagePosition || 0,
      data_points: h.dataPoints || 0,
      placements: h.placementDistribution || [],
      tribe_stats: h.tribeStats || [],
    })),
    lastUpdateDate: apiData.lastUpdateDate || "",
  };
}

function transformCompStrategies(apiData, cardNameMap) {
  const comps = Array.isArray(apiData) ? apiData : apiData.comps || [];
  return comps
    .filter((c) => c.compId && c.cards && c.cards.length > 0)
    .map((c) => ({
      compId: c.compId,
      name: c.name || "",
      name_cn: COMP_NAME_CN[c.name] || c.name || "",
      patchNumber: c.patchNumber || "",
      difficulty: c.difficulty || "",
      powerLevel: c.powerLevel || "",
      forcedTribes: (c.forcedTribes || []).map((t) => translateTipText(t, cardNameMap)),
      cards: (c.cards || []).map((card) => translateCardInComp(card, cardNameMap)),
      tips: translateTips(c.tips || [], cardNameMap),
    }));
}

function transformHeroStrategies(apiData, cardNameMap) {
  return {
    heroes: (apiData.heroes || []).map((h) => ({
      cardId: h.cardId,
      name: h.name || "",
      name_cn: cardNameMap["__ID__" + h.cardId] || h.name || "",
      tips: translateTips(h.tips || [], cardNameMap),
    })),
    curves: apiData.curves || [],
  };
}

function transformTrinketTips(apiData, cardNameMap) {
  const arr = Array.isArray(apiData) ? apiData : apiData.trinkets || [];
  return arr.map((t) => ({
    cardId: t.cardId,
    name: t.name || "",
    name_cn: cardNameMap["__ID__" + t.cardId] || t.name || "",
    tips: translateTips(t.tips || [], cardNameMap),
  }));
}

// ═══════════════════════════════════════════════════════════
// 保存 JSON
// ═══════════════════════════════════════════════════════════

function saveJSON(name, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name + ".json"), JSON.stringify(data, null, 2), "utf-8");
}

// ═══════════════════════════════════════════════════════════
// 检查更新
// ═══════════════════════════════════════════════════════════

async function checkForUpdates() {
  const meta = loadMetaInfo();
  const available = {};

  try {
    const cardsData = await fetchJSON(GAMERHUB_CARDS_URL);
    const inner = cardsData.data || cardsData;
    const categories = Object.keys(inner).filter((k) => Array.isArray(inner[k]));
    let totalCards = 0;
    for (const cat of categories) totalCards += inner[cat].length;
    if (totalCards !== meta.cardsCount) {
      available.cards = { count: totalCards, oldCount: meta.cardsCount || 0 };
    }
  } catch (e) {
    console.error("[sync] Cards fetch failed:", e.message);
  }

  try {
    const hsData = await fetchJSON(FIRESTONE_HERO_STATS);
    const newDate = hsData.lastUpdateDate || "";
    if (newDate && newDate !== meta.heroStatsDate) {
      available.heroStats = { date: newDate, oldDate: meta.heroStatsDate || "无" };
    }
  } catch (e) {
    console.error("[sync] Hero stats fetch failed:", e.message);
  }

  try {
    const compData = await fetchJSON(FIRESTONE_COMP_STRAT);
    const comps = Array.isArray(compData) ? compData : compData.comps || [];
    const validComps = comps.filter((c) => c.compId && c.cards && c.cards.length > 0);
    if (validComps.length !== meta.compStrategyCount) {
      available.compStrategies = { count: validComps.length, oldCount: meta.compStrategyCount || 0 };
    }
  } catch (e) {
    console.error("[sync] Comp strategies fetch failed:", e.message);
  }

  try {
    const heroStratData = await fetchJSON(FIRESTONE_HERO_STRAT);
    const heroCount = (heroStratData.heroes || []).length;
    if (heroCount !== meta.heroStrategyCount) {
      available.heroStrategies = { count: heroCount, oldCount: meta.heroStrategyCount || 0 };
    }
  } catch (e) {
    console.error("[sync] Hero strategies fetch failed:", e.message);
  }

  try {
    const trinketData = await fetchJSON(FIRESTONE_TRINKET_STRAT);
    const arr = Array.isArray(trinketData) ? trinketData : trinketData.trinkets || [];
    if (arr.length !== meta.trinketTipCount) {
      available.trinketTips = { count: arr.length, oldCount: meta.trinketTipCount || 0 };
    }
  } catch (e) {
    console.error("[sync] Trinket tips fetch failed:", e.message);
  }

  meta.lastSyncCheck = new Date().toISOString();
  saveMetaInfo(meta);

  return { available, meta };
}

// ═══════════════════════════════════════════════════════════
// 应用更新（下载 + 翻译 + 保存）
// ═══════════════════════════════════════════════════════════

async function applyUpdates(selectedSources) {
  const meta = loadMetaInfo();
  const applied = [];
  const errors = [];

  // Fetch Gamerhub cards first for the English→Chinese name map
  let cardNameMap = {};
  let cardValidationIndex = null;
  let currentPatch = 0;

  try {
    const cardsData = await fetchJSON(GAMERHUB_CARDS_URL);
    cardNameMap = buildCardNameMap(cardsData);
    cardValidationIndex = buildCardValidationIndex(cardsData);
    currentPatch = extractCurrentPatch(cardsData);
  } catch (e) {
    console.error("[sync] Failed to build card name map:", e.message);
  }

  const tasks = [];

  if (selectedSources.includes("cards")) {
    tasks.push(
      fetchJSON(GAMERHUB_CARDS_URL)
        .then((data) => {
          const t = transformCards(data);
          saveJSON("cards", t.cards);
          meta.cardsCount = t.cards.length;
          applied.push("cards");
        })
        .catch((e) => errors.push("cards: " + e.message))
    );
  }

  if (selectedSources.includes("heroStats")) {
    tasks.push(
      fetchJSON(FIRESTONE_HERO_STATS)
        .then((data) => {
          const t = transformHeroStats(data, cardNameMap);
          saveJSON("hero_stats", t.heroStats);
          meta.heroStatsDate = t.lastUpdateDate;
          applied.push("heroStats");
        })
        .catch((e) => errors.push("heroStats: " + e.message))
    );
  }

  if (selectedSources.includes("compStrategies")) {
    tasks.push(
      fetchJSON(FIRESTONE_COMP_STRAT)
        .then((data) => {
          const comps = transformCompStrategies(data, cardNameMap);
          if (cardValidationIndex) {
            validateCompStrategies(comps, cardValidationIndex, currentPatch);
          }
          saveJSON("comp_strategies", comps);
          meta.compStrategyCount = comps.length;
          applied.push("compStrategies");
        })
        .catch((e) => errors.push("compStrategies: " + e.message))
    );
  }

  if (selectedSources.includes("heroStrategies")) {
    tasks.push(
      fetchJSON(FIRESTONE_HERO_STRAT)
        .then((data) => {
          const t = transformHeroStrategies(data, cardNameMap);
          if (cardValidationIndex) {
            validateHeroTips(t, cardValidationIndex, currentPatch);
          }
          const tipsMap = {};
          for (const h of t.heroes) {
            tipsMap[h.cardId] = { name: h.name_cn || h.name, tips: h.tips };
          }
          saveJSON("hero_tips", { tips: tipsMap, curves: t.curves,
            _validation: { currentPatch, validatedAt: new Date().toISOString() }
          });
          meta.heroStrategyCount = t.heroes.length;
          applied.push("heroStrategies");
        })
        .catch((e) => errors.push("heroStrategies: " + e.message))
    );
  }

  if (selectedSources.includes("trinketTips")) {
    tasks.push(
      fetchJSON(FIRESTONE_TRINKET_STRAT)
        .then((data) => {
          const arr = transformTrinketTips(data, cardNameMap);
          const tipsMap = {};
          for (const t of arr) {
            tipsMap[t.cardId] = { name: t.name_cn || t.name, tips: t.tips };
          }
          saveJSON("trinket_tips", tipsMap);
          meta.trinketTipCount = arr.length;
          applied.push("trinketTips");
        })
        .catch((e) => errors.push("trinketTips: " + e.message))
    );
  }

  await Promise.all(tasks);

  meta.lastSyncApplied = new Date().toISOString();
  saveMetaInfo(meta);

  return { applied, errors, meta };
}

// ═══════════════════════════════════════════════════════════
// 获取同步状态
// ═══════════════════════════════════════════════════════════

function getSyncStatus() {
  const meta = loadMetaInfo();
  const dataFiles = {};
  const fileNames = ["cards", "hero_stats", "comp_strategies", "hero_tips", "trinket_tips", "decision_tables"];
  for (const name of fileNames) {
    const fp = path.join(DATA_DIR, name + ".json");
    if (fs.existsSync(fp)) {
      try {
        const stat = fs.statSync(fp);
        let size = 0;
        try {
          const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
          size = Array.isArray(raw) ? raw.length : Object.keys(raw).length;
        } catch (_) {}
        dataFiles[name] = { size, mtime: stat.mtime.toISOString() };
      } catch (_) {}
    }
  }

  return {
    cardsCount: meta.cardsCount || 0,
    cardsVersion: meta.cardsCount ? `${meta.cardsCount} 张` : "未同步",
    heroStatsDate: meta.heroStatsDate || "未同步",
    compStrategyCount: meta.compStrategyCount || 0,
    heroStrategyCount: meta.heroStrategyCount || 0,
    trinketTipCount: meta.trinketTipCount || 0,
    lastSyncCheck: meta.lastSyncCheck || null,
    lastSyncApplied: meta.lastSyncApplied || null,
    dataFiles,
  };
}

function shouldAutoCheck() {
  const meta = loadMetaInfo();
  if (!meta.lastSyncCheck) return true;
  const elapsed = Date.now() - new Date(meta.lastSyncCheck).getTime();
  return elapsed >= 7 * 24 * 3600 * 1000;
}

// ═══════════════════════════════════════════════════════════
// 攻略新鲜度验证
// ═══════════════════════════════════════════════════════════

function buildCardValidationIndex(cardsApiData) {
  const inner = cardsApiData.data || cardsApiData;
  const categories = Object.keys(inner).filter((k) => Array.isArray(inner[k]));

  const byCnName = {};
  const byEnNameLower = {};
  const byId = {};
  const cnNamesSorted = [];

  for (const cat of categories) {
    for (const c of inner[cat]) {
      const cardType = c.cardType || "";
      // 排除英雄/技能（不会被攻略引用，且英雄名会污染自由文本匹配）
      if (cardType === "hero" || cardType === "hero power") continue;

      const strId = c.strId;
      const nameCN = c.nameCN || "";
      const nameEN = c.name || "";
      const tier = c.tier || 0;

      if (!strId) continue;

      const entry = { cardId: strId, name: nameEN, name_cn: nameCN, tier };

      byId[strId] = entry;
      if (nameCN) {
        byCnName[nameCN] = entry;
        cnNamesSorted.push(nameCN);
      }
      if (nameEN) {
        byEnNameLower[nameEN.toLowerCase()] = entry;
        const norm = normaliseName(nameEN).toLowerCase();
        if (norm !== nameEN.toLowerCase()) byEnNameLower[norm] = entry;
      }
    }
  }

  cnNamesSorted.sort((a, b) => b.length - a.length);

  return { byCnName, byEnNameLower, byId, cnNamesSorted };
}

function extractCurrentPatch(cardsApiData) {
  const inner = cardsApiData.data || cardsApiData;
  const categories = Object.keys(inner).filter((k) => Array.isArray(inner[k]));
  for (const cat of categories) {
    for (const c of inner[cat]) {
      const img = c.img || "";
      // Image URL pattern: /all_images/35.2.2.241135/BGS_004_battlegroundsImage.png
      // Extract the last numeric sub-version (build/patch number) before filename
      // Image URL: .../all_images/35.2.2.241135/BGS_004_...png
      // Match the last dot-separated version number (build/patch)
      const m = img.match(/\.(\d{4,})\//);
      if (m) return parseInt(m[1], 10);
    }
  }
  return 0;
}

function extractBracketRefs(text) {
  if (!text) return [];
  const re = /\[\[(.+?)\]\]/g;
  const refs = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].trim();
    if (!raw || raw === "") continue;
    if (raw.includes("||")) continue; // malformed ref
    // Split mixed Chinese/English content (e.g., "布莱恩·铜须 Bronzbeard")
    const parts = raw.split(/\s+(?=[a-zA-Z])/);
    const chineseParts = [];
    const englishParts = [];
    for (const p of parts) {
      const trimmed = p.trim();
      if (!trimmed) continue;
      if (/[一-鿿]/.test(trimmed)) {
        chineseParts.push(trimmed);
      } else if (/[a-zA-Z]{2,}/.test(trimmed)) {
        englishParts.push(trimmed);
      } else {
        chineseParts.push(trimmed);
      }
    }
    refs.push({
      raw,
      names: [...new Set([...chineseParts, ...englishParts])],
    });
  }
  return refs;
}

function extractPlainTextCardRefs(text, index) {
  if (!text) return [];
  const found = new Set();
  const results = [];
  // Longest-first scan
  for (const cnName of index.cnNamesSorted) {
    if (cnName.length < 3) continue;
    if (text.includes(cnName)) {
      found.add(cnName);
      // Mask matched region to avoid double-counting substrings
      text = text.split(cnName).join("█".repeat(cnName.length));
    }
  }
  for (const name of found) {
    const card = index.byCnName[name];
    results.push({
      name,
      cardId: card ? card.cardId : null,
      matched: !!card,
    });
  }
  return results;
}

function validateCardRef(refName, index) {
  const empty = { matched: false, cardId: null, name_cn: null, tier: null, originalRef: refName };

  if (!refName) return empty;

  // 1. Exact Chinese match
  if (index.byCnName[refName]) {
    const c = index.byCnName[refName];
    return { matched: true, cardId: c.cardId, name_cn: c.name_cn, tier: c.tier, originalRef: refName };
  }

  // 2. Exact English match
  const enLower = refName.toLowerCase();
  if (index.byEnNameLower[enLower]) {
    const c = index.byEnNameLower[enLower];
    return { matched: true, cardId: c.cardId, name_cn: c.name_cn, tier: c.tier, originalRef: refName };
  }

  // 3. Chinese substring match (refName is partial, full name exists)
  for (const cnName of index.cnNamesSorted) {
    if (cnName.includes(refName) && cnName.length >= refName.length + 1) {
      const c = index.byCnName[cnName];
      return { matched: true, cardId: c.cardId, name_cn: c.name_cn, tier: c.tier, originalRef: refName };
    }
  }

  // 4. Nickname alias fallback
  const nicknameCn = CARD_NICKNAME_CN[refName] || CARD_NICKNAME_CN[enLower];
  if (nicknameCn && index.byCnName[nicknameCn]) {
    const c = index.byCnName[nicknameCn];
    return { matched: true, cardId: c.cardId, name_cn: c.name_cn, tier: c.tier, originalRef: refName };
  }

  return empty;
}

function computeFreshnessScore(tip, validatedRefs, currentPatch) {
  const totalRefs = validatedRefs.length;
  const validRefs = validatedRefs.filter((r) => r.matched).length;
  const missingRefs = validatedRefs.filter((r) => !r.matched).map((r) => ({ name: r.originalRef }));
  const validCards = validatedRefs.filter((r) => r.matched).map((r) => ({
    name: r.name_cn || r.originalRef,
    cardId: r.cardId,
    tier: r.tier,
  }));

  // Age score: based on patch field (hero tips: "patch", comp tips: "patchNumber")
  const tipPatch = tip.patch || tip.patchNumber || 0;
  const tipDate = tip.date || "";
  let tipAgeDays = 0;
  if (tipDate) {
    tipAgeDays = (Date.now() - new Date(tipDate).getTime()) / (86400 * 1000);
  } else if (currentPatch > 0 && tipPatch > 0) {
    // Estimate: ~14 days per patch cycle
    tipAgeDays = ((currentPatch - tipPatch) / 14) * 7;
  }
  tipAgeDays = Math.max(0, Math.min(tipAgeDays, 730));

  const ageScore = Math.round(50 * Math.max(0, 1 - tipAgeDays / 365));
  const refScore = totalRefs > 0 ? Math.round(50 * (validRefs / totalRefs)) : 50;
  const score = ageScore + refScore;

  let status = "fresh";
  if (score < 50) status = "outdated";
  else if (score < 80) status = "stale";

  return {
    score,
    status,
    tipAgeDays: Math.round(tipAgeDays),
    totalRefs,
    validRefs,
    missingRefs,
    validCards,
    sourcePatch: tipPatch,
    currentPatch,
  };
}

function validateHeroTips(heroData, index, currentPatch) {
  if (!heroData || !heroData.heroes) return heroData;

  for (const hero of heroData.heroes) {
    for (const tip of hero.tips || []) {
      // Combine all text fields
      const allText = (tip.summary || "") + " " + (tip.tip || "") + " " + (tip.whenToCommit || "");

      // Extract [[refs]] from bracket formatting
      const summaryRefs = extractBracketRefs(tip.summary || "");
      const tipRefs = extractBracketRefs(tip.tip || "");
      const whenRefs = extractBracketRefs(tip.whenToCommit || "");
      const allBracketRefs = [...summaryRefs, ...tipRefs, ...whenRefs];

      // Collect unique ref names from brackets
      const uniqueNames = new Set();
      for (const ref of allBracketRefs) {
        for (const name of ref.names) {
          uniqueNames.add(name);
        }
      }

      // Fallback: if no bracket refs found, scan plain text for known card names
      if (uniqueNames.size === 0) {
        const plainRefs = extractPlainTextCardRefs(allText, index);
        for (const ref of plainRefs) {
          if (ref.matched) uniqueNames.add(ref.name);
        }
      }

      // Validate each unique ref name
      const validatedRefs = [];
      for (const name of uniqueNames) {
        validatedRefs.push(validateCardRef(name, index));
      }

      // Compute and attach freshness
      tip.freshness = computeFreshnessScore(tip, validatedRefs, currentPatch);
    }
  }

  return heroData;
}

function validateCompStrategies(comps, index, currentPatch) {
  if (!Array.isArray(comps)) return comps;

  for (const comp of comps) {
    // Validate explicit cards array (by cardId)
    let validCardIds = 0;
    let totalCardIds = 0;
    for (const card of comp.cards || []) {
      totalCardIds++;
      const exists = !!index.byId[card.cardId];
      if (exists) validCardIds++;
      card.freshness = {
        exists,
        currentTier: exists ? index.byId[card.cardId].tier : null,
      };
    }

    // Validate tips
    const tipScores = [];
    for (const tip of comp.tips || []) {
      // Extract plain-text card names from tip text
      const tipNames = extractPlainTextCardRefs(
        (tip.tip || "") + " " + (tip.summary || "") + " " + (tip.whenToCommit || ""),
        index
      );

      // Also check card names from comp.cards array that appear in tip text
      const tipText = (tip.tip || "") + " " + (tip.summary || "") + " " + (tip.whenToCommit || "");
      for (const card of comp.cards || []) {
        if (card.name_cn && tipText.includes(card.name_cn)) {
          const alreadyFound = tipNames.some((r) => r.name === card.name_cn);
          if (!alreadyFound) {
            tipNames.push({
              name: card.name_cn,
              cardId: card.cardId,
              matched: !!index.byId[card.cardId],
            });
          }
        }
      }

      // Validate unique ref names
      const uniqueNames = new Set();
      const validatedRefs = [];
      for (const ref of tipNames) {
        if (uniqueNames.has(ref.name)) continue;
        uniqueNames.add(ref.name);
        if (ref.cardId && index.byId[ref.cardId]) {
          validatedRefs.push({
            matched: true,
            cardId: ref.cardId,
            name_cn: ref.name,
            tier: index.byId[ref.cardId].tier,
            originalRef: ref.name,
          });
        } else {
          const result = validateCardRef(ref.name, index);
          validatedRefs.push(result);
        }
      }

      // Attach per-tip freshness
      tip.freshness = computeFreshnessScore(tip, validatedRefs, currentPatch);
      tipScores.push(tip.freshness.score);
    }

    // Comp-level freshness
    const cardScore = totalCardIds > 0 ? Math.round(60 * (validCardIds / totalCardIds)) : 30;
    const avgTipScore = tipScores.length > 0
      ? Math.round(tipScores.reduce((a, b) => a + b, 0) / tipScores.length)
      : 50;
    const compScore = cardScore + Math.round(avgTipScore * 0.4);

    comp.freshness = {
      score: Math.min(100, compScore),
      status: compScore >= 80 ? "fresh" : compScore >= 50 ? "stale" : "outdated",
      cardValidity: { total: totalCardIds, valid: validCardIds, missing: totalCardIds - validCardIds },
      avgTipScore,
      currentPatch,
    };
  }

  return comps;
}

module.exports = { checkForUpdates, applyUpdates, getSyncStatus, shouldAutoCheck };
