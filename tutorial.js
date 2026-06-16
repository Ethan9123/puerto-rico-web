// ============================================================
// tutorial.js — 新手引导教程（聚光灯高亮 + 气泡解说）
// ------------------------------------------------------------
// 为【基础游戏 + 三个扩展】各做一个引导：开一局静态牌面(new Game+render,
// 不跑 AI 回合),逐步用聚光灯高亮某个 UI 元素并在旁边气泡里解说"这是什么/怎么用"。
// 依赖 game.js 的全局: Game / render / hideHoverTooltip / G。绝不调用 runMainLoop()。
// ============================================================
(function () {
  "use strict";

  // ---------- 四个教程的内容 ----------
  // 每步: { target: CSS选择器(空=居中无聚光灯), title, html }
  const TOURS = {
    // === 基础玩法（用 4 人局以便 7 个角色全部出现） ===
    base: {
      expansion: "none", buccaneer: false, players: 4, title: "基础玩法",
      steps: [
        { target: null, title: "欢迎来到波多黎各 🌴",
          html: "目标很简单：<b>终局攒到最多胜利点 ⭐(VP) 的人获胜</b>。<br>每回合大家轮流挑一个「角色」，全场都执行这个角色的动作，挑选者还多一份特权。下面带你认识牌面与玩法。" },
        { target: "#game-info", title: "回合与总督 👑",
          html: "这里显示第几回合、谁是<b>总督</b>。总督本回合<b>最先选角色</b>；一轮结束后总督顺延给下家，保证轮流先手。" },
        { target: "#roles", title: "角色区（游戏的核心）",
          html: "每回合玩家轮流从这 7 张角色里挑 1 张。<b>你挑了哪个，全场(含对手)都执行它的动作</b>，但你作为挑选者多一份特权。被挑过的角色这一回合不能再被挑。" },
        { target: ".role-card.role-Settler", title: "① 拓殖者",
          html: "每人拿 1 块<b>种植园</b>(原料产地)。挑选者优先选，并且能改拿<b>采石场</b>(建筑打折)。" },
        { target: ".role-card.role-Mayor", title: "② 市长",
          html: "从殖民者船补人，全场按座位轮流分配<b>殖民者 👷</b>。挑选者额外 +1 人。殖民者用来「激活」种植园和建筑——<b>没人就不工作</b>。" },
        { target: ".role-card.role-Builder", title: "③ 建造师",
          html: "每人可建 1 栋<b>建筑</b>。挑选者建造费 <b>-1 金</b>。建筑提供胜利点和各种特殊能力。" },
        { target: ".role-card.role-Craftsman", title: "④ 工匠",
          html: "全场按产能<b>生产货物</b>(需要「有人的种植园 + 有人的加工厂」配套；玉米只要有人的田)。挑选者额外多拿 1 个本轮产出过的货。" },
        { target: ".role-card.role-Trader", title: "⑤ 商人",
          html: "每人可卖 1 种货到贸易站<b>换钱 💰</b>。挑选者卖货 +1 金。钱用来建造。" },
        { target: ".role-card.role-Captain", title: "⑥ 船长",
          html: "全场轮流把货<b>装船</b>——<b>每运 1 个货 = 1 胜利点 ⭐！</b>这是得分主线。挑选者本阶段首次装船 +1VP。阶段末没装上的货会损耗(仓库可留)。" },
        { target: ".role-card.role-Prospector", title: "⑦ 金矿主",
          html: "只有挑选者 <b>+1 金</b>，其他人不做事。用来补钱凑建造门槛，或当作「过桥」的安全牌。" },
        { target: "#plantations-pool", title: "种植园池",
          html: "拓殖者从这里拿地。田产出 5 种原料：<b>玉米/靛蓝/蔗糖/烟草/咖啡</b>。每轮拓殖者阶段会翻出新的田。" },
        { target: '#plantations-pool .plantation[data-pool-quarry="1"]', title: "采石场 🪨",
          html: "特殊的「田」，不产货，但能<b>抵建筑费用</b>——你有几个<b>有人的</b>采石场，建造紫色建筑就便宜几金。" },
        { target: "#buildings-pool", title: "建筑市场",
          html: "建造师阶段从这里买建筑。分 4 行(按采石场折扣等级 1–4)，越往下越贵越强。每种建筑数量有限，<b>先到先得</b>。" },
        { target: "#buildings-pool .building-card.production", title: "生产建筑",
          html: "把种植园原料<b>加工成货物</b>(如制糖厂把蔗糖田的产出变成蔗糖货)。要产货：<b>田和加工厂都得有人</b>。" },
        { target: "#buildings-pool .building-card.violet", title: "紫色建筑",
          html: "不产货，但提供<b>特权强化 / 额外能力 / 终局胜利点</b>(如市场、港口、各种大建筑)。是策略变化的来源。" },
        { target: "#ships", title: "船 🚢",
          html: "船长阶段在这里装船得分。规则：<b>每艘船只能装同一种货</b>，且不同船不能装一样的货。这是把货变成胜利点的地方。" },
        { target: ".trader", title: "贸易站",
          html: "商人阶段卖货换钱的地方，最多 4 格；满了下次商人阶段会清空。注意：<b>同种货全场只能卖一个</b>(已在站里的不能再卖)。" },
        { target: "#resources-info", title: "供应区 / 银行",
          html: "公共库存：5 种货物供应、殖民者 👷、胜利点 ⭐、采石场 🪨 还剩多少。<b>这些耗尽会触发游戏结束</b>。" },
        { target: '.player-board[data-player="0"]', title: "你的封地",
          html: "这是你的个人板：种植园、建筑、货物、统计。对手的板块在旁边，<b>所有信息公开</b>，方便对比与卡位。" },
        { target: '.player-board[data-player="0"] [data-stat="vp"]', title: "胜利点 ⭐",
          html: "终局就比这个数。它来自：<b>装船得分 + 建筑印的分 + 大建筑的特殊计分</b>。攒得最多者赢。" },
        { target: '.player-board[data-player="0"] .plantation-grid', title: "你的种植园",
          html: "👷 表示<b>已上人</b>(会产货)，空白表示没人(不产)。靠市长阶段补人来激活。" },
        { target: '.player-board[data-player="0"] .building-grid', title: "你的建筑",
          html: "你建的建筑放这里(开局还没有)。⚪ 是空岗，<b>需要市长补人才能激活</b>它的能力。" },
        { target: ".player-board.governor", title: "总督标记 👑",
          html: "金边那位是本回合<b>总督</b>、最先选角色。每轮结束总督顺延，轮流先手。" },
        { target: "#log", title: "事件日志",
          html: "每一步动作都记在这里，方便回看局势演变。" },
        { target: "#btn-show-rules", title: "完整规则在这 📜",
          html: "想看细则点右上角「规则」。<br>一句话记住循环：<b>拿地 → 建加工厂 → 补人产货 → 装船得分 / 卖货换钱 → 再建造</b>，循环到资源耗尽，胜利点最多者赢！点「完成」即可开始正式游戏。" },
      ],
    },

    // === 新建筑扩展 ===
    newbuildings: {
      expansion: "newbuildings", buccaneer: false, players: 4, title: "新建筑扩展",
      steps: [
        { target: null, title: "新建筑扩展 🏗️",
          html: "在基础游戏上加入 <b>14 张新建筑</b>。<b>角色和回合结构完全不变</b>——只是可买的建筑更丰富，策略组合更多。" },
        { target: "#buildings-pool", title: "更满的建筑市场",
          html: "对比基础游戏，市场明显变拥挤——多出十几张新建筑可买，每局的建筑环境都不一样。" },
        { target: "#buildings-pool .building-card.violet", title: "新紫色建筑",
          html: "大多是带新特权的紫色建筑，和原有 7 角色玩出新组合。下面看两张代表。" },
        { target: '#buildings-pool [data-bid="33"]', title: "例：图书馆",
          html: "<b>你每次选到角色时，那个角色的特权都翻倍</b>(工匠多产、建造再 -2、船长/商人特权×2…)。极强的引擎型新建筑。" },
        { target: '#buildings-pool [data-bid="37"]', title: "例：雕像",
          html: "大型建筑，直接给 <b>8 胜利点</b>且<b>不需要工人</b>。代表新增的「纯分数」选择。" },
        { target: '#buildings-pool [data-bid="25"]', title: "例：黑市",
          html: "建造缺钱时，可用<b>货物 / 殖民者 / 胜利点抵一部分建筑费</b>——让你提前抢下关键建筑。" },
        { target: "#players-area", title: "板块不变",
          html: "玩家板布局和基础游戏一样，新建筑的威力主要体现在<b>特权链和终局计分</b>上。熟悉这些新牌就能玩出新套路。" },
      ],
    },

    // === 贵族扩展 ===
    nobles: {
      expansion: "nobles", buccaneer: false, players: 4, title: "贵族扩展",
      steps: [
        { target: null, title: "贵族扩展 🎩",
          html: "在新建筑扩展之上，再加入一种高级人力——<b>贵族 🎩</b>，以及 8 张贵族相关建筑。贵族让「人力」这条线多了一层深度。" },
        { target: '.player-board[data-player="0"] [data-stat="nobles"]', title: "贵族计数 🎩",
          html: "玩家板的人力栏多了 <b>🎩 贵族</b>一格(基础游戏没有这格)。贵族和殖民者 👷 一样能上岗，但能触发建筑的「贵族版」效果。" },
        { target: ".role-card.role-Mayor", title: "贵族从哪来",
          html: "贵族混在<b>殖民者船</b>里，市长阶段一起分配；部分贵族建筑(如别墅)还能主动从供应区拿贵族。" },
        { target: '#buildings-pool [data-bid="44"]', title: "新建筑：珠宝匠",
          html: "贵族扩展唯一的<b>生产建筑</b>：工匠阶段按你拥有的<b>贵族数量给金</b> 💰。贵族越多越赚。" },
        { target: '#buildings-pool [data-bid="45"]', title: "新建筑：皇家花园",
          html: "大型建筑，<b>终局时你的每名贵族再 ×2 计分</b>。围绕贵族堆 VP 的核心建筑。" },
        { target: "#buildings-pool", title: "贵族建筑群",
          html: "市场里还多了地产办公室、礼拜堂、规划办、皇家供应商、别墅等贵族建筑——它们对<b>贵族驻守</b>有专属效果。" },
        { target: null, title: "小结",
          html: "贵族扩展 = 新建筑扩展 + <b>贵族这条平行人力线</b>。终局每名贵族自带 +1VP，配合皇家花园/珠宝匠能滚出可观分数。" },
      ],
    },

    // === Tibs 自制扩展（需 buccaneer=true 才有海盗卡） ===
    tibs: {
      expansion: "tibs", buccaneer: true, players: 4, title: "Tibs 扩展",
      steps: [
        { target: null, title: "Tibs 自制扩展 🏴‍☠️",
          html: "同人扩展，是<b>新建筑 + 贵族的超集</b>，再额外加入 <b>8 张同人建筑 + 节庆模块 + 海盗角色</b>。内容最丰富，偏实验性。" },
        { target: "#buildings-pool", title: "最丰富的建筑市场",
          html: "建筑总数达到最多(基础 + 新建筑 + 贵族 + 8 张 Tibs)。市场会非常满。" },
        { target: '#buildings-pool [data-bid="46"]', title: "例：金矿",
          html: "8 张 Tibs 建筑之一(id 46–53)。金矿占 2 工人，提供一条<b>慢速回赚金币</b>的路线。" },
        { target: '#buildings-pool [data-bid="53"]', title: "例：大教堂",
          html: "Tibs 大型建筑：<b>终局时每名对手拥有的大型建筑都给你 +2VP</b>——对手越往大建筑发展，你越赚。" },
        { target: "#log", title: "节庆模块 🎉",
          html: "开局会随机生成 <b>3 个竞速目标</b>(种植某货 3 块 / 一回合同产几种货 / 建造某建筑)，写在<b>事件日志</b>里。<b>谁先达成谁拿奖励</b>(殖民者 / 金 / VP)。" },
        { target: ".role-card.role-Buccaneer", title: "第 8 个角色：海盗",
          html: "Tibs 新增的<b>海盗角色</b>，有劫掠 / 洗劫等行动。<b>仅人类可选</b>(AI 不用，以免影响 AI 强度)。" },
        { target: "#roles", title: "角色行变成 8 张",
          html: "因此角色区从 7 张变成 <b>8 张</b>(7 标准 + 海盗)。其余回合结构与基础游戏一致。" },
        { target: null, title: "小结",
          html: "Tibs = 全部官方扩展 + 8 张同人建筑 + 节庆竞速 + 海盗角色。想要最热闹、变化最多的一局就选它。" },
      ],
    },
  };

  // ---------- 引擎 ----------
  let _tour = null, _step = 0, _inGame = false; // _inGame: 游戏内调出（覆盖实时牌面，不新建局/不切屏）
  const el = (id) => document.getElementById(id);

  function buildDom() {
    if (el("tutorial-overlay")) return;
    const ov = document.createElement("div"); ov.id = "tutorial-overlay";
    const spot = document.createElement("div"); spot.id = "tutorial-spot"; spot.className = "pulse";
    const bub = document.createElement("div"); bub.id = "tutorial-bubble";
    document.body.appendChild(ov);
    document.body.appendChild(spot);
    document.body.appendChild(bub);
    // 滚动/缩放时重定位（capture:true 以捕获内部滚动容器如 #log-panel 的滚动）
    window.addEventListener("resize", reposition, true);
    window.addEventListener("scroll", reposition, true);
    document.addEventListener("keydown", onKey, true);
  }

  function teardownDom() {
    window.removeEventListener("resize", reposition, true);
    window.removeEventListener("scroll", reposition, true);
    document.removeEventListener("keydown", onKey, true);
    ["tutorial-overlay", "tutorial-spot", "tutorial-bubble"].forEach((id) => {
      const e = el(id); if (e) e.remove();
    });
  }

  function onKey(e) {
    if (!_tour) return;
    if (e.key === "Escape") { e.preventDefault(); endTutorial(); }
    else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); nextStep(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); prevStep(); }
  }

  // 定位聚光灯框；返回目标的视口矩形(无目标/不可见时隐藏聚光灯并返回 null)
  // doScroll 仅在进入新步骤时为 true，避免滚动监听里再次 scrollIntoView 造成抖动
  function placeSpot(doScroll) {
    const s = _tour.steps[_step];
    const spot = el("tutorial-spot");
    const target = s.target ? document.querySelector(s.target) : null;
    if (!target) { spot.style.display = "none"; return null; }
    if (doScroll) { try { target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" }); } catch (_) {} }
    const r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { spot.style.display = "none"; return null; }
    spot.style.display = "block";
    spot.style.left = (r.left - 4) + "px";
    spot.style.top = (r.top - 4) + "px";
    spot.style.width = (r.width + 8) + "px";
    spot.style.height = (r.height + 8) + "px";
    return r;
  }

  function placeBubble(r) {
    const bub = el("tutorial-bubble");
    const bw = bub.offsetWidth, bh = bub.offsetHeight;
    const M = 14, vw = window.innerWidth, vh = window.innerHeight;
    let left, top;
    if (!r) { // 无目标 → 居中
      left = (vw - bw) / 2; top = (vh - bh) / 2;
    } else {
      const fitRight = r.right + M + bw <= vw;
      const fitLeft = r.left - M - bw >= 0;
      if (fitRight) { left = r.right + M; top = r.top; }
      else if (fitLeft) { left = r.left - M - bw; top = r.top; }
      else { // 左右都放不下(目标很宽) → 放上方或下方、水平居中于目标
        left = r.left + r.width / 2 - bw / 2;
        top = (r.bottom + M + bh <= vh) ? r.bottom + M : r.top - M - bh;
      }
      left = Math.min(Math.max(M, left), vw - bw - M);
      top = Math.min(Math.max(M, top), vh - bh - M);
    }
    bub.style.left = Math.round(left) + "px";
    bub.style.top = Math.round(top) + "px";
  }

  function reposition() {
    if (!_tour || !el("tutorial-spot")) return; // 覆盖层尚未建好（如新建局首次 render）时跳过
    placeBubble(placeSpot(false));
  }

  function renderBubble() {
    const s = _tour.steps[_step];
    const total = _tour.steps.length;
    const isLast = _step === total - 1;
    const bub = el("tutorial-bubble");
    bub.innerHTML =
      `<div class="tb-title">${s.title || ""}</div>` +
      `<div class="tb-body">${s.html || ""}</div>` +
      `<div class="tb-nav">` +
        `<span class="tb-progress">${_step + 1} / ${total}</span>` +
        `<button type="button" class="tb-skip">跳过</button>` +
        `<button type="button" class="tb-prev"${_step === 0 ? " disabled" : ""}>‹ 上一步</button>` +
        `<button type="button" class="tb-next">${isLast ? "完成 ✓" : "下一步 ›"}</button>` +
      `</div>`;
    bub.querySelector(".tb-skip").onclick = endTutorial;
    bub.querySelector(".tb-prev").onclick = prevStep;
    bub.querySelector(".tb-next").onclick = nextStep;
  }

  function showStep(i) {
    _step = Math.max(0, Math.min(i, _tour.steps.length - 1));
    if (typeof hideHoverTooltip === "function") hideHoverTooltip();
    renderBubble();                 // 先渲染气泡，拿到真实尺寸
    placeBubble(placeSpot(true));   // 进入新步骤：滚动到目标并定位
  }

  function nextStep() { if (_step < _tour.steps.length - 1) showStep(_step + 1); else endTutorial(); }
  function prevStep() { if (_step > 0) showStep(_step - 1); }

  function endTutorial() {
    const wasInGame = _inGame;
    _tour = null; _inGame = false;
    teardownDom();
    if (typeof hideHoverTooltip === "function") hideHoverTooltip();
    if (wasInGame) return; // 游戏内：仅移除覆盖层，回到实时对局，不切屏
    // 从设置页进入：平滑返回设置页（下次 new Game 会重建全局 BUILDINGS）
    el("game-screen").classList.add("hidden");
    el("setup-screen").classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  // inGame=true: 覆盖在【当前实时对局】的牌面上（不新建局、不切屏），结束后回到对局
  function startTutorial(tourKey, inGame) {
    const t = TOURS[tourKey];
    if (!t || typeof Game !== "function" || typeof render !== "function") return;
    _tour = t; _step = 0; _inGame = !!inGame;
    if (!_inGame) {
      window._allAIMode = false; window._fastSpectator = false;
      G = new Game(t.players, "玩家", t.expansion, t.buccaneer); // 静态牌面
      el("setup-screen").classList.add("hidden");
      el("game-screen").classList.remove("hidden");
      render();                     // 一次性渲染，不调 runMainLoop()
    }
    buildDom();
    showStep(0);
  }

  // 当前对局对应哪个教程（游戏内调出时用）
  function currentTourKey() {
    if (typeof G === "undefined" || !G) return "base";
    if (G.expansionTibs) return "tibs";
    if (G.expansionNobles) return "nobles";
    if (G.expansion) return "newbuildings";
    return "base";
  }

  // ---------- 让聚光灯在【实时对局重渲染】后自动复位 ----------
  // 游戏内调出教程时，AI 行动会触发 render() 重建 DOM；包一层在 render 后复位 spot。
  // 非教程态零开销（只一个空判断）。render 是 game.js 顶层函数声明 = 全局属性，可安全替换。
  if (typeof window.render === "function" && !window.render._tutWrapped) {
    const _origRender = window.render;
    const wrapped = function () {
      const r = _origRender.apply(this, arguments);
      if (_tour && el("tutorial-spot")) reposition();
      return r;
    };
    wrapped._tutWrapped = true;
    window.render = wrapped;
  }

  // ---------- 绑定入口按钮 ----------
  function bindEntry() {
    // 设置页：四个教程按钮（新建静态局）
    document.querySelectorAll(".tut-btn").forEach((b) => {
      b.onclick = () => startTutorial(b.dataset.tour, false);
    });
    // 游戏内：topbar「教程」按钮，覆盖在当前实时牌面上，按当前扩展选教程
    const ig = el("btn-tutorial-ingame");
    if (ig) ig.onclick = () => { if (typeof G !== "undefined" && G) startTutorial(currentTourKey(), true); };
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindEntry);
  else bindEntry();

  window.startTutorial = startTutorial; // 便于控制台调试
})();
