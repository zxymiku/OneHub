# OneHub

> 多 OneDrive 网盘聚合站 · GitHub + Cloudflare 全免费资源 · 多账号并列展示 / 下载直链 / 在线预览

OneHub 把您的多个 OneDrive(个人版、E3、E5、企业版混合均可)聚合到一个网页:每个账号以自定义展示名(如"一号机""账号2")并列呈现,访客点击进入对应网盘浏览文件,点击即可通过 OneDrive 临时直链下载,常见文档/媒体可直接在线预览。**所有账号凭据保存在 Cloudflare 服务端,访客无法接触。**

## 功能特性

- 🔢 **多账号聚合**:任意数量 OneDrive 账号,自定义展示名,首页矩阵式进入
- 🖥 **本地网页管理台**:本地开发时浏览器 `/admin` 页添加/改名/删除账号(个人版设备码可视化授权、企业版表单即验即存),`account:sync` 一键同步线上;**线上不存在任何管理接口**,零公开攻击面
- 📁 **在线浏览**:目录树导航、面包屑、文件名/大小/时间展示
- 🔗 **直链下载**:直接推送 OneDrive 预授权临时链接(约 1 小时有效),流量不经过服务器
- 👁 **在线预览**:docx / xlsx / pptx(微软官方渲染)、txt / markdown / 代码文本、pdf、图片、mp4 等视频、音频;不支持的类型明确提示"此文件类型不支持在线预览,请下载后查看"
- 🔐 **账号零暴露**:凭据只存 Cloudflare KV,前端仅见展示名与文件元数据;可选站点访问密码
- 🎨 **endfield 风格界面**:白/炭黑/信号黄工业工程视觉,4 级 maximal 极繁深度(基于 ark-ui 设计方法论,clean-room 实现)
- 🆓 **零成本运行**:Cloudflare Workers + KV 免费额度(10 万请求/天)即可支撑

## 架构一览

```
浏览器 (React SPA)
   │ 只接触: 展示名 / 文件元数据 / 临时直链
Cloudflare Worker ── 静态页面 + /api/*(管理接口仅存在于本地开发)
   │ 个人版: OAuth 刷新令牌(轮换回写)   E5/E3/企业版: 应用密钥(client credentials)
Microsoft Graph API
```

细节见 [docs/架构.md](docs/架构.md) 与 [docs/api.md](docs/api.md)。

---

## 全链路部署教程

按顺序完成 5 步,约 30 分钟(不含等待)。开始前您需要:**一个 Cloudflare 账号**、**Node.js ≥ 20**、**Git**。

### 第 1 步:获取代码

```bash
git clone https://github.com/<your-name>/OneHub.git
cd OneHub
npm install
```

### 第 2 步:注册 Azure 应用(让 OneHub 有权读您的 OneDrive)

按账号类型二选一或都做,详细图文步骤见 **[docs/setup-azure.md](docs/setup-azure.md)**:

| 账号类型 | 需要注册 | 完成后您手里有 |
|---|---|---|
| 个人版 OneDrive | 公共客户端应用(委托权限 `Files.Read.All + offline_access + User.Read`,开公共客户端流) | 应用程序(client) ID |
| E5 / E3 / 企业版 | 单租户应用 + 客户端密码(应用程序权限 `Files.Read.All` + 管理员同意) | 租户 ID + 应用 ID + 密钥 Value + 目标用户 UPN |

### 第 3 步:配置 Cloudflare

```bash
npx wrangler login                        # 浏览器授权登录
npx wrangler kv namespace create ACCOUNTS # 记下输出的 id
npx wrangler kv namespace create GATE     # 记下输出的 id
```

**开源安全设计:仓库不含真实 id**。把两个 id 写入本地 `worker/.dev.vars`(已 gitignore):

```
CF_KV_ACCOUNTS_ID=<第一个 id>
CF_KV_GATE_ID=<第二个 id>
```

```bash
# 可选但强烈建议:站点访问密码(不设则完全公开)
npx wrangler secret put ACCESS_PASSWORD   # 输入访问密码
npx wrangler secret put GATE_SECRET       # 输入随机长串: openssl rand -hex 32
```

### 第 4 步:添加您的 OneDrive 账号

**方式 A:本地网页管理台(推荐,全程点点点,线上零管理接口)**

账号管理只在您的电脑上进行,线上网站不存在任何管理接口(外部访问一律 404),这是隐私最稳妥的方式:

```bash
# 1) 本地启用管理台: 在 worker/.dev.vars(已 gitignore, 第 3 步已建)再追加三行:
#    ADMIN_MODE=local
#    ADMIN_PASSWORD=你的管理密码
#    GATE_SECRET=任意随机串
npm run dev:worker        # 2) 启动本地服务(只绑定本机 127.0.0.1)
# 3) 浏览器打开 http://127.0.0.1:8787/admin:
#    + 个人版 → 页面显示设备码 → 微软页面输入并登录 → 自动入库
#    + 企业版 → 表单填写, 服务端即时验证, 通过才写入
npm run account:sync      # 4) 把本地账号上传到线上 KV(经 Cloudflare 认证连接加密传输)
npm run deploy            # 5) 首次部署(之后改账号只需重复 3-4, 无需重新部署)
```

**方式 B:命令行 CLI**

```bash
# 个人版:屏幕出现设备码 → 打开 https://microsoft.com/devicelogin 输入并登录对应账号
npm run account:add -- --name 一号机 --type personal --client-id <应用程序ID>

# 企业版/E5/E3:
npm run account:add -- --name 账号2 --type business \
  --client-id <应用程序ID> --tenant-id <租户ID> \
  --client-secret <密钥Value> --upn admin@xxxx.onmicrosoft.com

npm run account:add -- --remote ...   # 任何命令加 --remote 直接写线上 KV
npm run account:list                  # 检查
```

两种方式管理同一套数据模型,可混用。`--name` 就是首页展示的名字,随意取("一号机"、"账号2"、家庭云盘…)。

### 第 5 步:部署上线

```bash
npm run build:web
npm run deploy            # 得到 https://onehub.<你的子域>.workers.dev
```

**之后的更新全自动**:从两种自动部署方式里选一种、按 `docs/setup-cloudflare.md` 做一次性配置 ——
§6.1 **GitHub Actions**(仓库内工作流,加 4 个 Secrets)或 §6.2 **Workers Builds**(全程 Cloudflare 网页操作、零 Token)。此后每个 PR 合并进 main,Cloudflare 都会自动构建部署,无需本地操作。打开域名,验证清单见 [docs/setup-cloudflare.md §7](docs/setup-cloudflare.md#7-验证清单)。可选进阶:自定义域名、本地开发模式,均见该文档。

---

## 安全说明(账号信息如何被保护)

- 凭据(clientSecret / refreshToken)只存 **Cloudflare KV(静态加密)**,前端与仓库**永不接触**;access_token 缓存约 55 分钟自动过期。
- 下载直链是 Graph 预授权临时链接(≈1 小时失效);访客可见展示名与文件元数据,但**看不到您的邮箱/UPN/任何密钥**。
- 可选站点密码:HMAC 签名 HttpOnly Cookie + 按 IP 限速防暴破。
- **仓库可安全开源**:配置由模板生成,KV id 等账户标识符只在部署时注入(环境变量/CI Secrets),仓库与 git 历史新增内容均不含任何标识符与凭据;开源前的一次性历史检查见 [docs/安全.md](docs/安全.md)。
- 企业版直链主机名会含租户名(如 `contoso-my.sharepoint.com`),属已知限制,详见 **[docs/安全.md](docs/安全.md)**(含您应做的定期维护项)。

## 常见问题

<details>
<summary><b>设备码登录报 AADSTS7000218</b></summary>
个人版应用未开"允许公共客户端流":Azure Portal → 应用 → 身份验证 → 底部高级设置 → 设为"是"。
</details>

<details>
<summary><b>企业版取 token 报 403 / AADSTS65001</b></summary>
未授予管理员同意:API 权限页点"代表租户授予管理员同意"。
</details>

<details>
<summary><b>某账号过段时间显示"授权失效"</b></summary>
个人版 refresh_token 长期未使用(90 天)或被吊销会失效。在本地管理台先删除该账号再重新添加走一次设备码授权,然后 <code>account:sync</code>;或命令行同名 <code>account:add</code> 覆盖。Worker 日常会自动刷新并回写,正常使用不会触发。
</details>

<details>
<summary><b>Office 文档预览空白</b></summary>
Office 在线渲染对文件大小有限制(Excel 约 10MB);直链过期时刷新页面重取。任何预览失败都可点"下载查看"兜底。
</details>

<details>
<summary><b>哪些文件能在线预览?</b></summary>
docx/xlsx/pptx(微软渲染)、txt/markdown/代码文本、pdf、常见图片、mp4/webm 视频、mp3/flac 等音频;旧版 doc/xls/ppt 与未知格式显示"不支持在线预览,请下载后查看"。
</details>

<details>
<summary><b>管理台/账号数据安全吗?</b></summary>
线上 Worker 没有任何账号管理接口(外部访问 <code>/api/admin/*</code> 一律 404)——没有管理密码可暴破、没有管理 Cookie 可窃取。账号管理只发生在您本机(wrangler dev 仅绑定 127.0.0.1),凭据经 Cloudflare 认证连接加密写入 KV,访客与公网均无法接触。
</details>

<details>
<summary><b>忘记本地管理密码?</b></summary>
直接改 worker/.dev.vars 里的 ADMIN_PASSWORD,重启 dev:worker 即可(仅存本机,不影响线上)。
</details>

<details>
<summary><b>完全免费吗?</b></summary>
是:Cloudflare Workers 免费 10 万请求/天、KV 免费 10 万读/天;下载流量走 OneDrive 直链不占 Cloudflare 额度;Azure 应用注册免费。
</details>

## 参与开发(多 Agent)

- **必读**:[plan.md](plan.md)(计划与模块认领表)+ [AGENTS.md](AGENTS.md)(开发规范)
- 契约:[docs/api.md](docs/api.md);架构:[docs/架构.md](docs/架构.md)
- 铁律:**一切代码经 PR 进 main,禁止直推**;不提交任何密钥;视觉契约 `endfield × maximal` 不可擅改

## 技术栈

React 18 · Vite · TypeScript · Hono(Worker 路由) · ark-ui(endfield × maximal) · Cloudflare Workers + KV · Microsoft Graph v1.0 · vitest
