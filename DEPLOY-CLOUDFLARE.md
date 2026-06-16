# 用 Cloudflare Pages 在线托管（无需 ICP 备案）

本项目是**纯前端静态站点**（`index.html` + `game.js` + 样式与 AI 数据都在浏览器里运行，没有后端）。
把它托管在 **Cloudflare Pages** 上，服务器节点都在中国大陆境外，因此**不触发 ICP 备案要求**——
备案只对「服务器位于中国大陆境内」的站点强制。境外托管、面向公众访问是合法且常见的做法。

> 说明：免费版 Cloudflare Pages 由境外节点（香港 / 日本 / 美国等）提供服务，大陆用户可以访问，
> 但走的是国际出口，速度受网络环境影响。若想要大陆境内 CDN 加速，需要 Cloudflare 中国网络
> （需联营 + ICP 许可证）——那种方案反而需要备案，与本目标相反，故不采用。

---

## 方法一（推荐，零配置、自动部署）：在 Cloudflare 控制台连接 Git

1. 注册 / 登录 <https://dash.cloudflare.com>（免费账户即可）。
2. 左侧 **Workers & Pages** → **Create** → **Pages** → **Connect to Git**。
3. 授权 GitHub，选择仓库 `Ethan9123/puerto-rico-web`。
4. 构建设置（关键，按以下填）：
   - **Framework preset**：`None`
   - **Build command**：留空
   - **Build output directory**：`/`（仓库根目录）
5. **Save and Deploy**。约 1 分钟后得到地址：`https://puerto-rico-web.pages.dev` —— 打开即可在线玩。
6. 之后每次推送到 `main`，Cloudflare 会自动重新部署。

这是最省事的方式，**不需要本仓库里的任何脚本，也不需要在 GitHub 配密钥**。

---

## 方法二：命令行一键部署（Wrangler）

适合想手动控制发布节奏的场景。本地需装 Node：

```bash
npm install -g wrangler        # 或 npx wrangler ...
wrangler login                 # 浏览器授权一次
wrangler pages deploy . --project-name=puerto-rico-web
```

仓库已内置 `wrangler.toml` 与 `.assetsignore`（自动排除 tests/tools/train 等非网页文件），
所以上面这行命令即可把干净的站点推上去，输出形如 `https://<hash>.puerto-rico-web.pages.dev`。

---

## 方法三：GitHub Actions 自动部署（仓库已内置 workflow）

`.github/workflows/cloudflare-pages.yml` 已就绪，默认**关闭**（不会产生失败的 CI）。启用一次即可：

1. Cloudflare 控制台创建 **API Token**（My Profile → API Tokens → Create Token，
   权限至少包含 **Account → Cloudflare Pages → Edit**）。
2. 拿到 **Account ID**（控制台主页右侧或 Workers & Pages 页面）。
3. 仓库 **Settings → Secrets and variables → Actions**：
   - **Secrets** 标签新增：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
   - **Variables** 标签新增：`CF_DEPLOY` = `true`
4. 推送到 `main` 或在 **Actions** 页手动 *Run workflow*，即自动部署。

> 未设置 `CF_DEPLOY=true` 前，该 workflow 会被跳过（Skipped），不会让提交变红。

---

## 绑定自定义域名（可选）

1. Pages 项目 → **Custom domains** → **Set up a custom domain** → 输入你的域名。
2. 域名的 DNS 建议托管在 Cloudflare（免费）；按提示添加 CNAME 即可，证书自动签发。
3. **同样无需备案**：解析与服务都在 Cloudflare 境外节点完成。
   （注意：`.cn` 域名注册本身有实名要求，与网站备案是两回事；用 `.com`/`.net` 等可完全规避。）

---

## 与现有 Vercel 部署的关系

本仓库此前已自动部署到 **Vercel**（同样是境外托管、同样无需备案，PR 里能看到 `*.vercel.app` 预览）。
也就是说**现在其实已经能在线玩了**。Cloudflare Pages 是一个等价/可叠加的选择，
适合你想换平台、要 `pages.dev` 域名、或想用 Cloudflare 统一管理 DNS / 域名的情况。两者可以并存。
