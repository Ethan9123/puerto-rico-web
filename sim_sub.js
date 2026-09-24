// ============================================================
// sim_sub.js — L6 子决策（建造/选田/卖货/工匠奖励/装船）的采样 rollout 搜索核心（第三轮 Stage 5a）
// ============================================================
// 为什么要有它：L6 的角色选择有 ISMCTS，但角色**之内**的子决策一直和所有人用同一套固定启发式。
// 本模块只在「有把握更好」时替换 L6 **自己**这一手的启发式选择；其余一切（后续对手的子决策、
// 后续角色）仍由启发式模拟。纯增量：只依赖 sim.js 公共 API（clone / azDecision / azApply /
// azHeuristicAction / applyRole / heuristicPickRole / legalRoleIdxs / currentChooser / isTerminal / reward），
// 不改 sim.js 任何默认路径（字节门 G1/G2/G3 靠这一点）。
//
// 一个值 v(c, r) 的定义（value / subEvalBatch 都走同一个函数 evalOne）：
//   规范化（每次搜索一次，非每个 perm）：base = clone(st0)；opts.fid 且基础局 → base._fid = true（标志本身由
//     Stage 4 实现，这里只负责置位）——必须在 azDecision **之前**置位：Stage 4 把庄园(8) 的抽牌放在 azDecision
//     的拓殖跳转里（决策**前**抽，az.hac 游标幂等），后置位会让 azApply 以 fid 口径跳过旧的「选后抽」→ 整张丢失；
//     规范化若动了牌堆或随机流（= 到达决策点要先抽隐藏牌，如 az.hac≠az.oi 的庄园主）→ 抛错，见 normalize；
//   st = clone(base)；
//   rnd_r = mulberry32(mix(decisionSeed(st0, dec), r))；
//   用 rnd_r 对 st.plantationDeck 的**真实剩余内容**做 Fisher-Yates —— 这就是确定化：
//     旧的前瞻/求解读的是真实隐藏牌堆顺序（§18.1 #3 的信息泄漏），这里按样本重洗，顺序不再可见；
//   st.rnd = rnd_r（同一条流继续给之后的弃牌堆重洗用）；
//   先在 st 上调用一次 azHeuristicAction(st, dec) 并丢弃结果（见 evalOne 里的注释：让建造阶段的 _bphase
//     缓存与「启发式自己从这里走」完全同状态，v(c) 才是「本手换成 c、其余照启发式」的回报）；
//   azApply(st, c)；之后所有子决策用 azHeuristicAction 走到下一个**角色**决策（角色边界）或终局；
//   再用角色搜索同款的确定性 ε=0 rollout：while(!isTerminal) applyRole(heuristicPickRole)；
//   v = PRSim.reward(st, dec.chooser)。
// 于是 v 只依赖 (st0, c, r)：
//   - 同一 r 下所有候选看到**同一副**牌堆顺序与同一条随机流 → 公共随机数（CRN），差值方差小；
//   - 与 perm 怎么切给多个 worker 无关（每个 perm 自带种子，不共享流）→ 5c 可把 r 区间分给 K 个 worker，
//     主线程按 r 顺序求和，结果与单线程逐位一致。
//
// decisionSeed 只用**公开**信息：牌堆只取排序后的多重集（剩余内容可由公开信息推出，顺序不可），
// 不含 rnd；其余字段一律纳入（规范化 JSON：键排序、跳过 undefined/函数），所以别的 track 往状态里
// 加字段（如 _fid）也会自动进种子，不需要维护白名单。
//
// subSearch 的决策规则（§18.2 预注册，固定）：
//   候选 = 启发式动作 h 在前，其余按 dec.actions 原顺序；
//   连续减半（successive halving），选择预算 B_sel=160：每轮所有幸存者用**同一批** perm（CRN），
//     按累计均值（幸存者 perm 集完全相同，比较累计和即可）保留前一半，平手取启发式序在前者；
//   胜者 c* == h → 直接返回 h，不跑门；
//   否则留出门：48 个与选择阶段不相交的新 perm（r = 1e6 + k），d_k = v(c*, r) − v(h, r)，
//     mean(d) ≥ δ(0.02) 且 (SE = 0 或 mean/SE ≥ z(2.0)) 才切换，否则 h。
//   「≥」与「平手」都按精确算术判（值在 1/150 格点上，浮点带 1e-9 容差，§18.2 补充 D，见 CMP_EPS）。
//   选择阶段用过的 perm 不进门：选择本身会把噪声挑成「优势」（赢家诅咒），门必须用新样本。
//
// 5c 集成接口：subSearchSteps 是生成器，逐批 yield {actions, rs}，调用方回填 values[a][k]
//   （同步用 subEvalBatch，浏览器用 worker 池分摊 rs 后按 r 顺序拼回）。subSearch 是同步驱动。
(function (root) {
  "use strict";
  const PRSim = root.PRSim;
  if (!PRSim || typeof PRSim.azDecision !== "function" || typeof PRSim.azHeuristicAction !== "function")
    throw new Error("sim_sub.js: load sim.js (factored az layer) first");

  const GATE_R0 = 1000000;          // 门的 perm 区间起点：与选择阶段 r=0,1,2,… 不相交（选择阶段远小于 1e6）
  const ROLLOUT_GUARD = 400;        // 与 sim.js rolloutToEnd 的 guard 同值
  const CONT_GUARD = 5000;          // 到角色边界的子决策步数上限（与 azPlayHeuristic 同值；正常 < 50）
  const DEFAULTS = { bSel: 160, gateN: 48, delta: 0.02, z: 2.0, maxRollouts: 2000 };
  // 决策规则里的比较按**精确算术**的含义执行（§18.2 补充 D）：PRSim.reward = 0.8·胜率份额 + 0.2·clamp(分差/30)，
  //   0.8/k（k=1..5 家并列）与 1 VP 分差 0.2/30 都是 1/150 的整数倍 → 每个 v、每个 d 都落在 1/150 的格点上，
  //   48 个 d 的均值落在 1/7200 ≈ 1.4e-4 的格点上。但浮点里 0.2·(m+3)/30 − 0.2·m/30 按基线 m 不同会落在 0.02 的两侧
  //   （58 个基线里 26 个 < 0.02），48 个混合 d 精确均值恰为 δ 时，浮点均值约 4 成落在 δ 之下（审查 5c-1 发现，
  //   随机构造 20 万例实测 38%）——「≥ δ」会被舍入方向随机地判成「<」。选择阶段的「平手归启发式」同理：两个候选
  //   精确累计和相等时，浮点和的大小由求和路径决定，不是规则。
  //   所以两处都带容差 CMP_EPS：门 = mean ≥ δ − EPS；排名 = |Δ和| ≤ EPS 视为平手（取启发式序在前）。
  //   EPS = 1e-9：远大于累积舍入（≤ ~2000 个 |v|≤1 的和，误差 ~1e-13），远小于格点间距（和 1/150、门均值 1/7200），
  //   所以它只把「精确相等」判回相等，不会让任何精确小于 δ 的均值过门（不放松门槛），比较器在格点上仍可传递。
  const CMP_EPS = 1e-9;

  // ---------- 随机数 / 哈希 ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // 与 tools/eval_paired_worker.js 的 fnv1a 同式（按 UTF-16 码元；这里的串全是 ASCII）
  function fnv1a(str, h) {
    h = (h == null ? 0x811c9dc5 : h) >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  // (decisionSeed, r) → 32 位 perm 种子：以种子为 FNV 偏移基，吃 r 的 4 个小端字节，再过 murmur3 fmix32。
  // fmix 是为了让相邻 r（0,1,2,…）得到雪崩充分的种子——mulberry32 对相邻种子本身还算均匀，这里再保险一层。
  function permSeed(seed, r) {
    let h = seed >>> 0; r = r >>> 0;
    for (let b = 0; b < 4; b++) { h ^= (r >>> (8 * b)) & 0xff; h = Math.imul(h, 0x01000193); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }
  function permRng(seed, r) { return mulberry32(permSeed(seed, r)); }

  // ---------- 规范化序列化（只含公开信息）----------
  // 键排序：game.js buildSimState 与 sim.js clone 构造对象的键顺序不同，但同一局面必须同一种子。
  // 跳过 undefined：clone 会显式写出 noble:undefined / smallWharfUsed:undefined 等，与「缺键」等价。
  // 跳过函数（rnd）。数组保序（公开信息里的顺序本身就是公开的：明牌池、弃牌堆、角色卡……）。
  function canon(x) {
    if (x === null) return "n";
    const t = typeof x;
    if (t === "number") return (x === 0 ? "0" : String(x));   // -0 与 0 同串
    if (t === "string") return JSON.stringify(x);
    if (t === "boolean") return x ? "T" : "F";
    if (Array.isArray(x)) { let s = "["; for (let i = 0; i < x.length; i++) { const v = x[i]; s += (v === undefined || typeof v === "function") ? "u" : canon(v); s += ","; } return s + "]"; }
    if (t === "object") {
      const ks = Object.keys(x).sort(); let s = "{";
      for (const k of ks) { const v = x[k]; if (v === undefined || typeof v === "function") continue; s += JSON.stringify(k) + ":" + canon(v) + ","; }
      return s + "}";
    }
    return "?";
  }
  function publicView(st) {
    const o = {};
    for (const k of Object.keys(st)) {
      if (k === "rnd") continue;                                   // 随机流不是局面信息
      if (k === "plantationDeck") { o.plantationDeckMultiset = st.plantationDeck.slice().sort(); continue; } // 只留多重集：顺序是隐藏信息
      o[k] = st[k];
    }
    return o;
  }
  function decisionSeed(st, dec) {
    const d = dec ? { type: dec.type, chooser: dec.chooser, actions: dec.actions } : null;
    return fnv1a(canon({ st: publicView(st), dec: d }));
  }

  function isBaseGame(st) { return !st.expansion && !st.expansionNobles && !st.expansionTibs; }

  // sim.js（Stage 4 之前）的 clone 不带 _fid；这里统一补上，保证 base → 每个 perm 的状态标志一致
  // （Stage 4 的 clone 自己会带，届时这一行是空操作）。
  function cloneF(st) { const c = PRSim.clone(st); if (st._fid) c._fid = true; return c; }

  // 把状态推进到它的当前决策点（azDecision 会跳过无选项的玩家，甚至收尾一个角色），且不消耗 st0.rnd：
  // 基底 clone 换一条哑流。返回 {base, dec}；dec 为 null/角色决策时由调用方处理。
  // fid 在 azDecision 之前置位（Stage 4 的庄园抽牌发生在 azDecision 里，见文件头）。
  // 隐藏信息守卫：规范化是在**真实**牌堆上做的（尚未确定化），若推进到子决策点途中抽了牌（牌堆变了）
  // 或用了随机流，则被抽到的牌来自隐藏顺序 → 进 base、进种子、进每个 rollout = 泄漏；而且真实对局里
  // 这张牌在玩家决策前就已翻开（game.js doSettler 先抽庄园再问），「抽之前」的局面根本不是该玩家的
  // 信息集，逐 perm 抽也不对（h 会随抽到的牌变）。所以直接拒绝：调用方应传抽过之后的局面
  // （game.js simStateAtSubDecision 'settle' 重建时置 az.hac = oi）。5c 须 try/catch 回退到启发式。
  function normalize(st0, fid) {
    const base = cloneF(st0);
    if (fid && isBaseGame(base)) base._fid = true;
    let rndCalls = 0; const dr = mulberry32(0x5eed);
    base.rnd = () => { rndCalls++; return dr(); };   // 只在规范化时越过角色边界才会被用到（那时不是子决策，调用方会退出）
    const dec = PRSim.azDecision(base);
    if (dec && dec.type !== "role") {
      const d0 = st0.plantationDeck, d1 = base.plantationDeck;
      let moved = rndCalls > 0 || d0.length !== d1.length;
      for (let i = 0; !moved && i < d0.length; i++) if (d0[i] !== d1[i]) moved = true;
      if (moved) throw new Error("sim_sub: reaching the decision from st0 draws hidden tiles/randomness (pass the post-draw state, e.g. az.hac = az.oi)");
    }
    return { base, dec };
  }
  function sameDec(a, b) {
    if (!a || !b || a.type !== b.type || a.chooser !== b.chooser || a.actions.length !== b.actions.length) return false;
    for (let i = 0; i < a.actions.length; i++) if (a.actions[i] !== b.actions[i]) return false;
    return true;
  }

  // ---------- 单个值 v(c, r) ----------
  // base 已规范化到 dec；seed = decisionSeed(base, dec)。trace（仅测试用）在确定化完成后被调用。
  // leaf（opts.leafValue，Stage 5b census 用）：终局叶值函数 (st, seat) → 数；缺省 = PRSim.reward（搜索本身的口径）。
  //   census 要测「实现的胜率份额」：同一条管线（同一确定化、同一续局、同一 rollout），只把最后一步
  //   reward（0.8×胜率份额 + 0.2×分差）换成纯胜率份额 W。只换叶、不换管线 → 值仍只依赖 (st0, c, r)，
  //   CRN / 切分不变性照旧成立。缺省路径不多做任何事（同一个 reward 调用）→ 搜索输出逐位不变。
  function evalOne(base, dec, seed, action, r, trace, leaf) {
    const st = cloneF(base);   // _fid（若有）已在 normalize 置于 base
    const rnd = permRng(seed, r);
    // 先排序再洗：Fisher-Yates 的输出是「输入顺序 ∘ 随机置换」，直接洗真实顺序的牌堆，
    // 同一 rnd 对两个只差顺序的牌堆会给出不同的结果——隐藏顺序照样漏进值里（测试 ④ 抓到过）。
    // 排序后输入只剩多重集，输出才是该多重集上的均匀随机顺序且与真实顺序无关。
    const deck = st.plantationDeck.sort();
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp; }
    st.rnd = rnd;
    if (trace) trace({ action, r, deck: deck.join(","), fid: !!st._fid });
    // 先让启发式在这一手上「想一遍」再丢弃结果：azHeuristicAction 会顺带维护 st.az._bphase
    // （doBuilder 语义：建造阶段内 phase 在**第一位**建造者出手前定死；离开 build 清空）。
    // 不做这一步，第一位建造者选 c 时 phase 会在「apply 之后」才由下一位建造者定——c 若改动 phaseOf 的输入
    // （如有人的大学(16) 让建房带走供应池殖民者，colonistsLeft 跨过 0.33/0.66 阈值），后续建造者按错的
    // phase 选房，v(c) 就不是「本手换成 c、其余照启发式」了（测试 ⑩b 构造了这种局面并钉住）。
    // 注：Stage 4 的庄园前置抽牌不在这里——它在 azDecision 里，已由 normalize 在 base 上完成；fid 下
    // azHeuristicAction 的建造分支每次现算 phaseOf、不读 _bphase，这一步对 fid 的建造无影响。
    // 该调用不读牌堆顺序也不消耗 rnd（sim.js 子决策启发式无随机），所以放在确定化之后也无泄漏。
    PRSim.azHeuristicAction(st, dec);
    PRSim.azApply(st, action);
    // 续局到角色边界：所有人（含 L6 自己之后的同阶段子决策）按启发式
    let guard = 0;
    while (guard++ < CONT_GUARD) {
      const d = PRSim.azDecision(st);
      if (!d || d.type === "role") break;
      PRSim.azApply(st, PRSim.azHeuristicAction(st, d));
    }
    // 角色搜索同款的确定性 ε=0 rollout（与 sim.js evalLeaf 的截断推进同式，只是不截断）
    guard = 0;
    while (!PRSim.isTerminal(st) && guard++ < ROLLOUT_GUARD) {
      const ch = PRSim.currentChooser(st); if (ch < 0) break;
      const legal = PRSim.legalRoleIdxs(st); if (!legal.length) break;
      PRSim.applyRole(st, PRSim.heuristicPickRole(st, ch, legal));
    }
    return leaf ? leaf(st, dec.chooser) : PRSim.reward(st, dec.chooser);
  }

  // 批量求值：values[a][k] = v(actions[a], rList[k])。
  // st0 可以是尚未推进到决策点的状态（会先规范化）；dec 必须与规范化后的 azDecision 一致，否则抛错
  // （防止调用方拿错 dec，把动作 apply 到别人的回合上）。
  // opts: { fid, deadline(ms 时间戳), maxRollouts, counter:{n}, _trace, leafValue }——deadline/maxRollouts/counter 供同步驱动做中途截止；
  //   leafValue(st, seat)：叶值函数，缺省 reward（见 evalOne）。
  function subEvalBatch(st0, dec, actions, rList, opts) {
    opts = opts || {};
    const nz = normalize(st0, !!opts.fid);
    if (!sameDec(nz.dec, dec)) throw new Error("sim_sub: dec does not match azDecision(st0)");
    const seed = decisionSeed(nz.base, nz.dec);
    return evalBatchNorm(nz.base, nz.dec, seed, actions, rList, opts);
  }
  const now = (typeof performance !== "undefined" && performance && typeof performance.now === "function") ? () => performance.now() : () => Date.now();
  function evalBatchNorm(base, dec, seed, actions, rList, opts) {
    const out = [];
    for (let a = 0; a < actions.length; a++) out.push(new Array(rList.length));
    const ctr = opts.counter;
    // r 外层、候选内层：截止时各候选完成的 perm 数一致（只影响中途放弃，不影响值）
    for (let k = 0; k < rList.length; k++) {
      for (let a = 0; a < actions.length; a++) {
        if (ctr) {
          if (opts.deadline != null && now() >= opts.deadline) return { abort: "time" };
          if (opts.maxRollouts != null && ctr.n >= opts.maxRollouts) return { abort: "cap" };
        }
        out[a][k] = evalOne(base, dec, seed, actions[a], rList[k], opts._trace, opts.leafValue);
        if (ctr) ctr.n++;
      }
    }
    return out;
  }
  function value(st0, dec, action, r, opts) { return subEvalBatch(st0, dec, [action], [r], opts)[0][0]; }

  function range(a, b) { const o = []; for (let i = a; i < b; i++) o.push(i); return o; }

  // ---------- 决策规则（生成器：yield {actions, rs} → 接收 values[a][k]，或 null 表示放弃）----------
  // ctx = { dec, h }。返回 {best, h, switched, gate, cands, selPerms}。
  function* ruleSteps(ctx, opts) {
    const dec = ctx.dec, h = ctx.h;
    const B = opts.bSel != null ? opts.bSel : DEFAULTS.bSel;
    const gateN = opts.gateN != null ? opts.gateN : DEFAULTS.gateN;
    const delta = opts.delta != null ? opts.delta : DEFAULTS.delta;
    const z = opts.z != null ? opts.z : DEFAULTS.z;
    // 启发式优先的候选序
    const cands = [h]; for (const a of dec.actions) if (a !== h) cands.push(a);
    const n = cands.length;
    const L = Math.ceil(Math.log2(n));
    const sums = new Float64Array(n);
    let S = range(0, n), rNext = 0, used = 0;
    while (S.length > 1) {
      // 每轮预算 B/L 平分给幸存者（至少 1 个 perm）；幸存者的 perm 集完全相同 → 比较累计和 ≡ 比较均值
      const m = Math.max(1, Math.floor(B / (L * S.length)));
      const rs = range(rNext, rNext + m);
      const vals = yield { actions: S.map(i => cands[i]), rs };
      if (!vals) return null;
      for (let s = 0; s < S.length; s++) { let acc = sums[S[s]]; const row = vals[s]; for (let k = 0; k < m; k++) acc += row[k]; sums[S[s]] = acc; }
      rNext += m; used += m;
      // 稳定：和相等（精确算术意义下，见 CMP_EPS）→ 启发式序在前（下标小）者
      S = S.slice().sort((x, y) => { const dd = sums[y] - sums[x]; return (dd > CMP_EPS || dd < -CMP_EPS) ? dd : (x - y); }).slice(0, Math.ceil(S.length / 2));
    }
    const best = cands[S[0]];
    if (best === h) return { best, h, switched: false, gate: { mean: null, se: null, n: 0 }, cands, selPerms: used };
    // 留出门：新 perm，配对差
    let gate = { mean: null, se: null, n: 0 }, switched = false;
    if (gateN >= 2) {
      const vals = yield { actions: [best, h], rs: range(GATE_R0, GATE_R0 + gateN) };
      if (!vals) return null;
      let sd = 0; const d = new Array(gateN);
      for (let k = 0; k < gateN; k++) { d[k] = vals[0][k] - vals[1][k]; sd += d[k]; }
      const mean = sd / gateN;
      let ss = 0; for (let k = 0; k < gateN; k++) ss += (d[k] - mean) * (d[k] - mean);
      const se = Math.sqrt(ss / (gateN - 1) / gateN);
      gate = { mean, se, n: gateN };
      // mean ≥ δ 按精确算术（CMP_EPS，见 DEFAULTS 处）；δ=∞ 时 ∞−EPS=∞，仍永不切换
      switched = mean >= delta - CMP_EPS && (se === 0 || mean / se >= z);
    }
    return { best, h, switched, gate, cands, selPerms: used };
  }

  // 公开的步进接口（5c）：返回 {dec, h, base, seed, steps}；不是子决策（角色决策/终局）→ null。
  //   单候选时 steps 第一次 next() 就 done（0 批）。
  //   steps 是生成器；每步 value = steps.next(vals).value 为 {actions, rs}，done 时为结果。
  function prepare(st0, opts) {
    opts = opts || {};
    const nz = normalize(st0, !!opts.fid);
    const dec = nz.dec;
    if (!dec || dec.type === "role") return null;
    let h;
    if (opts.h != null && dec.actions.indexOf(opts.h) >= 0) h = opts.h;   // 5c：game.js 的启发式选择（已映射到 az 动作）
    else h = PRSim.azHeuristicAction(cloneF(nz.base), dec);   // base 已带 fid 且已过庄园前置抽牌
    return { base: nz.base, dec, h, seed: decisionSeed(nz.base, dec) };
  }
  function subSearchSteps(st0, opts) {
    opts = opts || {};
    const p = prepare(st0, opts);
    if (!p) return null;
    p.steps = ruleSteps({ dec: p.dec, h: p.h }, opts);
    return p;
  }

  // 同步驱动。opts: bSel, gateN, delta, z, fid, maxMs, maxRollouts, h, evalBatch(actions, rs) [测试/5c 注入],
  //   leafValue（缺省 reward；预注册的决策规则用缺省——census 只在「测收益」时换叶，见 tools/sub_census.js）
  function subSearch(st0, opts) {
    opts = opts || {};
    const t0 = now();
    const p = prepare(st0, opts);
    if (!p) return null;
    const { base, dec, h, seed } = p;
    const res = { action: h, switched: false, h, best: h, nRollouts: 0, gate: { mean: null, se: null, n: 0 },
      timedOut: false, capped: false, kind: dec.type, chooser: dec.chooser, nCand: dec.actions.length };
    if (dec.actions.indexOf(h) < 0) { res.error = "h-not-in-actions"; return res; }   // 不应发生；发生则不搜
    if (dec.actions.length <= 1) return res;
    const ctr = { n: 0 };
    const evOpts = { counter: ctr, _trace: opts._trace, leafValue: opts.leafValue,
      deadline: opts.maxMs != null ? t0 + opts.maxMs : null,
      maxRollouts: opts.maxRollouts != null ? opts.maxRollouts : DEFAULTS.maxRollouts };
    const steps = ruleSteps({ dec, h }, opts);
    let it = steps.next();
    while (!it.done) {
      const req = it.value;
      let vals;
      if (opts.evalBatch) {
        // 注入的求值器（假池 / 测试）：同样计数、同样检查截止
        if (evOpts.deadline != null && now() >= evOpts.deadline) vals = { abort: "time" };
        else if (ctr.n + req.actions.length * req.rs.length > evOpts.maxRollouts) vals = { abort: "cap" };
        else { vals = opts.evalBatch(req.actions, req.rs); ctr.n += req.actions.length * req.rs.length; }
      } else vals = evalBatchNorm(base, dec, seed, req.actions, req.rs, evOpts);
      if (vals.abort) {
        res.nRollouts = ctr.n;
        if (vals.abort === "time") res.timedOut = true; else res.capped = true;
        steps.return();
        return res;   // action 仍为 h
      }
      it = steps.next(vals);
    }
    const out = it.value;
    res.best = out.best; res.gate = out.gate; res.switched = out.switched;
    res.action = out.switched ? out.best : h;
    res.nRollouts = ctr.n; res.selPerms = out.selPerms;
    res.ms = now() - t0;
    return res;
  }

  const PRSub = {
    decisionSeed, value, subEvalBatch, subSearch, subSearchSteps, DEFAULTS, GATE_R0, CMP_EPS,
    _internal: { mulberry32, fnv1a, permSeed, permRng, canon, publicView, normalize, isBaseGame, cloneF },
  };
  root.PRSub = PRSub;
  if (typeof module !== "undefined" && module && module.exports && typeof require === "function") module.exports = PRSub;
})(typeof globalThis !== "undefined" ? globalThis : this);
