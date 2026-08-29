# OneHub API 契约(v1)

> 前后端/多 agent 的**唯一接口契约**。Worker 实现与前端调用都必须与本文件一致;要改先改这里(见 AGENTS.md §5)。
>
> 约定:所有响应为 `application/json; charset=utf-8`(除 `raw`);路径前缀 `/api`;时间一律 ISO 8601 UTC;错误统一结构 `{"error":{"code":"<机器码>","message":"<中文用户可读>"}}`。

## 0. 通用行为

- **密码门**:若部署时设置了 `ACCESS_PASSWORD`,除 `GET /api/health`、`GET /api/gate/*` 外的所有端点要求有效门 Cookie,否则 `401 {"error":{"code":"GATE_REQUIRED",...}}`;未设置密码时全站放行。
- **账号失效**:账号授权失效时,`/api/accounts` 中该账号 `status:"invalid"`;对其调用资源端点返回 `409 {"error":{"code":"ACCOUNT_INVALID",...}}`,前端引导重新授权而不是展示堆栈。
- 直链时效:`downloadUrl` 为 Graph 预授权临时链接(约 1 小时),前端每次预览/下载前现取,不得长期缓存。

## 1. 存活检查

```
GET /api/health
→ 200 {"ok":true}
```

## 2. 密码门

```
GET /api/gate/status
→ 200 {"required":true,"unlocked":false}
   // required: 是否配置了 ACCESS_PASSWORD
   // unlocked: 当前请求 Cookie 是否已通过

POST /api/gate/verify
请求 {"password":"..."}
→ 200 {"ok":true}
  响应头 Set-Cookie: onehub_gate=<payload>.<hmac>; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/
→ 401 {"error":{"code":"GATE_WRONG","message":"访问密码不正确"}}
  // 连续失败触发限速: 429 {"error":{"code":"GATE_RATELIMITED","message":"尝试过于频繁,请稍后再试"}}
```

Cookie 校验失败(伪造/过期)按未解锁处理。登出可选:`DELETE /api/gate/verify` 清除 Cookie → `{"ok":true}`。

## 3. 账号

```
GET /api/accounts
→ 200 {"accounts":[
    {"id":"a1b2","name":"一号机","type":"personal","status":"active"},
    {"id":"c3d4","name":"账号2","type":"business","status":"active"}
  ]}
// 绝不返回任何凭据字段;顺序按 accounts:index
```

## 4. 目录浏览

```
GET /api/accounts/:id/items?path=/相册/2026
// path 以 / 开头可省略;空或缺省 = 根目录
→ 200 {
    "path": "/相册/2026",
    "items": [
      {"id":"01ABC...","name":"报告.docx","size":48312,"isFolder":false,
       "lastModifiedDateTime":"2026-08-01T12:00:00Z","mimeType":null},
      {"id":"01XYZ...","name":"子目录","size":null,"isFolder":true,
       "lastModifiedDateTime":"2026-07-20T09:00:00Z","mimeType":null}
    ]
  }
// items 顺序: 文件夹在前、名称升序(前端可再排序)
// Graph 分页(@odata.nextLink)必须在 Worker 侧聚合完毕后一次返回(上限 200 项/页拉取直到取完, 硬上限 5000 项)
```

## 5. 文件元数据与直链

```
GET /api/accounts/:id/file/:itemId
→ 200 {"id":"01ABC...","name":"报告.docx","size":48312,
       "lastModifiedDateTime":"2026-08-01T12:00:00Z",
       "mimeType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
       "downloadUrl":"https://...sharepoint.com/...tempauth..."}
// downloadUrl 来自 Graph @microsoft.graph.downloadUrl
```

## 6. 下载(需求: 直接推 OneDrive 链接)

```
GET /api/accounts/:id/download/:itemId
→ 302 Location: <downloadUrl>
// Worker 现取现跳, 不缓存; 取直链失败 → 502 {"error":{"code":"GRAPH_UPSTREAM",...}}
```

## 7. 文本代理(预览用)

```
GET /api/accounts/:id/raw/:itemId
→ 200 <原始字节流, Content-Type 透传 Graph mimeType 或 application/octet-stream>
→ 413 {"error":{"code":"TOO_LARGE","message":"文件超过 2MB, 不支持在线读取"}}
// 仅用于 ≤2MB 的文本类文件; 实现为流式转发并统计字节数截断
```

## 8. Graph 映射(实现参考,非对外契约)

| 场景 | personal | business |
|---|---|---|
| 取 token | `POST login.microsoftonline.com/consumers/oauth2/v2.0/token` `grant_type=refresh_token`(响应的新 refresh_token 回写 KV) | `POST login.microsoftonline.com/{tenantId}/oauth2/v2.0/token` `grant_type=client_credentials` `scope=https://graph.microsoft.com/.default` |
| drive | `/v1.0/me/drive` | `/v1.0/users/{upn}/drive` |
| 列目录 | `/v1.0/me/drive/root:{path}:/children` | `/v1.0/users/{upn}/drive/root:{path}:/children` |
| 元数据 | `/v1.0/me/drive/items/{id}?$select=...` | `/v1.0/users/{upn}/drive/items/{id}?$select=...` |

`$select=id,name,size,lastModifiedDateTime,folder,file,content.downloadUrl` 并附加 `@microsoft.graph.downloadUrl`。token 缓存键 `token:<id>`(KV `expirationTtl=3300` 秒)。Graph 401 时强制刷新一次重试,再失败置账号 `status=invalid`。

## 8. 管理台(可选,网页添加账号)

> **默认关闭**:仅当 Worker 设置了 `ADMIN_PASSWORD` secret 时启用;未设置时所有 `/api/admin/*` 返回 `403 {"error":{"code":"ADMIN_DISABLED"}}`。
> 管理台与访客密码门相互独立:独立的管理密码、独立的签名 Cookie(`onehub_admin`)、独立的按 IP 限速。访客门状态不影响管理台。
> Cookie 有效期 2 小时(短于访客门);所有端点要求有效管理 Cookie,除 `GET /api/admin/status` 与 `POST /api/admin/auth`。

```
GET /api/admin/status
→ 200 {"enabled":true,"unlocked":false}
   // enabled: 是否配置了 ADMIN_PASSWORD(公开信息, 便于前端决定是否展示入口)
   // unlocked: 当前请求是否已通过管理验证

POST /api/admin/auth
请求 {"password":"..."}
→ 200 {"ok":true},Set-Cookie: onehub_admin=<payload>.<hmac>; HttpOnly; Secure; SameSite=Lax; Max-Age=7200
→ 401 {"error":{"code":"ADMIN_WRONG","message":"管理密码不正确"}}
→ 429 {"error":{"code":"ADMIN_RATELIMITED","message":"尝试过于频繁, 请 10 分钟后再试"}}  // 5 次/10 分钟/IP, GATE KV 计数

DELETE /api/admin/auth
→ 200 {"ok":true}  // 清除管理 Cookie(登出)
```

### 8.1 账号管理

```
GET /api/admin/accounts
→ 200 {"accounts":[{...SafeAccount, "upn": string|null, "hasSecret": boolean, "driveId": string|null, "createdAt": string}]}
   // 脱敏: 绝不返回 clientSecret/refreshToken/clientId 原文, hasSecret 仅表示"已配置"

PUT /api/admin/accounts/:id
请求 {"name":"新展示名"}
→ 200 {"ok":true}   // 重命名(需求 1 的展示名调整)

DELETE /api/admin/accounts/:id
→ 200 {"ok":true}   // 移除账号并清理其 token 缓存
```

### 8.2 添加企业版账号(表单直填)

```
POST /api/admin/accounts/business
请求 {"name":"账号2","tenantId":"...","clientId":"...","clientSecret":"...","upn":"user@t.onmicrosoft.com"}
→ 201 {"account":{...SafeAccount}}
   // Worker 先真实验证 client_credentials 并解析 driveId, 任一步失败:
   → 409 {"error":{"code":"VALIDATION_FAILED","message":"<中文原因>"}}   // 不写脏数据
→ 409 {"error":{"code":"DUPLICATE_NAME","message":"已有同名账号"}}       // 同名不覆盖(网页端显式报错, 与 CLI 同名覆盖行为不同)
```

### 8.3 添加个人版账号(设备码流程可视化)

```
POST /api/admin/accounts/personal/start
请求 {"name":"一号机","clientId":"..."}
→ 200 {"sessionId":"<短id>","userCode":"ABC123456","verificationUri":"https://microsoft.com/devicelogin","expiresIn":900}
   // device_code 保存在服务端 KV(pending:<sessionId>, TTL 900s), 不下发给浏览器

POST /api/admin/accounts/personal/poll
请求 {"sessionId":"..."}
→ 200 {"status":"pending"}                       // 用户尚未在微软页面完成授权
→ 200 {"status":"ok","account":{...SafeAccount}} // 授权完成: 换取并轮换 refresh_token, 解析 driveId, 写入 KV, 清理 pending
→ 200 {"status":"expired"}                       // 设备码过期, 前端提示重新开始
→ 409 {"error":{"code":"AUTH_FAILED","message":"<微软拒绝原因的中文摘要>"}}
```

### 8.4 Worker 环境绑定增补(wrangler.jsonc)

```jsonc
// secrets: ADMIN_PASSWORD(设置即启用管理台), GATE_SECRET(复用为管理 Cookie HMAC 密钥)
```


```jsonc
{
  "name": "onehub",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-01",
  "assets": { "directory": "../frontend/dist", "binding": "ASSETS", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] },
  "kv_namespaces": [
    { "binding": "ACCOUNTS", "id": "<KV_NAMESPACE_ID>" },
    { "binding": "GATE", "id": "<KV_NAMESPACE_ID_2>" }
  ],
  "vars": { "ACCESS_PASSWORD": "" }   // 留空=公开; 生产建议用 `wrangler secret put` 覆盖
  // secrets: ACCESS_PASSWORD(可选), GATE_SECRET(设置密码时必填, HMAC 密钥)
}
```
