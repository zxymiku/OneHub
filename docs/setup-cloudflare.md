# Cloudflare 配置教程(Workers + KV + 部署)

## 1. 准备

- 注册 [Cloudflare](https://dash.cloudflare.com) 账号(免费版即可,Workers 免费 10 万请求/天,KV 免费 10 万读/天,本项目绰绰有余)。
- 本地安装 Node.js ≥ 20 与 Git;在仓库根目录 `npm install`。
- 登录 wrangler(Cloudflare 官方 CLI,已含在 devDependencies,用 `npx wrangler` 调用):

```bash
npx wrangler login        # 会打开浏览器授权
```

## 2. 创建 KV 命名空间

```bash
npx wrangler kv namespace create ACCOUNTS   # 账号注册表(含凭据)
npx wrangler kv namespace create GATE       # 密码门限速计数
```

记下两个命令输出的 `id`。**开源安全设计:仓库里不含真实 id** —— 配置文件 `worker/wrangler.jsonc` 由 `wrangler.template.jsonc` 生成,注入来源:

- **本地**(dev / 本地 KV 操作 / account:sync):写入 `worker/.dev.vars`(已 gitignore):
  ```
  CF_KV_ACCOUNTS_ID=<第一个 id>
  CF_KV_GATE_ID=<第二个 id>
  ```
- **线上部署**:填入 GitHub Secrets 或 Workers Builds 构建变量,同名 `CF_KV_ACCOUNTS_ID` / `CF_KV_GATE_ID`(见 §6.1)。

## 3. 配置访问密码(可选,但强烈建议)

不设置则网站完全公开;设置后访客需先输入密码:

```bash
npx wrangler secret put ACCESS_PASSWORD     # 输入你想要的访问密码
npx wrangler secret put GATE_SECRET         # 输入一段随机长字符串(HMAC 密钥), 例: openssl rand -hex 32
```

**网页管理台(仅本地开发,推荐)**:账号管理不部署到线上,彻底消除公开攻击面。本地开发时:

```bash
# worker/.dev.vars(已 gitignore, 不会部署)写入:
#   ADMIN_MODE=local
#   ADMIN_PASSWORD=你的管理密码
#   GATE_SECRET=任意随机串
npm run dev:worker      # 本地启动后访问 http://127.0.0.1:8787/admin
```

在本地 `/admin` 里添加/改名/删除账号(个人版设备码可视化授权、企业版表单即验即存),数据保存在本机;然后一条命令同步到线上:

```bash
npm run account:sync            # 本地账号 → 线上 KV(同 id 覆盖, 线上多出的账号保留)
npm run account:sync -- --dry-run   # 只预览不上传
```

> 线上 Worker 没有任何账号管理接口(外部访问 `/api/admin/*` 一律 404),管理密码、设备码、凭据只出现在您的电脑与 Cloudflare 之间。需要线上紧急改动时仍可用 CLI 的 `account:add --remote` / `account:remove --remote`。

本地开发则在 `worker/.dev.vars`(已 gitignore)里写:

```
ACCESS_PASSWORD=dev123
GATE_SECRET=dev-secret-change-me
```

## 4. 添加 OneDrive 账号

先完成 `docs/setup-azure.md` 的应用注册,然后:

```bash
# 个人版(会给出设备码, 浏览器打开 microsoft.com/devicelogin 输入并登录)
npm run account:add -- --name 一号机 --type personal --client-id <应用程序ID>

# 企业版 E5/E3
npm run account:add -- --name 账号2 --type business \
  --client-id <应用程序ID> --tenant-id <租户ID> \
  --client-secret <密钥Value> --upn admin@xxxx.onmicrosoft.com

npm run account:list                 # 查看已添加账号(不显示密钥)
npm run account:remove -- --id <id>  # 移除账号
```

> 本地开发时脚本写入的是**本地 KV 预览数据**(`wrangler dev` 的本地模拟),部署前用 `--remote` 写入线上 KV,详见脚本 `--help`。

## 5. 本地开发

```bash
npm run dev:worker    # 终端1: wrangler dev, API 在 http://localhost:8787
npm run dev:web       # 终端2: vite 开发服务器 http://localhost:5173 (已代理 /api → 8787)
```

## 6. 部署上线

```bash
npm run build:web     # 构建 frontend/dist
npm run deploy        # wrangler deploy, 输出形如 https://onehub.<你的子域>.workers.dev
```

- 更新版本:拉取最新代码后重复第 6 步即可(账号与配置都在 Cloudflare 侧,不受影响)。
- **自定义域名(可选)**:Dashboard → Workers & Pages → onehub → Settings → Domains & Routes → Add Custom Domain(域名需已托管在该 Cloudflare 账号)。
- **CI 自动部署**:仓库已内置 `.github/workflows/deploy.yml` —— main 分支每合并一个 PR,自动构建前端并 `wrangler deploy`。启用只需在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加两个 secrets(见 §6.1);未配置时部署步骤自动跳过,不会报错。
- **自定义域名(可选)**:Dashboard → Workers & Pages → onehub → Settings → Domains & Routes → Add Custom Domain(域名需已托管在该 Cloudflare 账号)。

### 6.1 配置自动部署的 GitHub Secrets

1. 生成 Cloudflare API Token:Dashboard → 右上角头像 → **My Profile → API Tokens → Create Token** → 使用模板 **"Edit Cloudflare Workers"** → Create 并复制(只显示一次);
   - 若部署时报 KV 权限错误,编辑该 Token 追加 **Account → Workers KV Storage → Edit**;
2. 复制 **Account ID**:Dashboard → Workers & Pages 概览页右侧栏;
3. GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret** 添加四个:
   - `CLOUDFLARE_API_TOKEN` = 第 1 步的 Token
   - `CLOUDFLARE_ACCOUNT_ID` = 第 2 步的 ID
   - `CF_KV_ACCOUNTS_ID` / `CF_KV_GATE_ID` = §2 创建的两个 KV namespace id

之后每次 PR 合并进 main,GitHub Actions 会自动构建 + 部署(Action 日志可见部署后的 workers.dev 地址)。也可以在 Actions 页面手动 **Run workflow** 触发。

**备选方案(Cloudflare 原生 Git 集成,免 Token)**:Dashboard → Workers & Pages → onehub → **Settings → Build → Connect**(Workers Builds),绑定本仓库与 main 分支,构建命令填 `npm ci && npm run build:web && node worker/gen-wrangler.mjs`,部署命令 `npx wrangler deploy -c worker/wrangler.jsonc`;并在构建设置的 **Variables** 里添加 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`CF_KV_ACCOUNTS_ID`、`CF_KV_GATE_ID` 四个变量。两种方式二选一即可,避免同时启用造成重复部署。

## 7. 验证清单

- [ ] `curl https://<部署域名>/api/health` 返回 `{"ok":true}`
- [ ] 首页能看到所有已添加账号的展示名
- [ ] 任一账号能进入并列出文件;点文件可下载(浏览器直接开始下载)
- [ ] `.md`、`.mp4`、`.docx` 各自能预览;`.exe` 之类显示"不支持在线预览"
- [ ] (若设了密码)未登录时接口返回 401,输入密码后正常
