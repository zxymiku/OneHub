import { Hono } from "hono";
import type { AppEnv, SafeAccount } from "../types";
import { listAccountIds, getAccount, toSafeAccount } from "../config/registry";

export const accountsRoutes = new Hono<AppEnv>();

/** 账号列表, 仅暴露 id/展示名/类型/状态, 绝不含凭据(契约 docs/api.md §3) */
accountsRoutes.get("/accounts", async (c) => {
  const ids = await listAccountIds(c.env.ACCOUNTS);
  const accounts: SafeAccount[] = [];
  for (const id of ids) {
    const record = await getAccount(c.env.ACCOUNTS, id);
    if (record) accounts.push(toSafeAccount(record));
  }
  return c.json({ accounts });
});
