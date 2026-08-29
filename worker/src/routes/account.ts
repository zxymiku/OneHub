import { Hono } from "hono";
import type { AccountRecord, AppEnv, FileMetaDTO } from "../types";
import { getAccount, markAccountInvalid } from "../config/registry";
import { getItem, listChildren, normalizePath } from "../onedrive/graph";
import { jsonError } from "../lib/http";

/** 单账号资源路由: /api/accounts/:id/*(契约 docs/api.md §4-7) */
export const accountRoutes = new Hono<AppEnv>();

accountRoutes.use("/accounts/:id/*", async (c, next) => {
  const record = await getAccount(c.env.ACCOUNTS, c.req.param("id"));
  if (!record) {
    return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "账号不存在");
  }
  c.set("account", record);
  await next();
});

/** 目录列表 */
accountRoutes.get("/accounts/:id/items", async (c) => {
  const account = c.get("account")!;
  const normalized = normalizePath(c.req.query("path"));
  const items = await listChildren(c.env, account, normalized);
  return c.json({ path: normalized, items });
});

/** 文件元数据 + 临时直链 */
accountRoutes.get("/accounts/:id/file/:itemId", async (c) => {
  const account = c.get("account")!;
  const { meta, downloadUrl } = await getItem(c.env, account, c.req.param("itemId"));
  if (!downloadUrl) {
    return jsonError(c, 409, "NO_DOWNLOAD_URL", "该文件暂时无法获取下载链接");
  }
  const body: FileMetaDTO = { ...meta, downloadUrl };
  return c.json(body);
});

/** 下载: 现取直链后 302 推给用户(需求: 直接推 OneDrive 链接) */
accountRoutes.get("/accounts/:id/download/:itemId", async (c) => {
  const account = c.get("account")!;
  const { downloadUrl } = await getItem(c.env, account, c.req.param("itemId"));
  if (!downloadUrl) {
    return jsonError(c, 409, "NO_DOWNLOAD_URL", "该文件暂时无法获取下载链接");
  }
  return c.redirect(downloadUrl, 302);
});

/** 小文本代理(预览用): ≤2MB, 规避浏览器 CORS(契约 docs/api.md §7) */
accountRoutes.get("/accounts/:id/raw/:itemId", async (c) => {
  const RAW_MAX_BYTES = 2 * 1024 * 1024;
  const account = c.get("account")!;
  const { meta, downloadUrl } = await getItem(c.env, account, c.req.param("itemId"));
  if (!downloadUrl) {
    return jsonError(c, 409, "NO_DOWNLOAD_URL", "该文件暂时无法获取下载链接");
  }
  if (meta.size !== null && meta.size > RAW_MAX_BYTES) {
    return jsonError(c, 413, "TOO_LARGE", "文件超过 2MB, 不支持在线读取");
  }
  const upstream = await fetch(downloadUrl);
  if (!upstream.ok || !upstream.body) {
    return jsonError(c, 502, "GRAPH_UPSTREAM", "文件内容获取失败, 请稍后再试");
  }
  return c.newResponse(upstream.body, 200, {
    "content-type": meta.mimeType ?? "application/octet-stream",
    "cache-control": "no-store",
  });
});

/** AuthInvalidError 到达 onError 前在此标记账号失效, 前端据此提示重新授权 */
accountRoutes.onError(async (err, c) => {
  if (err.name === "AuthInvalidError") {
    const account = c.get("account") as AccountRecord | undefined;
    if (account) await markAccountInvalid(c.env.ACCOUNTS, account);
  }
  throw err;
});
