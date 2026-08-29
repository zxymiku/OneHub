# OneHub 项目开发计划(plan.md)

> **本文件是多 agent 协作的总契约**。任何 agent 参与开发前必读本文 + `AGENTS.md`,认领模块前先看 [§7 模块认领表](#七模块认领表),确认对应 PR 未被认领/合并。
> 需求来源:`总需求.md`。架构与 API 细节契约:`docs/api.md`。部署教程:`README.md`。

---

## 一、项目目标

基于 **GitHub + Cloudflare 全免费资源**搭建多 OneDrive 网盘聚合展示站:

1. 支持多个 OneDrive 账号同时展示,每个账号可自定义展示名(如"一号机""账号2"),点击进入对应账号资源;
2. 下载:直接把 OneDrive 临时下载直链推送给用户;
3. 在线预览:word/ppt/excel/txt/markdown/pdf/mp4/音频/图片等;不支持的类型显示"**此文件类型不支持在线预览,请下载后查看**";
4. 不泄露账号信息(凭据全部留在服务端)。

## 二、已确认的技术决策(与需求方逐项确认过,不要擅改)

| 决策点 | 结论 |
|---|---|
| 账号类型 | 个人版 OneDrive 与 E5/E3/企业版(OneDrive for Business)混合接入 |
| 认证方案 | **个人版**:OAuth 刷新令牌(公共客户端,设备码流授权一次,refresh_token 轮换后回写 KV);**E5/E3/企业版**:client credentials 应用密钥(application 权限 Files.Read.All + 管理员同意) |
| 前端栈 | React 18 + Vite + TypeScript,组件化模块化 |
| 视觉契约 | **ark-ui `endfield` 风格族 × 4 级 `maximal` 极繁深度**(.skills/ark-ui-skill-main 技能包,见 §5) |
| 托管 | Cloudflare **Workers + 静态资产**(单 Worker 同托管前端与 API)+ **KV** |
| 访问控制 | 完全公开 + **可选站点密码**(环境变量开关,设置即启用) |
| Office 预览 | 微软官方 Office Online Viewer(view.officeapps.live.com);其余格式前端渲染 |
| 仓库流程 | gh CLI 建仓(OneHub,私有);**一切代码只经 PR 进 main**,需求方人工审查合并 |
| 账号管理 | 账号配置(展示名、凭据)存 KV,经 wrangler CLI 脚本增删改,不做在线管理页 |

## 三、总体架构

```
浏览器 (React SPA — ark-ui endfield × maximal)
   │ 只接触: 账号展示名、文件元数据、临时下载直链
   ▼
Cloudflare Worker(单入口,单域名)
   ├─ 静态资产: frontend/dist (SPA)
   └─ /api/* → 密码门(HMAC 签名 Cookie,可选)→ 路由模块
        ├─ onedrive/personal: refresh_token ⇄ access_token(轮换回写 KV)
        ├─ onedrive/business: client_credentials(缓存 access_token)
        └─ tokenCache: KV 缓存,TTL ≈ 55 分钟
   ▼
Microsoft Graph API v1.0
```

要点:

- Worker 同时服务静态页面与 API,前端路由为 SPA(`not_found_handling = single-page-application`);
- **所有** Graph 请求都在 Worker 侧发生,浏览器永不接触 token/clientSecret;
- 下载直链使用 Graph 的 `@microsoft.graph.downloadUrl`(预授权临时链接,约 1 小时过期,由 Worker 302 推给用户,满足"直接推 OneDrive 链接"需求);
- 小文本/Markdown 预览经 Worker 的 `raw` 代理读取(规避浏览器 CORS),上限 2MB;媒体/图片/PDF/Office Viewer 直接用直链(标签加载不受 CORS 限制)。

## 四、数据模型(Cloudflare KV)

KV 命名空间绑定名:`ACCOUNTS`(账号注册表 + 凭据 + token 缓存)、`GATE`(密码门限速)。键设计:

| Key | Value(JSON) | 说明 |
|---|---|---|
| `accounts:index` | `["a1b2","c3d4"]` | 账号 id 列表 |
| `account:<id>` | 见下 | 单账号完整配置(**含凭据,仅 Worker/脚本可见**) |
| `token:<id>` | `{accessToken, expiresAt}` | access_token 缓存,写 KV 时设 `expirationTtl` |
| `rl:<ip>` | 计数 | 密码门限速(短 TTL) |

`account:<id>` 结构:

```jsonc
{
  "id": "a1b2",                // 短随机 id,路由中的 :id
  "name": "一号机",             // 展示名(需求 1)
  "type": "personal",          // personal | business
  "status": "active",          // active | invalid(授权失效,前端提示重授权)
  "createdAt": "2026-08-29T00:00:00Z",
  // ---- personal 专属 ----
  "clientId": "<Azure 应用 client_id>",
  "refreshToken": "<刷新令牌,轮换后由 Worker 回写>",
  // ---- business 专属 ----
  "tenantId": "<租户 id>",
  "clientSecret": "<应用密钥>",
  "upn": "user@tenant.onmicrosoft.com",  // 目标用户,drive = /users/{upn}/drive
  // ---- 通用缓存 ----
  "driveId": "<首次解析后缓存>"
}
```

## 五、前端设计契约(ark-ui)

**契约声明(改任何前端代码前先复述一遍)**:family=`endfield`,depth=`maximal`。

- 技能包位置:`.skills/ark-ui-skill-main/`(不入库,.gitignore 已忽略)。实现前**必读** `references/design-language.md`、`references/depth-levels.md`、`references/recipes.md` 的 endfield 节;写 CSS/评审时再读 `references/frontend-evidence.md`。**不得复制任何鹰角版权资产**(logo/立绘/CDN 资源),只做 clean-room 风格重建。
- 调色板:ink `#191919`、paper `#f2f2f0`、signal 黄 `#fffa00`(只用于动作/选择标记)、state 绿 `#00ffa2`(只用于在线/验证状态);中性表面 ≥75% 构图;默认零圆角、1px 边线、2–4px 功能圆角。
- 字体:宽扁 condensed display + Space Grotesk 类技术无衬线正文;标题 `line-height .82–.95`,micro-label 字距 `.08em–.18em`。
- **maximal 深度要求**:逐屏定制构图但统一壳层语法;4–6 个连贯视觉层;仪表由状态驱动(路由/选择/加载态改变构图);区块转场编排为动效系统(区块揭示 500–900ms,交互 180–350ms);桌面/竖屏/短宽屏/`prefers-reduced-motion` 分别重导演;性能预算显式声明。**文件列表等密集屏按规范降为 complex 密度,不算违规**。
- family 与深度变量分离:根元素 `data-ark-theme="endfield" data-ark-depth="maximal"`,深度行为全部走 `[data-ark-depth=…]` CSS 变量。
- 质量底线(硬性):移动端响应式、可见键盘焦点(2px signal 描边)、尊重 `prefers-reduced-motion`、触控目标 ≥40×40px。
- 参考实现:`.skills/ark-ui-skill-main/assets/starter-vanilla/`(纯 HTML)与 `assets/react/`(React 组件 + css);token 参考 `assets/tokens/ark-ui.tokens.json`(按本项目命名重命名后使用)。

**frontend-design 流程**(`.skills/frontend-design/SKILL.md`):先产出 token 计划(Color/Type/Layout/Signature 四要素)→ 对照需求自审去模板化 → 确认后才开始写代码;文案用最终用户视角、按钮写确切动作;大胆只花在一处 signature。

## 六、页面与预览矩阵

页面:① 首页(Hero + 账号矩阵,展示名卡片点击进入);② 文件浏览页(面包屑/列表/排序/搜索/状态仪表);③ 预览面板;④ 密码门页(启用时);⑤ 404/错误态。

| 类型 | 扩展名 | 预览方案 |
|---|---|---|
| Word | docx | Office Online Viewer(iframe) |
| Excel | xlsx | Office Online Viewer(iframe) |
| PowerPoint | pptx | Office Online Viewer(iframe) |
| 旧版 Office | doc/xls/ppt | 不支持提示(微软 Viewer 不支持旧格式) |
| 纯文本 | txt/log/json/xml/csv/yaml 等 | `raw` 代理取文本 → `<pre>` 展示 |
| Markdown | md/markdown | `raw` 代理 → marked 渲染 + DOMPurify 消毒 + highlight.js |
| PDF | pdf | iframe 直链(浏览器内置查看器) |
| 图片 | png/jpg/jpeg/gif/webp/svg/bmp/avif | `<img>` 直链 |
| 视频 | mp4/webm/ogv(mov 视编码) | `<video controls>` 直链,编解码失败转不支持提示 |
| 音频 | mp3/wav/ogg/flac/m4a/aac | `<audio controls>` 直链 |
| 其他 | — | "**此文件类型不支持在线预览,请下载后查看**" + 下载按钮 |

类型判定集中在 `frontend/src/shared/fileTypes/`,必须配单元测试;Office Viewer 加载失败(文件过大等)也要落到下载引导。

## 七、模块认领表

**认领方式**:在本表"状态"列改为 `@<agent名> 进行中`,完成后改 `已提PR #N`。除下表范围外不要动其他模块目录;要改共享契约先在本文件提讨论。

| # | 分支名 | 目录范围 | 内容摘要 | 依赖 | 状态 |
|---|---|---|---|---|---|
| PR-1 | `docs/project-scaffold` | 根文档、docs/、.github/、脚手架配置 | 本计划、AGENTS.md、README 全链路教程、API 契约、CI/PR 模板、workspaces 骨架 | 无 | **本 PR** |
| PR-2 | `feat/worker-core` | `worker/` | Worker 全部后端:路由、Graph 客户端、双认证策略、token 缓存轮换、账号注册表、密码门端点;vitest 单测(mock Graph) | docs/api.md | 已提PR #2 |
| PR-3 | `feat/account-cli` | `scripts/` | 账号管理 CLI:add(个人版设备码流/企业版密钥验证并解析 driveId)、list、remove,经 wrangler 写 KV | docs/api.md §KV | 已提PR #3 |
| PR-4 | `feat/frontend-shell` | `frontend/` | Vite+React 脚手架、ark-ui endfield/maximal token 体系、应用壳(rail/dock/舞台分层)、首页账号矩阵、gate 状态检测跳转 | docs/api.md、§5 | 已提PR #4 |
| PR-5 | `feat/browse` | `frontend/src/features/browse` | 目录浏览:面包屑、列表(排序/搜索)、加载/错误/空态、状态仪表 | PR-4 | 待认领 |
| PR-6 | `feat/preview` | `frontend/src/features/preview` | 预览矩阵全量实现 + fileTypes 单测 + 不支持提示 + 下载按钮 | PR-5 | 待认领 |
| PR-7 | `feat/gate` | `frontend/src/features/gate` | 密码门 UI + verify 流程 + 失败限速提示 | PR-4(worker 端点已在 PR-2) | 待认领 |
| PR-8 | `chore/release` | 各处小改 | CI 完善、wrangler 部署核对、端到端走查清单(桌面+竖屏) | 全部 | 待认领 |

## 八、API 契约摘要(完整版见 docs/api.md,前后端以此为准)

| 方法与路径 | 说明 | 响应要点 |
|---|---|---|
| `GET /api/health` | 存活检查 | `{ok:true}` |
| `GET /api/gate/status` | 密码门状态 | `{required:boolean, unlocked:boolean}` |
| `POST /api/gate/verify` | 校验密码,设 HttpOnly HMAC Cookie | `{ok:true}` / 401 |
| `GET /api/accounts` | 账号列表(**绝不含凭据**) | `[{id,name,type,status}]` |
| `GET /api/accounts/:id/items?path=` | 列目录(Graph root:/path:/children,聚合分页) | `{path,items:[{id,name,size,isFolder,lastModifiedDateTime}]}` |
| `GET /api/accounts/:id/file/:itemId` | 单文件元数据 + 直链 | `{id,name,size,downloadUrl}` |
| `GET /api/accounts/:id/download/:itemId` | 下载 | **302 → downloadUrl** |
| `GET /api/accounts/:id/raw/:itemId` | 文本代理(≤2MB) | 原始字节流 |

错误统一:`{error:{code,message}}` + 合理 HTTP 状态码;账号授权失效时 `/api/accounts` 用 `status:"invalid"` 表达,前端展示"需重新授权"而不是报错堆栈。

## 九、开发流程与规范

- 规范全文见 `AGENTS.md`(分支命名、Conventional Commits、禁提交密钥、每 PR 必过 lint/typecheck/test/build/审计等)。摘要:**任何代码不得直推 main**;从 main(或依赖 PR 的分支)切功能分支 → 推送 → `gh pr create` → 需求方审查合并。
- 本地验证:`npm run lint / typecheck / test / build`;前端另跑 `node .skills/ark-ui-skill-main/scripts/audit-ark-ui.mjs <产物html>`;`npm run dev:worker` + `npm run dev:web` 手动走查主流程。
- 前端截图检查:桌面 1440×900 与竖屏 390×844 双宽度,检查裁剪/碰撞/焦点序/reduced-motion。

## 十、里程碑

- **M1(当前)**:文档+契约+脚手架(PR-1)
- **M2**:后端可用,CLI 可加真实账号(PR-2、PR-3)
- **M3**:前端四屏全部可用(PR-4~7)
- **M4**:CI/部署收尾,真实账号端到端验收(PR-8)

## 十一、已否决的备选方案(记录避免重复讨论)

- Pages + Functions:Cloudflare 已停止增强,选 Workers + 静态资产;
- 纯前端 JS 渲染 Office 文档:pptx 支持差、包体积大,选微软官方 Viewer;
- 在线账号管理页:多一个暴露面,选 KV + CLI 脚本;
- 所有账号统一 OAuth:企业版 client credentials 更稳(不依赖人工重授权),按账号类型分策略。
