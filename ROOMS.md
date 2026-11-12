# Cloudflare 联机房间

联机站点的 `/rooms/:code/connect|poll|send|leave` 由 Worker 路由至每房间一个 SQLite Durable Object。客户端 `room-transport.js` 通过 HTTP 长轮询收取消息、POST 发送消息；不使用 Supabase。其余站点继续通过 `rooms-config.js` 连接主站房间后端，双击离线包则用本机多标签传输。

仍由房主浏览器运行游戏规则和 AI，房主页面需要保持打开。此次替换的是消息传输与房间服务，不是服务器规则引擎移植。

等候室支持 0–4 个机器人、自动补齐总人数、L1–L6 难度和随机座位；真人与机器人合计最多 5 位。随机时房主也参与分配，`G._hostSeat` 记录其本地座位，续局保持座位不变。房间设置通过 `room-config` 同步给其他玩家，房主自己的等候室选项在同标签刷新后保留。

等候室会同时列出真人与机器人，随机座位在开局时抽签。人数不足或超限时提前显示原因并禁用开局；满员时不能再加机器人，没有机器人时不能移除或调整难度。房主刷新会保留名字及自动补齐的目标人数，输入房间码后可按 Enter 加入。手机设置面板按屏幕宽度换行。

## 运行与部署

```text
npm install
npm run dev:online
# 打开 http://127.0.0.1:8898/，用两个标签建房、加入、开始
npm run test:rooms
npm run deploy
```

Wrangler 的自定义构建会执行 `tools/build-site.js`，将网页资源复制到 `.site`；这样 Wrangler 的临时目录与房间数据库不会被当作网页资源上传，也不会触发循环重载。修改网页脚本后需重新运行该脚本；修改 Worker 源码会自动重载。

部署使用根目录 `wrangler.toml`：保持现有 Worker 名称、域名和训练 KV，新增 `ROOMS` 绑定及 `rooms-v1` SQLite 类迁移。`npx wrangler deploy` 和 `npm run deploy` 都会自动生成 `.site`，Cloudflare 的自动构建无需额外配置。

### 朋友无需登录的公开访问

若打开游戏跳转到 `cloudflareaccess.com`，检查 Workers & Pages → `puerto-rico-web` → Access。账户级的 All Workers 规则可能同时保护正式域名与预览地址；为此 Worker 添加单独规则：Scope 选 **All traffic**，Authentication policy 选 **Make this Worker public（Bypass）**，再保存。保留账户级规则，不必修改其他项目。

保存后用未登录浏览器验证首页和建房、加入、长轮询接口。仅检查 HTTP 200 不够，Access 登录页也可能返回 200。此规则保存在 Cloudflare 控制台，不由 `wrangler.toml` 管理。

## 身份、同步与恢复

- 初次加入由服务器生成公开座位 token 与独立私密会话凭据；凭据存在每标签 sessionStorage。presence 与事件响应不包含别人的私密凭据。
- 房主首次占用房间后，其他人不能重新申请房主；同标签刷新持凭据恢复。关闭整个标签会失去 sessionStorage，需要重新加入并认领座位。
- 对局存档分别保存当前人类座位归属与原座位归属；AI 接管只移除当前归属。即使房主在接管期间刷新，客人回来仍可按原令牌自动收回座位。
- 客人只能发送应答与认领；服务器覆盖发送者 token，不能冒充其他座位。房主只能发送状态、选择请求、托管、认领结果与结算。
- 房主只接受当前在场且尚无座位的客人认领，每人最多占一个座位；对局结束后不能再认领。AI 接管或离开房间会清理客人的回合倒计时和发送提示。
- 浏览器恢复网络后先显示“正在重连”，收到房间服务的轮询响应才显示“已连接”。发送失败也会进入断线状态，后续轮询成功会恢复；重复失败不会持续弹出相同提示。连接失败和离开房间会移除对应事件监听，避免多次重试留下旧会话回调。
- 发送等待服务器确认，同一次网络重试使用同一消息编号，服务器去重。事件流有顺序编号；掉线按编号补发，超过 80 条或 600 KB 保留窗口则从最新快照及尚未完成的输入请求恢复。单条请求限制为 500 KB（按 UTF-8 字节计），使房间聚合存档保持在 SQLite 存储限制之内。
- 房间服务忽略晚到的旧状态，已结束的对局不会被旧广播覆盖。客人正在操作时暂存最新快照，完成选择后再更新棋盘；快照同步当前座位归属，即使错过接管或认领事件也能恢复。
- 结算和主动离开会清除自动重连标记及邀请参数；双方返回大厅后可重新建房，不会循环进入已结束的旧局。
- 同一成员每秒最多 30 条消息，每房间最多 24 个历史成员；持续轮询的成员视为在线，30 秒没有轮询视为离线。已有前端的掉线宽限与 AI 托管继续工作。
- 房间会话、消息与快照持久化；最后一次连接/发送/离开后 24 小时过期。房间恢复不等于服务器能够独立运行牌局，仍需房主回来运行原有存档。

## 验证

`tests/cloudflare_rooms_test.js` 连接本机实际 Wrangler 服务，验证房间不存在、建房加入、房主防抢占、鉴权、伪造消息拒绝、发送者绑定、重试去重、长轮询唤醒、刷新恢复、离开 presence 及事件缺口恢复。

已有 `tests/online_e2e_test.js` 保留离线多标签游戏回归，配置拦截已改为 `rooms-config.js`；不再包含 Supabase 模拟客户端。该脚本仍依赖 Playwright 与其约定的 Chromium 安装路径。

`tests/room_lobby_e2e_test.js` 使用实际房间服务和独立浏览器上下文，验证等候室人数限制、机器人名单、键盘加入、刷新设置、网络恢复确认与手机横向溢出。`tests/net_lifecycle_test.js` 验证失败清理、初始消息延后应用和重复关闭；`tests/netplay_identity_test.js` 验证认领身份与一人一席限制。

`tests/browser_runtime.js` 在 Windows/Linux 的 Playwright 浏览器缓存中寻找 Chromium，也支持 `CHROME_PATH` 指定路径。`tests/cloudflare_game_e2e_test.js` 使用两个独立浏览器上下文，通过实际 Cloudflare 房间服务从建房一直打到结算，中途验证客人邀请链接刷新、房主续局、AI 接管与收回座位，最后比较双方分数。通过 `ROOMS_TEST_BASE` 可以指定测试服务地址，默认本机 8898；测试仅缩短表现动画与 AI 搜索时间，不改游戏规则。

`ROOM_RANDOM_TEST=1` 覆盖随机入座，`ROOM_TEST_FINISH=1` 继续验证双方返回大厅并加入新房间。`tests/spectate_sync_test.js` 验证操作中暂存快照、缺失接管/认领事件、旧帧拒绝与终局输入清理；房间 API 测试同时验证乱序状态不会覆盖重连快照及结算。
