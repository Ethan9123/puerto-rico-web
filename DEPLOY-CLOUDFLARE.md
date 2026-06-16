# 用 Cloudflare 在线托管（无需 ICP 备案）

本项目是**纯前端静态站点**（`index.html` + `game.js` + 样式与 AI 数据都在浏览器里运行，没有后端）。
托管在 **Cloudflare**（Workers + 静态资源）上，节点都在中国大陆境外，因此**不触发 ICP 备案要求**——
备案只对「服务器位于中国大陆境内」的站点强制。境外托管面向公众访问是合法且常见的做法。

> 免费版由境外节点（香港 / 日本 / 美国等）提供服务，大陆用户可访问，但走国际出口、速度受网络环境影响。
> 想要大陆境内 CDN 加速需 Cloudflare 中国网络（需联营 + ICP 许可证），那反而需要备案，与本目标相反。

仓库已内置部署所需文件：`wrangler.toml`（Workers 静态资源配置）、`.assetsignore`（排除 tests/tools 等非网页文件）、`_headers`（缓存策略）。

---

## 方法一（推荐，零配置、自动部署）：控制台连接 Git

Cloudflare 现已统一为 **Workers + 静态资源** 的 Git 流程：

1. 登录 <https://dash.cloudflare.com>（免费账户即可）。
2. **Workers & Pages** → **Create** → **Import a repository / Connect to Git**，授权并选择 `Ethan9123/puerto-rico-web`。
3. 在 “Set up your application” 页按以下填：
   - **Project name**：`puerto-rico-web`
   - **Production branch**：`main`
   - **Build command**：**留空**（纯静态，无构建步骤）
   - **Deploy command**：`npx wrangler deploy`（默认即是）
   - **Root directory**：`/`
   - **API token**：让它「自动创建」即可（A new token will be created automatically）
   - **Variables**：无需任何环境变量，留空
4. **Create / Deploy**，约 1 分钟后得到地址 `https://puerto-rico-web.<子域>.workers.dev` —— 打开即可在线玩。
5. 之后每次推送到 `main`，Cloudflare 会自动重新部署（非生产分支用 `npx wrangler versions upload` 出预览版）。

> 关键点：`wrangler.toml` 用的是 `[assets] directory = "."`，所以 `npx wrangler deploy` 会以
> 「仅静态资源 Worker」形式部署，自动在 `/` 提供 `index.html`，无需写任何 Worker 脚本。

---

## 方法二：本地命令行一键部署（Wrangler）

```bash
npm install -g wrangler        # 或用 npx wrangler ...
wrangler login                 # 浏览器授权一次
wrangler deploy                # 读取 wrangler.toml，上传静态资源并部署
```

`wrangler deploy --dry-run` 可在不部署的情况下校验配置（会列出读取到的资源文件数）。

---

## 方法三：GitHub Actions 自动部署（仓库已内置 workflow）

`.github/workflows/cloudflare-pages.yml` 已就绪，默认**关闭**（不会产生失败的 CI）。仅当你**不**用方法一的
Cloudflare 自带 Git 构建、而想用 GitHub Actions 时才需要：

1. Cloudflare 创建 **API Token**（权限含 **Workers Scripts: Edit**）。
2. 取得 **Account ID**。
3. 仓库 **Settings → Secrets and variables → Actions**：
   - **Secrets**：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
   - **Variables**：`CF_DEPLOY` = `true`
4. 推送到 `main` 或在 Actions 页手动 Run，即执行 `wrangler deploy`。

> 未设 `CF_DEPLOY=true` 前该 workflow 跳过（Skipped），不会让提交变红。
> 注意：方法一（Cloudflare 自带 Git 构建）与方法三（GitHub Actions）二选一即可，别同时开以免重复部署。

---

## 绑定自定义域名（可选）

Workers 项目 → **Settings → Domains & Routes** → 添加自定义域名；DNS 建议托管在 Cloudflare（免费），证书自动签发。
**同样无需备案**：解析与服务都在 Cloudflare 境外节点完成。（`.cn` 域名注册本身有实名要求，用 `.com`/`.net` 可完全规避。）

---

## 与现有 Vercel 部署的关系

本仓库此前已自动部署到 **Vercel**（同为境外托管、同样无需备案），**现在其实已可在线玩**。
Cloudflare 是一个等价/可叠加的选择，适合想要 `workers.dev` 域名或用 Cloudflare 统一管理 DNS / 域名的情况。两者可并存。
