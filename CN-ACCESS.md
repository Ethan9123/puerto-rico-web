# 🇨🇳 国内访问指南

GitHub Pages 在中国大陆经常被 GFW 干扰（DNS 污染 / IP 阻断），不是项目问题。下面 3 个方案任选其一，按你的需求选。

---

## 方案 1：发离线 zip 给朋友（最经济，0 成本，最稳）

**适用**：1-N 个朋友、临时玩、不想搞服务器/账号。

### 操作步骤

1. **下载源码 zip**：
   - 已科学上网：[直接下载 main.zip](https://github.com/Ethan9123/puerto-rico-web/archive/refs/heads/main.zip)
   - 没有科学上网：从「[Releases 页](https://github.com/Ethan9123/puerto-rico-web/releases)」下载（如未发布，可在本地仓库运行 `pack.bat` 打包，见下文）。

2. **解压**得到 `puerto-rico-web-main/` 文件夹（约 5-10 MB）。

3. **通过国内通道转发给朋友**（任选一个）：
   - 微信「文件传输助手」→ 转发给朋友
   - 百度网盘 / 腾讯微云 → 上传 → 复制分享链接
   - QQ / 钉钉 / 飞书 → 直接拖文件

4. **朋友收到后**：
   - Windows：解压 → 双击 `run.bat`（脚本自动开本地 HTTP 服务器，弹出浏览器）
   - Mac/Linux：解压 → 命令行 `cd puerto_rico_game && python3 -m http.server 8765` → 浏览器开 `http://localhost:8765`

**优点**：完全离线，不依赖任何外部服务，永远能玩。
**缺点**：每次更新都要重新发 zip。

### 一键打包脚本（仅作者侧用）

在仓库根目录运行 `pack.bat`（见仓库），会生成 `puerto-rico-web-vX.zip` 放到桌面。然后丢到 GitHub Releases 或网盘。

---

## 方案 2：Cloudflare Pages 在线版（免费、长期推荐）

**适用**：想给朋友一个永久 URL、自己也方便（推送 GitHub 自动更新）。

### 一次性设置（约 5 分钟）

1. 打开 [pages.cloudflare.com](https://pages.cloudflare.com/) → **Sign up**（邮箱 + 密码即可，不需要中国手机号 / 不需要信用卡）
2. 验证邮箱
3. Dashboard 左侧 → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
4. 授权 Cloudflare 访问你的 GitHub → 选 `Ethan9123/puerto-rico-web`
5. 配置：
   - **Framework preset**: None
   - **Build command**: 留空
   - **Build output directory**: `/`
6. 点 **Save and Deploy**

**完成！** 拿到 `https://puerto-rico-web.pages.dev` 永久链接。每次 push 到 main 自动重新部署。

### CF Pages 在国内的实际可用性

- 电信用户：通常稳定可达
- 联通/移动：偶尔慢或被劫持，但比 GitHub Pages 好
- 如想 100% 稳定，需绑自定义域名 + 国内 CDN（成本上升）

### 自定义域名（可选）

CF Pages 默认给 `*.pages.dev`，国内电信通常能打开。如果想用 `puerto-rico.你的域名.com`，需要：
1. 买域名（推荐 [Namecheap](https://www.namecheap.com/) 或 [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/)，约 ¥70/年）
2. 添加 CNAME 到 `puerto-rico-web.pages.dev`
3. CF 自动签 HTTPS 证书

---

## 方案 3：Vercel（备选，方法同 CF Pages）

[vercel.com](https://vercel.com/) → 同样的 GitHub 集成。Vercel 默认域名 `*.vercel.app` 国内电信/联通/移动可用性比 GH Pages 强。

部署步骤同方案 2，但 Vercel 对静态网站收费政策更宽松。

---

## 资源 CDN：jsDelivr（已可用，国内秒开）

图片、CSS、JS 单文件可以走 jsDelivr 加速（国内有节点）：

```
https://cdn.jsdelivr.net/gh/Ethan9123/puerto-rico-web@main/<文件路径>
```

例：
- 建筑插画：`https://cdn.jsdelivr.net/gh/Ethan9123/puerto-rico-web@main/assets/buildings/01_small_indigo.png`
- ai_dna.json：`https://cdn.jsdelivr.net/gh/Ethan9123/puerto-rico-web@main/ai_dna.json`

但 **jsDelivr 不会渲染 HTML**（GitHub API 安全策略所致），所以不能直接 `cdn.jsdelivr.net/gh/.../index.html` 当主入口用。

---

## 推荐组合

| 你的场景 | 用哪个 |
|---|---|
| 临时给 1-2 个朋友玩 | **方案 1 离线 zip** + 微信发 |
| 长期分享给一群朋友 | **方案 2 Cloudflare Pages** |
| 想要中国电信纯净打开速度 | 方案 2 + 自定义域名 + 国内 CDN |

任何方案都不需要 ICP 备案。
