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

## 9. Worker 环境绑定(wrangler.jsonc)

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
