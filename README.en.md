# Puerto Rico — Web Edition

> A single-player, in-browser implementation of the classic strategy game. AI evolved 700+ generations from [Tony Mitton's Puerto Rico Evolver Excel (BGG #8766)](https://boardgamegeek.com/filepage/8766/pr-030205zip), running the original Rio Grande 2002 ruleset.

🌐 **Language**：[中文](README.md) · **English** · [Français](README.fr.md) · [Español](README.es.md)

---

## 🌐 Play

### Play online
**👉 [https://ethan9123.github.io/puerto-rico-web/](https://ethan9123.github.io/puerto-rico-web/) 👈** (GitHub Pages)

### Play offline (no install, no server)
1. Grab the offline zip `puerto-rico-web-{date}.zip` (~6.8 MB).
2. Unzip it anywhere.
3. **Double-click `index.html`** — it opens in your browser and plays immediately.

Fully offline and permanent: no network, no local server, no installation. Every AI (including the evolved DNA and the Grandmaster neural network), every building and every rule is embedded locally. The package contains only plain web files (no `.exe` / `.bat` / installer / macros), so if antivirus software flags a false positive you can safely restore and whitelist it.

> 🇨🇳 Mainland-China access notes (GFW, WeChat distribution, ICP filing) are kept in the Chinese README and **[CN-ACCESS.md](CN-ACCESS.md)**.

---

## ✨ Features

### 🎮 Complete game
- **3 / 4 / 5 players**, with starting doubloons, colonist supply, VP pool, ship capacities and role-card counts auto-adjusted to the official rules.
- **All 23 buildings** + 5 goods + 7 roles (Settler / Mayor / Builder / Craftsman / Trader / Captain / Prospector).
- **Faithful rules**: starting plantations dealt in governor order, random first governor, the 12-space / VP-pool / colonist-pool final-round triggers, Captain forced shipping, Craftsman privilege limited to a good produced this round, Mayor chooser's +1 privilege, and more.
- **Building art from [BGG 42234 — Anniversary Edition Illustrated Buildings (Greg May)](https://boardgamegeek.com/filepage/42234/base-game-and-expansion-buildings-illustrated)**.

### 🤖 6 AI difficulty levels (each CPU set independently)

| Level | Name | What it does |
|---|---|---|
| **L1** | Beginner | Simple, intuitive play to its own strengths: short on colonists → Mayor, goods-heavy → Captain, enough cash → Builder. |
| **L2** | DNA | Pure DNA AI evolved 700+ generations in Tony Mitton's VBA evolver (5 seat pools × 10 each = 50 DNA strings). |
| **L3** | Normal | + role-card bonus awareness + blocking the downstream neighbour's goods. |
| **L4** | Hard | + **full-board blocking counters** (denying Captain / Builder / Trader / Craftsman / Mayor) + soft-scoring strategic tendencies + depth-2 snapshot lookahead. |
| **L5** | Expert | **ISMCTS** (Information-Set Monte-Carlo Tree Search): hidden-deck determinization + UCB1 + heuristic rollouts, thinking progressively deeper. |
| **L6** | Grandmaster | **AlphaZero**: a self-play-trained neural network guiding the MCTS (NN policy/value + PUCT). The strongest. |

### 🧠 Adjustable AI think time

Pick "AI think time" on the setup screen (this is the search budget for Expert L5 / Grandmaster L6):
- 🚀 **Fast** (0.1s) — for watching AI-vs-AI
- ⚖️ **Normal** (1.5s)
- 🧠 **Deep** (6s · default) — 2-round lookahead
- 💎 **Extreme** (10s) — strongly recommended for playing against the AI

Hard / Expert / Grandmaster AIs **analyse the human's threats in real time** (goods count, affordable large-violet buildings, best sale price, production capacity, open worker slots) and pre-emptively grab roles to counter them.

### 🎨 UX details

- **Building / role hover tooltips**: every building shows cost, VP, worker slots, quarry-discount cap and full effect; roles show action / privilege / timing hints.
- **Instant Mayor preview** on the card ("you +3: ship 2 + privilege 1"), no hover needed.
- **Instant Captain / Trader status** ("ship 1 full / 2 empty", "trading house 3/4").
- **AI action toasts** (top-right): what each CPU chose, how much it shipped, sold, produced — at a glance.
- **Your passive-income hints** in green: Mayor phase "+N colonists", Craftsman phase "+X corn +Y indigo", Captain phase "+X VP shipped this round".
- **Final-round ⚠ warning**: when colonists / VP / the 12-space limit triggers, the header shows "· ⚠ final round" plus a toast.
- **FLIP fly animations** when taking plantations / buildings.
- **BGA-style UI**: the building market is laid out in 4 rows (graded by quarry discount of 1/2/3/4 doubloons).

---

## 📋 Rules in brief

Each round, starting with the governor and going clockwise, every player picks **one** role. That role's action is taken by **all** players (clockwise), but the **chooser gets an extra privilege**. Each role card not chosen gains +1 doubloon per round.

| Role | Action | Privilege |
|---|---|---|
| 🌾 Settler | Take 1 plantation | May take a quarry instead |
| 👷 Mayor | Deal colonists from the ship one-by-one clockwise until empty | +1 colonist from the supply |
| 🏗 Builder | Build 1 building | −1 doubloon discount |
| 🏭 Craftsman | Everyone produces by capacity | +1 of a good produced this round |
| 💰 Trader | Sell 1 good to the trading house | +1 doubloon |
| 🚢 Captain | Load ships in order (mandatory), 1 good = 1 VP | +1 VP (once, this phase) |
| ⛏ Prospector | None | +1 doubloon (chooser only) |

**Game end** (any one trigger → the round finishes, then the game ends):
- Not enough colonists left to refill the ship.
- A player fills all 12 city spaces (large-violet buildings take 2 spaces).
- The VP pool is exhausted.

**Scoring**: VP chips + building VP + large-violet special VP (must be staffed); ties broken by doubloons + goods.

Full rules: [Universal Head summary](https://www.universalhead.com/games/getting-rules) or [BoardGameGeek](https://boardgamegeek.com/boardgame/3076/puerto-rico).

---

## 💻 Run locally (optional)

### Option 1: Double-click `index.html` (recommended)
The DNA strategy and the Grandmaster neural-network weights are embedded as `<script>` data — no network, no server, just double-click and play.

### Option 2: Local HTTP server (handy for hacking on the code)
```bash
cd puerto-rico-web
python -m http.server 8765
# or
npx http-server -p 8765 -c-1
```
Open [http://localhost:8765](http://localhost:8765).

---

## 📁 Project layout

```
puerto-rico-web/
├── index.html              ← entry point
├── game.js                 ← full game logic + 6 AI levels
├── styles.css              ← BGA-style UI
├── ai_dna.json             ← evolved DNA from the Excel (5 seat pools × 10 each)
├── ai_dna.js               ← DNA decoder (Evolution / L2)
├── sim.js                  ← headless rules engine + ISMCTS (Expert / L5)
├── sim_features.js         ← 446-dim feature extraction (Grandmaster / L6)
├── sim_nn.js               ← neural-network forward inference (Grandmaster / L6)
├── mcts_value_nn.json      ← AlphaZero weights (fetched online; embedded in the offline zip)
├── LICENSE                 ← MIT
├── NOTICE.md               ← intellectual-property notice
├── tests/                  ← conservation checks + end-to-end self-play + scenario assertions
├── tools/                  ← win-rate / ladder-calibration / training-eval scripts
└── assets/
    └── buildings/          ← 23 building illustrations (from BGG 42234)
```

---

## 🛠 Requirements

- **Any modern browser** (Chrome / Edge / Firefox / Safari).
- Double-clicking `index.html` runs fully offline — **no** Python / Node.js required (a local server is only needed for live-reload while editing code).
- Recommended resolution **1280×800+**.

---

## 🧪 Automated tests

- **Conservation / end-to-end self-play** (Node, headless): 3/4/5-player full games, with assertions that
  - the game ends correctly (colonists exhausted / VP exhausted / 12-space limit),
  - colonists are conserved (55 / 75 / 95 for 3/4/5 players),
  - goods are conserved (corn 10, indigo 11, sugar 11, tobacco 9, coffee 9),
  - every player's final VP > 0,
  - mixed-level tables (L1–L6) rank monotonically by average score: L6 > L5 > L4 > L3 > L2 > L1,
  - all 23 buildings get built at least once, and all 7 roles get chosen at least once.
- **Targeted unit tests**: random first governor, starting-plantation order, Captain default ship priority, Craftsman bonus restricted to goods produced this round, full-round end trigger, and more.

---

## 🚢 Captain default ship priority (implementation note)

When one good can load into several candidate ships, the default priority is:
1. **A ship already carrying that good** (keep stacking, avoid splitting).
2. **The empty ship with the most remaining capacity.**
3. Remaining candidates by **descending remaining capacity**.

The human's candidate list puts the best option first; the AI uses the same priority.

---

## 📜 Credits & sources

| Contribution | Source |
|---|---|
| **Original game design** | Andreas Seyfarth |
| **Publisher** | Rio Grande Games |
| **VBA evolver (AI DNA source)** | [Tony Mitton — BGG #8766](https://boardgamegeek.com/filepage/8766/pr-030205zip) |
| **Building illustrations** | [Greg May — Anniversary Edition Buildings, BGG #42234](https://boardgamegeek.com/filepage/42234/base-game-and-expansion-buildings-illustrated) |
| **Rules reference** | [Universal Head player aid PDF](https://www.universalhead.com/games/getting-rules), [BGG rules page](https://boardgamegeek.com/boardgame/3076/puerto-rico) |

---

## 📄 License & attribution

- The **code** is released under the **MIT License**, see [`LICENSE`](LICENSE).
- This is a **non-commercial fan re-implementation**. The **Puerto Rico** game IP (name, mechanics, rules expression, etc.) belongs to **Andreas Seyfarth / Rio Grande Games**.
- The building illustrations in `assets/buildings/` are copyright Rio Grande Games / the original artist; they are used for educational / personal-play demonstration only and are **not** covered by the MIT license.
- This project has **no official affiliation with or endorsement by** Andreas Seyfarth or Rio Grande Games.
- See [`NOTICE.md`](NOTICE.md) for details.
