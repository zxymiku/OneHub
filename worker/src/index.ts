import { Hono } from "hono";
import type { AppEnv } from "./types";
import { AuthInvalidError, GraphClientError, UpstreamError, jsonError } from "./lib/http";
import { gateRequired, requestUnlocked } from "./auth/gate";
import { healthRoutes } from "./routes/health";
import { gateRoutes } from "./routes/gate";
import { accountsRoutes } from "./routes/accounts";
import { accountRoutes } from "./routes/account";

const app = new Hono<AppEnv>();

const api = new Hono<AppEnv>();

/** 密码门: 除健康检查与门端点外全部要求有效 Cookie(docs/api.md §0)。
 * 中间件必须先于路由注册才能包裹它们 */
api.use("*", async (c, next) => {
  const path = c.req.path;
  const isOpen = path === "/api/health" || path.startsWith("/api/gate");
  if (!isOpen && gateRequired(c.env) && !(await requestUnlocked(c.env, c.req.raw))) {
    return jsonError(c, 401, "GATE_REQUIRED", "需要输入访问密码");
  }
  await next();
});

api.route("/", healthRoutes);
api.route("/", gateRoutes);
api.route("/", accountsRoutes);
api.route("/", accountRoutes);

/** 统一错误 → 契约错误结构 */
api.onError((err, c) => {
  if (err instanceof AuthInvalidError) {
    return jsonError(c, 409, "ACCOUNT_INVALID", err.message);
  }
  if (err instanceof GraphClientError) {
    return jsonError(c, err.status, err.code, err.message);
  }
  if (err instanceof UpstreamError) {
    return jsonError(c, 502, "GRAPH_UPSTREAM", err.message);
  }
  console.error(`${new Date().toISOString()} unhandled:`, err);
  return jsonError(c, 500, "INTERNAL", "服务内部错误, 请稍后再试");
});

app.route("/api", api);

/** 兜底: run_worker_first 只放行 /api/*, 此分支仅在资产配置缺失时兜住 */
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
