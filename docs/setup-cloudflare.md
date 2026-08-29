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
- **自动部署(二选一)**:仓库支持两种"合并 PR 进 main 后自动构建部署"的方式 ——
  - **方案 A:GitHub Actions**(配置在仓库内,已内置 `.github/workflows/deploy.yml`),见 §6.1;
  - **方案 B:Cloudflare 原生 Git 集成(Workers Builds)**,全程在 Cloudflare 网页操作、无需创建 API Token,见 §6.2。
  - **只启用其中一种**,同时启用会重复部署。
- **自定义域名(可选)**:Dashboard → Workers & Pages → onehub → Settings → Domains & Routes → Add Custom Domain(域名需已托管在该 Cloudflare 账号)。

### 6.1 方案 A:GitHub Actions

1. 生成 Cloudflare API Token:Dashboard → 右上角头像 → **My Profile → API Tokens → Create Token** → 使用模板 **"Edit Cloudflare Workers"** → Create 并复制(只显示一次);
   - 若部署时报 KV 权限错误,编辑该 Token 追加 **Account → Workers KV Storage → Edit**;
2. 复制 **Account ID**:Dashboard → Workers & Pages 概览页右侧栏;
3. GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret** 添加四个:
   - `CLOUDFLARE_API_TOKEN` = 第 1 步的 Token
   - `CLOUDFLARE_ACCOUNT_ID` = 第 2 步的 ID
   - `CF_KV_ACCOUNTS_ID` / `CF_KV_GATE_ID` = §2 创建的两个 KV namespace id

之后每次 PR 合并进 main,GitHub Actions 会自动构建 + 部署(Action 日志可见部署后的 workers.dev 地址)。也可以在 Actions 页面手动 **Run workflow** 触发;未配置 secrets 时部署步骤自动跳过,不会报错。

### 6.2 方案 B:Cloudflare 原生 Git 集成(Workers Builds,全程网页操作)

无需创建 API Token——部署鉴权由 Cloudflare 与 GitHub 的集成自动完成,您只需要授权仓库 + 填两个构建变量。

**前置条件**

- Worker `onehub` 已存在(至少手动 `npm run deploy` 部署过一次;§2 的两个 KV 命名空间已创建);
- `worker/wrangler.template.jsonc` 中的 Worker 名 `onehub` 与 Dashboard 里的 Worker 名一致(Workers Builds 会校验配置文件的 name 字段,不一致会构建失败);
- 您有 GitHub 仓库的管理权限(安装 App 时授权)。

**第 1 步:授权并连接仓库**

1. Dashboard → **Workers & Pages** → 点进 `onehub`;
2. **Settings → Builds → Connect**(首次进入显示 "Set up builds");
3. 选择 **GitHub** → 弹出 Cloudflare GitHub App 安装页 → 选择 **Only select repositories** → 勾选 `OneHub`(私有仓库也可选到)→ **Install & Authorize**;
4. 回到 Cloudflare,在仓库下拉框中选择 `zxymiku/OneHub`,生产分支填 **`main`**。

**第 2 步:构建设置(按下面逐项填写)**

| 字段 | 填写值 | 说明 |
|---|---|---|
| Root directory | **留空**(即仓库根) | 构建命令需要在根目录跑 workspaces 安装 |
| Build command | `npm ci && npm run build:web && node worker/gen-wrangler.mjs` | 安装依赖 → 构建前端 → 生成含真实 KV id 的 `worker/wrangler.jsonc` |
| Deploy command | `npx wrangler deploy -c worker/wrangler.jsonc` | `-c` 指向子目录里的配置;配置内 `../frontend/dist` 会以配置文件位置解析,正好指向刚构建的产物 |
| Non-production branch deploy command | `npx wrangler versions upload -c worker/wrangler.jsonc` | 非 main 分支(push/PR)只上传为预览版本,**不会**更新线上 |

**第 3 步:添加构建变量(Settings → Build → Variables)**

| 变量名 | 值 | 类型 |
|---|---|---|
| `CF_KV_ACCOUNTS_ID` | §2 创建的 ACCOUNTS 命名空间 id | Secret |
| `CF_KV_GATE_ID` | §2 创建的 GATE 命名空间 id | Secret |
| `NODE_VERSION`(可选,推荐) | `22` | Plain text |

说明:构建变量只在构建过程可见,不会进入运行时,也不会出现在仓库;`CF_KV_*` 用于注入生成 wrangler.jsonc(开源零标识符设计,见 docs/安全.md §4)。wrangler 版本自动取自 `worker/package.json`,无需额外指定。

**第 4 步:首次构建与验证**

1. 保存设置后 Workers Builds 会立即触发一次构建;之后每次 push 到 `main`(即 PR 合并)自动构建;
2. 构建进度与日志:**Deployments 标签页 → View build history**(或 Version History 里对应版本旁的 View build);绿色 = 部署成功,打开 workers.dev 地址确认版本生效;
3. 手动重跑:构建历史里选一条 → **Retry build**(使用重试那一刻的最新构建设置)。

**日常行为与注意**

- 合并 PR → 自动构建部署;普通功能分支 push → 只生成预览版本,不影响线上;
- 改了构建设置只对**下一次**构建生效;
- 站点密钥(`wrangler secret put` 设置的 ACCESS_PASSWORD / GATE_SECRET)存在 Worker 上,**不受自动部署影响**;
- 断开/更换仓库:**Settings → Builds → Disconnect**(更换仓库需先断开再重新 Connect)。

**常见问题排查**

| 现象 | 原因与处理 |
|---|---|
| 构建失败提示 Worker name 不匹配 | Dashboard Worker 名必须与配置文件里的 `"name": "onehub"` 一致;改 Dashboard 侧名字或模板中的 name 后重试 |
| 日志报 `CF_KV_ACCOUNTS_ID is empty` 类警告,部署到一半失败 | 第 3 步变量没加或拼写错误(注意全大写、下划线) |
| `npm ci` 报 Node 版本相关错误 | 加构建变量 `NODE_VERSION=22` |
| 前端产物缺失(部署后页面 404) | Build command 被改过,确认包含 `npm run build:web` 且 Root directory 留空 |
| 想改回手动部署 | Settings → Builds → Disconnect 即可,Worker 与 KV 数据不受影响 |

> **与方案 A 的取舍**:方案 B 全程网页点选、零 Token 管理,适合个人使用;方案 A 的配置随仓库版本化、审查可见,适合多人/多 agent 协作。两者不要同时启用。

## 7. 验证清单

- [ ] `curl https://<部署域名>/api/health` 返回 `{"ok":true}`
- [ ] 首页能看到所有已添加账号的展示名
- [ ] 任一账号能进入并列出文件;点文件可下载(浏览器直接开始下载)
- [ ] `.md`、`.mp4`、`.docx` 各自能预览;`.exe` 之类显示"不支持在线预览"
- [ ] (若设了密码)未登录时接口返回 401,输入密码后正常
