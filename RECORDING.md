# 对局记录 → 训练 JSONL（真人对局采集）

把**真人在网站上和 AI 对战**的每一局（胜负都收），自动转成与现有训练管线**逐字段一致**的
JSONL，通过一个轻量 Cloudflare Worker 端点集中收集；你打开一个网址即可一次性取回全部对局
数据，直接喂给 `train/`，用于分析真人怎么走、以及做模仿学习 / 最佳回应（exploiter）训练。

## 数据格式（与训练管线对齐）

每行一个样本，对应真人的一个"选角色"决策点，结构与 `tools/selfplay_dump.js` 完全相同：

```json
{"f": [446 floats], "a": 0-6, "v": -1..1, "vv": [4 floats], "n": 3-5}
```

- `f` —— `PRSim.extractRich(快照, 真人座位)` 提取的 446 维特征（perspective-first）。
- `a` —— 真人所选角色的 policy 索引（`PRSim.roleNameToPolicyIdx`）。
- `v` / `vv` —— 终局相对优势，口径与 self-play 一致（`margin` 默认 / `rank` / `vsbest`）。
- `n` —— 玩家数。

`train/load_data.py` 直接读这个格式，无需任何转换：

```bash
python train/train.py data/human-wins.jsonl
```

## 客户端行为（`trace.js`）

- 每次"选角色"已由现有 `PRTrace.recordPick` 用 `buildSimState(G)` 存快照；终局 `PRTrace.finish` 记录分数与胜负。
- **真人对局结束时**：自动把该局转成上面的 JSONL，并 `POST /collect`（用 `navigator.sendBeacon`，即使随后刷新/跳转也能送达）。
- **胜负局都上传**（`uploadOnlyWins:false`；`v` 按真实终局结果标注，败局即为负值），且只含训练用的局面/动作/结果——**不含昵称、IP、设备信息**。只想收胜局可设 `PRTrace.config.uploadOnlyWins=true`。
- 可配置 / 退出：
  - 端用户退出：URL 加 `?collect=0`（会被浏览器记住）。
  - 控制台：`PRTrace.config.upload = false`。
  - 改 value 口径：`?valuemode=rank`（或 `PRTrace.config.valueMode`）。
- 纯客户端导出（不依赖后端）：
  - 右下角"🎯 训练 JSONL"按钮，或控制台 `PRTrace.exportJSONL()`，或网址 `?export=jsonl`。
  - 默认导出本浏览器里的真人对局（胜负都含）。

## 后端设置（Cloudflare Worker + KV）

**现状：已启用** —— `wrangler.toml` 已绑定 KV 命名空间 `PR_TRACES`，部署后 `/collect` 入库、
`/dump` 取回、`/stats` 统计均生效。**仍需设置取回口令** `DUMP_TOKEN`（否则 `/dump`、`/stats` 无保护、
任何人可拉走数据）：控制台 Workers → Settings → Variables and Secrets 加 Secret `DUMP_TOKEN`，
或 `wrangler secret put DUMP_TOKEN`。

（参考）当初启用四步（需 `wrangler` 且站点以 **Cloudflare Workers** 部署）：

```bash
# 1) 建 KV 命名空间，复制返回的 id
wrangler kv namespace create PR_TRACES

# 2) 编辑 wrangler.toml，取消 [[kv_namespaces]] 注释并填入 id：
#    [[kv_namespaces]]
#    binding = "PR_TRACES"
#    id = "<上一步返回的 id>"

# 3) 设置取回口令（保护 /dump、/stats）
wrangler secret put DUMP_TOKEN

# 4) 部署
wrangler deploy
```

## 取回数据（"通过网址获得"）

- 浏览器直接打开（会显示/下载 JSONL）：
  ```
  https://<你的域名>/dump?token=<DUMP_TOKEN>&download=1
  ```
  `/dump` 分页返回，游标在响应头 `X-Next-Cursor`；用 `&cursor=` 翻页，`&since=<毫秒时间戳>` 增量拉取。
- 一条命令拉全量并拼接（自动翻页）：
  ```bash
  tools/fetch_human_wins.sh https://<你的域名> <DUMP_TOKEN> data/human-wins.jsonl
  python train/train.py data/human-wins.jsonl
  ```
- 汇总统计：
  ```
  https://<你的域名>/stats?token=<DUMP_TOKEN>
  → { ok, games, samples, byPlayerCount, firstTs, lastTs }
  ```

## 路由一览（`worker/index.js`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/collect` | 接收一局训练样本 `{ver,ts,n,humanSeat,turns,valueMode,scores,lines[]}` → 存 KV |
| GET  | `/dump`    | 取回聚合 JSONL（需 `?token=`；`?cursor=&limit=&since=&download=1`） |
| GET  | `/stats`   | 汇总统计（需 `?token=`） |
| *    | 其它       | 回退静态资源（站点本体） |

服务端会**重新规范化**每个样本（校验 `f` 长度 446、`a∈[0,7)`、数值有限），杜绝脏数据，
保证 `/dump` 的输出永远是干净、可直接训练的 JSONL。

## 隐私说明

- 上传真人**参与**的对局（胜负都收）；payload 只有训练张量（特征/动作/价值）+ 轻量元数据（玩家数、回合数、终局分数）。
- 不收集昵称、账号、IP（Cloudflare 边缘会看到请求 IP，但 Worker 不读取、不存储）。
- 端用户可用 `?collect=0` 永久退出。
