import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import type { Env } from "../src/types";
import { MockKV, installFetch, parseBody } from "./mocks";

function makeEnv(opts?: { adminPassword?: string; gateSecret?: string }): {
  env: Env;
  accountsKv: MockKV;
  gateKv: MockKV;
} {
  const accountsKv = new MockKV();
  const gateKv = new MockKV();
  const env = {
    ACCOUNTS: accountsKv as unknown as KVNamespace,
    GATE: gateKv as unknown as KVNamespace,
    ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher,
    ADMIN_PASSWORD: opts?.adminPassword,
    GATE_SECRET: opts?.gateSecret,
  } as Env;
  return { env, accountsKv, gateKv };
}

function login(env: Env, password = "admin-pass"): Response | Promise<Response> {
  return app.request(
    "/api/admin/auth",
    { method: "POST", body: JSON.stringify({ password }), headers: { "content-type": "application/json" } },
    env,
  );
}

async function loginAndSeed(env: Env): Promise<string> {
  const res = await login(env);
  expect(res.status).toBe(200);
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("管理台开关与登录", () => {
  it("未设置 ADMIN_PASSWORD → status enabled:false, 受保护端点 403 ADMIN_DISABLED", async () => {
    const { env } = makeEnv();
    const status = await app.request("/api/admin/status", undefined, env);
    expect(await status.json()).toEqual({ enabled: false, unlocked: false });
    const res = await app.request("/api/admin/accounts", undefined, env);
    expect(res.status).toBe(403);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("ADMIN_DISABLED");
  });

  it("错误密码 5 次 → 第 6 次 429; 正确密码 → Cookie; 携带 Cookie 可访问", async () => {
    const { env } = makeEnv({ adminPassword: "admin-pass", gateSecret: "sec" });
    for (let i = 0; i < 5; i += 1) {
      const res = await login(env, "bad");
      expect(res.status).toBe(401);
    }
    const limited = await login(env, "admin-pass");
    expect(limited.status).toBe(429);
  });

  it("正确密码登录后可访问管理列表, Cookie 有效期 2 小时", async () => {
    const { env } = makeEnv({ adminPassword: "admin-pass", gateSecret: "sec" });
    const ok = await login(env);
    const setCookie = ok.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("onehub_admin=");
    expect(setCookie).toContain("Max-Age=7200");
    const cookie = setCookie.split(";")[0]!;
    const list = await app.request("/api/admin/accounts", { headers: { cookie } }, env);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ accounts: [] });
  });

  it("无 GATE_SECRET 时登录报配置错误", async () => {
    const { env } = makeEnv({ adminPassword: "admin-pass" });
    const res = await login(env);
    expect(res.status).toBe(500);
  });
});

describe("企业版表单添加(§8.2)", () => {
  const form = {
    name: "账号2",
    tenantId: "tenant-x",
    clientId: "cid",
    clientSecret: "cs",
    upn: "a@t.onmicrosoft.com",
  };

  it("凭据无效 → 409 VALIDATION_FAILED 且不写 KV", async () => {
    const { env, accountsKv } = makeEnv({ adminPassword: "admin-pass", gateSecret: "sec" });
    const cookie = await loginAndSeed(env);
    installFetch([
      (url) =>
        url.includes("login.microsoftonline.com")
          ? Response.json({ error: "invalid_client" }, { status: 400 })
          : undefined,
    ]);
    const res = await app.request(
      "/api/admin/accounts/business",
      { method: "POST", body: JSON.stringify(form), headers: { "content-type": "application/json", cookie } },
      env,
    );
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(accountsKv.dump())).toHaveLength(0);
  });

  it("凭据有效 → 201 并写入账号(凭据仅入 KV, 不入响应)", async () => {
    const { env, accountsKv } = makeEnv({ adminPassword: "admin-pass", gateSecret: "sec" });
    const cookie = await loginAndSeed(env);
    installFetch([
      (url, init) => {
        if (!url.includes("login.microsoftonline.com")) return undefined;
        expect(parseBody(init).get("grant_type")).toBe("client_credentials");
        return Response.json({ access_token: "at", expires_in: 3600 });
      },
      (url) => {
        if (!url.includes("/users/a%40t.onmicrosoft.com/drive")) return undefined;
        return Response.json({ id: "drive-1" });
      },
    ]);
    const res = await app.request(
      "/api/admin/accounts/business",
      { method: "POST", body: JSON.stringify(form), headers: { "content-type": "application/json", cookie } },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { account: Record<string, unknown> };
    expect(body.account).toEqual({ id: expect.any(String), name: "账号2", type: "business", status: "active" });
    const stored = JSON.parse(accountsKv.dump()["accounts:index"]!) as string[];
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(accountsKv.dump())).toContain("cs"); // 凭据在 KV(服务端), 而响应里没有
  });

  it("重名 → 409 DUPLICATE_NAME", async () => {
    const { env, accountsKv } = makeEnv({ adminPassword: "admin-pass", gateSecret: "sec" });
    const cookie = await loginAndSeed(env);
    accountsKv.seed({
      "accounts:index": JSON.stringify(["x1"]),
      "account:x1": JSON.stringify({ id: "x1", name: "账号2", type: "business", status: "active", createdAt: "" }),
    });
    installFetch([]);
    const res = await app.request(
      "/api/admin/accounts/business",
      { method: "POST", body: JSON.stringify(form), headers: { "content-type": "application/json", cookie } },
      env,
    );
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("DUPLICATE_NAME");
  });
});

describe("个人版设备码流程(§8.3)", () => {
  const startBody = { name: "一号机", clientId: "cid-personal" };

  it("start → 返回 userCode/verificationUri, device_code 留在服务端", async () => {
    const { env, accountsKv } = makeEnv({ adminPassword: "admin-pass", gateSecret: "sec" });
    const cookie = await loginAndSeed(env);
    installFetch([
      (url, init) => {
        if (!url.includes("/devicecode")) return undefined;
        expect(parseBody(init).get("client_id")).toBe("cid-personal");
        return Response.json({
          device_code: "DC-1",
          user_code: "ABC123456",
          verification_uri: "https://microsoft.com/devicelogin",
          expires_in: 900,
          interval: 5,
        });
      },
    ]);
    const res = await app.request(
      "/api/admin/accounts/personal/start",
      { method: "POST", body: JSON.stringify(startBody), headers: { "content-type": "application/json", cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessionId: string; userCode: string };
    expect(body.userCode).toBe("ABC123456");
    const dump = JSON.stringify(accountsKv.dump());
    expect(dump).toContain("DC-1");
    expect(JSON.stringify(body)).not.toContain("DC-1");
  });

  it("poll: pending → ok(写入账号+清理 pending) → 再次 poll 变 expired", async () => {
    const { env, accountsKv } = makeEnv({ adminPassword: "admin-pass", gateSecret: "sec" });
    const cookie = await loginAndSeed(env);
    let pollCount = 0;
    installFetch([
      (url) => {
        if (!url.includes("/devicecode")) return undefined;
        return Response.json({
          device_code: "DC-1",
          user_code: "ABC123456",
          verification_uri: "https://microsoft.com/devicelogin",
          expires_in: 900,
          interval: 5,
        });
      },
      (url) => {
        if (!url.includes("consumers/oauth2/v2.0/token")) return undefined;
        pollCount += 1;
        if (pollCount === 1) return Response.json({ error: "authorization_pending" }, { status: 400 });
        return Response.json({ access_token: "at", refresh_token: "rt-new", expires_in: 3600 });
      },
      (url) => {
        if (!url.includes("/me/drive")) return undefined;
        return Response.json({ id: "drive-p1" });
      },
    ]);
    const start = await app.request(
      "/api/admin/accounts/personal/start",
      { method: "POST", body: JSON.stringify(startBody), headers: { "content-type": "application/json", cookie } },
      env,
    );
    const { sessionId } = (await start.json()) as { sessionId: string };

    const pollUrl = {
      method: "POST",
      body: JSON.stringify({ sessionId }),
      headers: { "content-type": "application/json", cookie },
    };
    const first = await app.request("/api/admin/accounts/personal/poll", pollUrl, env);
    expect(await first.json()).toEqual({ status: "pending" });

    const second = await app.request("/api/admin/accounts/personal/poll", pollUrl, env);
    const secondBody = (await second.json()) as { status: string; account?: { name: string } };
    expect(secondBody.status).toBe("ok");
    expect(secondBody.account?.name).toBe("一号机");

    expect((JSON.parse(accountsKv.dump()["accounts:index"]!) as string[])).toHaveLength(1);
    const expired = await app.request("/api/admin/accounts/personal/poll", pollUrl, env);
    expect(await expired.json()).toEqual({ status: "expired" });
  });
});

describe("重命名与删除(§8.1)", () => {
  async function seedWithCookie(env: Env, cookie: string): Promise<void> {
    // 通过 business 流程造一个账号
    installFetch([
      (url) =>
        url.includes("login.microsoftonline.com")
          ? Response.json({ access_token: "at", expires_in: 3600 })
          : undefined,
      (url) => (url.includes("/drive") ? Response.json({ id: "drive-1" }) : undefined),
    ]);
    const res = await app.request(
      "/api/admin/accounts/business",
      {
        method: "POST",
        body: JSON.stringify({ name: "旧名", tenantId: "t", clientId: "c", clientSecret: "s", upn: "u@t.x" }),
        headers: { "content-type": "application/json", cookie },
      },
      env,
    );
    expect(res.status).toBe(201);
  }

  it("PUT 重命名; 重名拒绝; DELETE 移除并清理 token 缓存", async () => {
    const { env, accountsKv } = makeEnv({ adminPassword: "admin-pass", gateSecret: "sec" });
    const cookie = await loginAndSeed(env);
    await seedWithCookie(env, cookie);
    const id = (JSON.parse(accountsKv.dump()["accounts:index"]!) as string[])[0]!;

    const rename = await app.request(
      `/api/admin/accounts/${id}`,
      { method: "PUT", body: JSON.stringify({ name: "新名" }), headers: { "content-type": "application/json", cookie } },
      env,
    );
    expect(rename.status).toBe(200);
    expect(JSON.parse(accountsKv.dump()[`account:${id}`]!).name).toBe("新名");

    const dup = await app.request(
      `/api/admin/accounts/${id}`,
      { method: "PUT", body: JSON.stringify({ name: "新名" }), headers: { "content-type": "application/json", cookie } },
      env,
    );
    expect(dup.status).toBe(409);

    const del = await app.request(`/api/admin/accounts/${id}`, { method: "DELETE", headers: { cookie } }, env);
    expect(del.status).toBe(200);
    expect(accountsKv.dump()["accounts:index"]).toBe("[]");
    expect(accountsKv.dump()[`account:${id}`]).toBeUndefined();
  });
});
