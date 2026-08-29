import { Hono } from "hono";
import type { AppEnv } from "../types";
import { jsonError } from "../lib/http";
import {
  clearGateCookie,
  gateCookie,
  gateRequired,
  issueCookieValue,
  rateLimitAllow,
  rateLimitRecordFailure,
  rateLimitReset,
  requestUnlocked,
  verifyPassword,
} from "../auth/gate";

export const gateRoutes = new Hono<AppEnv>();

/** 密码门状态(契约 docs/api.md §2) */
gateRoutes.get("/gate/status", async (c) => {
  return c.json({
    required: gateRequired(c.env),
    unlocked: await requestUnlocked(c.env, c.req.raw),
  });
});

gateRoutes.post("/gate/verify", async (c) => {
  if (!gateRequired(c.env)) {
    return c.json({ ok: true });
  }
  if (!c.env.GATE_SECRET) {
    return jsonError(c, 500, "CONFIG_ERROR", "服务端设置了访问密码但缺少 GATE_SECRET, 请联系部署者");
  }
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await rateLimitAllow(c.env, ip))) {
    return jsonError(c, 429, "GATE_RATELIMITED", "尝试过于频繁, 请 10 分钟后再试");
  }

  const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
  const ok = typeof body.password === "string" && (await verifyPassword(c.env, body.password));
  if (!ok) {
    await rateLimitRecordFailure(c.env, ip);
    return jsonError(c, 401, "GATE_WRONG", "访问密码不正确");
  }

  await rateLimitReset(c.env, ip);
  c.header("set-cookie", gateCookie(await issueCookieValue(c.env)));
  return c.json({ ok: true });
});

/** 登出: 清除门 Cookie */
gateRoutes.delete("/gate/verify", (c) => {
  c.header("set-cookie", clearGateCookie());
  return c.json({ ok: true });
});
