# 🇨🇳 国内访问指南

GitHub Pages 在中国大陆经常被 GFW 干扰（DNS 污染 / IP 阻断），不是项目问题。

**👉 最简单的方案：直接访问 [https://puerto-rico-web.vercel.app/](https://puerto-rico-web.vercel.app/)**（Vercel 部署，国内三大运营商通常可直连）

如果 Vercel 也连不上，下面的备用方案任选其一。

---

## 方案 A：Vercel（已部署，推荐）

**🔗 链接**：[https://puerto-rico-web.vercel.app/](https://puerto-rico-web.vercel.app/)

- 国内电信 / 联通 / 移动通常可直连，无需 VPN
- 跟随 GitHub main 自动更新
- 完全免费（Hobby plan）
- 无需 ICP 备案

直接把这个链接发给国内朋友即可。

---

## 方案 B：发离线 zip 给朋友（最稳，万一 Vercel 也不通）

**适用**：朋友的网络环境特别差，或不想依赖外部服务。

### 操作步骤

1. **下载源码 zip**：
   - 已科学上网：[直接下载 main.zip](https://github.com/Ethan9123/puerto-rico-web/archive/refs/heads/main.zip)
   - 在本地仓库运行 `pack.bat` 一键打包到桌面（见下文）

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

### 一键打包脚本

在仓库根目录双击 `pack.bat`，会在桌面生成 `puerto-rico-web-yyyymmdd.zip`（约 5 MB）。然后丢到微信文件传输助手 / 网盘即可。

---

## 方案 C：自部署到自己 Vercel / Cloudflare 账号

如果你想用自己的账号也部署一份（备用 / 学习目的）：

### Vercel

1. 注册 [vercel.com](https://vercel.com/)（邮箱即可，不需要中国手机号 / 信用卡）
2. Dashboard → Add New → Project → Continue with GitHub → 授权 → 选 `puerto-rico-web`
3. Application Preset 选 **Other**，Root Directory `./`，其他留空
4. 点 **Deploy**，30 秒后得到 `https://<项目名>.vercel.app`

### Cloudflare Workers / Pages

1. 注册 [cloudflare.com](https://www.cloudflare.com/)（邮箱 + 密码，免费）
2. **Workers & Pages** → **Create** → **Connect to Git**（现已统一为 Workers + 静态资源流程）
3. 选 `puerto-rico-web` → Build command 留空 → Deploy command `npx wrangler deploy` → Root `/`
   （仓库已内置 `wrangler.toml`：`[assets] directory="."`，开箱即用）
4. 拿到 `https://<项目名>.<账号>.workers.dev`

> ⚠️ **重点：`*.workers.dev` / `*.pages.dev` 在国内基本打不开** —— 不是"略差"，而是被 GFW
> 按域名后缀做了 DNS 污染 + SNI 封锁，**默认子域名国内不可用**（海外/翻墙用户不受影响）。
>
> ✅ **让 CF 站国内可访问的正解：绑你自己的域名**（仍然不用备案）
> 1. 买个便宜域名（避开 `.cn` 实名；`.com`≈¥70/年，`.xyz` 首年≈¥10）
> 2. 域名 DNS 接入 Cloudflare（改 NS）
> 3. Worker → **Settings → Domains & Routes → Add → Custom domain** 绑上去，证书自动签发
> 4. 用自定义域名访问，国内通常即可打开
>
> 但即便绑了域名，CF 免费版 IP 在国内仍**时通时不通**（可能要"优选 IP"）。要 100% 稳定只能
> ① 境内服务器/CDN + ICP 备案，或 ② CF 中国网络（需 ICP+联营）——都要备案。
> 用 [itdog.cn](https://www.itdog.cn/) 多地 ping 可客观验证国内可达性。

---

## 资源 CDN：jsDelivr（已可用，国内秒开）

如果你只需要项目里某个具体资源（建筑插画、JSON 数据等），可以走 jsDelivr 国内节点：

```
https://cdn.jsdelivr.net/gh/Ethan9123/puerto-rico-web@main/<文件路径>
```

例：
- 建筑插画：`https://cdn.jsdelivr.net/gh/Ethan9123/puerto-rico-web@main/assets/buildings/01_small_indigo.png`
- ai_dna.json：`https://cdn.jsdelivr.net/gh/Ethan9123/puerto-rico-web@main/ai_dna.json`

但 jsDelivr **不会渲染 HTML**（GitHub raw API 安全策略），所以不能直接当主入口用。

---

## 推荐组合

| 你的场景 | 用哪个 |
|---|---|
| 国内朋友直接玩 | **方案 A · Vercel**（已部署好） |
| Vercel 也连不上 / 想完全离线 | **方案 B · zip 发文件传输助手** |
| 给一群人做自己的镜像 | 方案 C 自部署一份 |

所有方案都不需要 ICP 备案。
