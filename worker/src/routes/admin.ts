import { Hono } from "hono";
import type { AccountRecord, AppEnv } from "../types";
import { getAccount, putAccount, removeAccount } from "../config/registry";
import { jsonError } from "../lib/http";
import {
  adminCookie,
  adminEnabled,
  adminRateLimitAllow,
  adminRateLimitRecordFailure,
  adminRateLimitReset,
  adminRequestUnlocked,
  clearAdminCookie,
  issueAdminCookieValue,
  verifyAdminPassword,
} from "../admin/gate";
import {
  FlowError,
  addBusinessAccount,
  assertNameAvailable,
  pollPersonalFlow,
  startPersonalFlow,
} from "../admin/flows";

/** 网页管理台路由(docs/api.md §8)。默认关闭: 未设 ADMIN_PASSWORD 时除 status 外全部 403 */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.get("/admin/status", async (c) => {
  return c.json({
    enabled: adminEnabled(c.env),
    unlocked: await adminRequestUnlocked(c.env, c.req.raw),
  });
});

adminRoutes.post("/admin/auth", async (c) => {
  if (!adminEnabled(c.env)) {
    return jsonError(c, 403, "ADMIN_DISABLED", "管理台未启用: 请在 Worker 上设置 ADMIN_PASSWORD");
  }
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await adminRateLimitAllow(c.env, ip))) {
    return jsonError(c, 429, "ADMIN_RATELIMITED", "尝试过于频繁, 请 10 分钟后再试");
  }
  const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
  const ok = typeof body.password === "string" && (await verifyAdminPassword(c.env, body.password));
  if (!ok) {
    await adminRateLimitRecordFailure(c.env, ip);
    return jsonError(c, 401, "ADMIN_WRONG", "管理密码不正确");
  }
  await adminRateLimitReset(c.env, ip);
  c.header("set-cookie", adminCookie(await issueAdminCookieValue(c.env)));
  return c.json({ ok: true });
});

adminRoutes.delete("/admin/auth", (c) => {
  c.header("set-cookie", clearAdminCookie());
  return c.json({ ok: true });
});

/** 管理保护: 以下端点全部要求有效管理 Cookie */
adminRoutes.use("/admin/*", async (c, next) => {
  if (!adminEnabled(c.env)) {
    return jsonError(c, 403, "ADMIN_DISABLED", "管理台未启用: 请在 Worker 上设置 ADMIN_PASSWORD");
  }
  if (!(await adminRequestUnlocked(c.env, c.req.raw))) {
    return jsonError(c, 401, "ADMIN_REQUIRED", "请先输入管理密码");
  }
  await next();
});

/** 脱敏账号列表(契约 §8.1) */
adminRoutes.get("/admin/accounts", async (c) => {
  const { listAccountIds } = await import("../config/registry");
  const ids = await listAccountIds(c.env.ACCOUNTS);
  const accounts = [];
  for (const id of ids) {
    const record = await getAccount(c.env.ACCOUNTS, id);
    if (!record) continue;
    accounts.push(maskAccount(record));
  }
  return c.json({ accounts });
});

function maskAccount(record: AccountRecord) {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    status: record.status,
    upn: record.upn ?? null,
    hasSecret: Boolean(record.clientSecret || record.refreshToken),
    driveId: record.driveId ?? null,
    createdAt: record.createdAt,
  };
}

adminRoutes.put("/admin/accounts/:id", async (c) => {
  const record = await getAccount(c.env.ACCOUNTS, c.req.param("id"));
  if (!record) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "账号不存在");
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return jsonError(c, 400, "BAD_NAME", "展示名不能为空");
  }
  const name = body.name.trim();
  await assertNameAvailable(c.env.ACCOUNTS, name);
  record.name = name;
  await putAccount(c.env.ACCOUNTS, record);
  return c.json({ ok: true });
});

adminRoutes.delete("/admin/accounts/:id", async (c) => {
  const removed = await removeAccount(c.env.ACCOUNTS, c.req.param("id"));
  if (!removed) return jsonError(c, 404, "ACCOUNT_NOT_FOUND", "账号不存在");
  return c.json({ ok: true });
});

adminRoutes.post("/admin/accounts/business", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const required = ["name", "tenantId", "clientId", "clientSecret", "upn"] as const;
  const values: Record<string, string> = {};
  for (const key of required) {
    const value = body[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      return jsonError(c, 400, "BAD_INPUT", `缺少必填项: ${key}`);
    }
    values[key] = value.trim();
  }
  await assertNameAvailable(c.env.ACCOUNTS, values.name!);
  try {
    const account = await addBusinessAccount(c.env.ACCOUNTS, {
      name: values.name!,
      tenantId: values.tenantId!,
      clientId: values.clientId!,
      clientSecret: values.clientSecret!,
      upn: values.upn!,
    });
    return c.json({ account }, 201);
  } catch (err) {
    if (err instanceof FlowError) {
      return jsonError(c, err.status, err.code, err.message);
    }
    throw err;
  }
});

adminRoutes.post("/admin/accounts/personal/start", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  if (!name || !clientId) {
    return jsonError(c, 400, "BAD_INPUT", "缺少必填项: 展示名 / 应用程序(客户端) ID");
  }
  await assertNameAvailable(c.env.ACCOUNTS, name);
  try {
    const start = await startPersonalFlow(c.env.ACCOUNTS, name, clientId);
    return c.json(start);
  } catch (err) {
    if (err instanceof FlowError) {
      return jsonError(c, err.status, err.code, err.message);
    }
    throw err;
  }
});

adminRoutes.post("/admin/accounts/personal/poll", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { sessionId?: unknown };
  if (typeof body.sessionId !== "string") {
    return jsonError(c, 400, "BAD_INPUT", "缺少 sessionId");
  }
  try {
    return c.json(await pollPersonalFlow(c.env, body.sessionId));
  } catch (err) {
    if (err instanceof FlowError) {
      return jsonError(c, err.status, err.code, err.message);
    }
    throw err;
  }
});

adminRoutes.onError((err, c) => {
  if (err instanceof FlowError) {
    return jsonError(c, err.status, err.code, err.message);
  }
  console.error(`${new Date().toISOString()} admin error:`, err);
  return jsonError(c, 500, "INTERNAL", "管理操作失败, 请稍后再试");
});
