import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";
import type { AccountRecord, Env } from "../src/types";
import {
  MockKV,
  PERSONAL_ACCOUNT,
  BUSINESS_ACCOUNT,
  childrenHandler,
  downloadContentHandler,
  graphErrorHandler,
  installFetch,
  itemHandler,
  seedAccounts,
  tokenErrorHandler,
  tokenHandler,
} from "./mocks";

function makeEnv(opts?: { password?: string; secret?: string }): {
  env: Env;
  accountsKv: MockKV;
  gateKv: MockKV;
} {
  const accountsKv = new MockKV();
  const gateKv = new MockKV();
  const env = {
    ACCOUNTS: accountsKv as unknown as KVNamespace,
    GATE: gateKv as unknown as KVNamespace,
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) } as unknown as Fetcher,
    ACCESS_PASSWORD: opts?.password,
    GATE_SECRET: opts?.secret,
  } as Env;
  return { env, accountsKv, gateKv };
}

function seedStandard(kv: MockKV): void {
  seedAccounts(kv, [PERSONAL_ACCOUNT, BUSINESS_ACCOUNT]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/health", () => {
  it("返回 ok", async () => {
    const { env } = makeEnv();
    const res = await app.request("/api/health", undefined, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/accounts", () => {
  it("仅暴露 id/name/type/status, 不泄漏任何凭据", async () => {
    const { env } = makeEnv();
    seedStandard(env.ACCOUNTS as unknown as MockKV);
    installFetch([]);
    const res = await app.request("/api/accounts", undefined, env);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("rt-old");
    expect(text).not.toContain("cs-secret");
    const body = JSON.parse(text) as { accounts: Array<Record<string, unknown>> };
    expect(body.accounts).toHaveLength(2);
    expect(body.accounts[0]).toEqual({ id: "p1", name: "一号机", type: "personal", status: "active" });
  });

  it("未配置密码时无需门 Cookie", async () => {
    const { env } = makeEnv();
    seedStandard(env.ACCOUNTS as unknown as MockKV);
    installFetch([]);
    const res = await app.request("/api/accounts", undefined, env);
    expect(res.status).toBe(200);
  });
});

describe("密码门", () => {
  const gated = { password: "pass-123", secret: "gate-secret" };

  it("未解锁时受保护端点返回 401 GATE_REQUIRED", async () => {
    const { env } = makeEnv(gated);
    seedStandard(env.ACCOUNTS as unknown as MockKV);
    installFetch([]);
    const res = await app.request("/api/accounts", undefined, env);
    expect(res.status).toBe(401);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("GATE_REQUIRED");
  });

  it("status 反映 required/unlocked", async () => {
    const { env } = makeEnv(gated);
    const res = await app.request("/api/gate/status", undefined, env);
    expect(await res.json()).toEqual({ required: true, unlocked: false });
  });

  it("错误密码 → 401; 连续 5 次后限速 429", async () => {
    const { env } = makeEnv(gated);
    installFetch([]);
    for (let i = 0; i < 5; i += 1) {
      const res = await app.request("/api/gate/verify", { method: "POST", body: JSON.stringify({ password: "bad" }), headers: { "content-type": "application/json" } }, env);
      expect(res.status).toBe(401);
    }
    const limited = await app.request("/api/gate/verify", { method: "POST", body: JSON.stringify({ password: "pass-123" }), headers: { "content-type": "application/json" } }, env);
    expect(limited.status).toBe(429);
  });

  it("正确密码 → 200 + 签名 Cookie, 后续请求放行", async () => {
    const { env } = makeEnv(gated);
    seedStandard(env.ACCOUNTS as unknown as MockKV);
    installFetch([]);
    const verify = await app.request("/api/gate/verify", { method: "POST", body: JSON.stringify({ password: "pass-123" }), headers: { "content-type": "application/json" } }, env);
    expect(verify.status).toBe(200);
    const setCookie = verify.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("onehub_gate=");
    expect(setCookie).toContain("HttpOnly");

    const cookie = setCookie.split(";")[0]!;
    const res = await app.request("/api/accounts", { headers: { cookie } }, env);
    expect(res.status).toBe(200);

    const status = await app.request("/api/gate/status", { headers: { cookie } }, env);
    expect(await status.json()).toEqual({ required: true, unlocked: true });
  });

  it("DELETE verify 清除 Cookie", async () => {
    const { env } = makeEnv(gated);
    const res = await app.request("/api/gate/verify", { method: "DELETE" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("GET /api/accounts/:id/items", () => {
  it("聚合 Graph 分页并归一化路径", async () => {
    const { env } = makeEnv();
    seedStandard(env.ACCOUNTS as unknown as MockKV);
    installFetch([tokenHandler(), childrenHandler([["a.txt", "b文件夹/"], ["c.txt"]])]);

    const res = await app.request("/api/accounts/p1/items?path=//docs/./", undefined, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; items: Array<{ id: string; isFolder: boolean; size: number | null }> };
    expect(body.path).toBe("/docs");
    expect(body.items).toHaveLength(3);
    expect(body.items[1]).toMatchObject({ id: "item-b文件夹/", isFolder: true, size: null });

    const childrenCall = installFetchCallsFind("/children");
    expect(childrenCall).toContain("/root:/docs:/children");
  });

  it("未知账号 → 404 ACCOUNT_NOT_FOUND", async () => {
    const { env } = makeEnv();
    installFetch([]);
    const res = await app.request("/api/accounts/none/items", undefined, env);
    expect(res.status).toBe(404);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("Graph 404 → 404 NOT_FOUND", async () => {
    const { env } = makeEnv();
    seedStandard(env.ACCOUNTS as unknown as MockKV);
    installFetch([tokenHandler(), graphErrorHandler(404)]);
    const res = await app.request("/api/accounts/p1/items?path=/missing", undefined, env);
    expect(res.status).toBe(404);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });
});

describe("file / download / raw", () => {
  it("file 返回元数据 + downloadUrl", async () => {
    const { env } = makeEnv();
    seedStandard(env.ACCOUNTS as unknown as MockKV);
    installFetch([tokenHandler(), itemHandler()]);
    const res = await app.request("/api/accounts/p1/file/ITEM123", undefined, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; downloadUrl: string; mimeType: string | null };
    expect(body.id).toBe("ITEM123");
    expect(body.downloadUrl).toContain("tempauth");
  });

  it("download 302 跳转直链且不缓存", async () => {
    const { env } = makeEnv();
    seedStandard(env.ACCOUNTS as unknown as MockKV);
    installFetch([tokenHandler(), itemHandler()]);
    const res = await app.request("/api/accounts/p1/download/ITEM123", undefined, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("tempauth");
  });

  it("raw 透传内容与 content-type", async () => {
    const { env } = makeEnv();
    seedStandard(env.ACCOUNTS as unknown as MockKV);
    installFetch([tokenHandler(), itemHandler(), downloadContentHandler()]);
    const res = await app.request("/api/accounts/p1/raw/ITEM123", undefined, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello onehub");
    expect(res.headers.get("content-type")).toBe("text/plain");
  });

  it("raw 超过 2MB → 413", async () => {
    const { env } = makeEnv();
    seedStandard(env.ACCOUNTS as unknown as MockKV);
    installFetch([tokenHandler(), itemHandler({ size: 3 * 1024 * 1024 })]);
    const res = await app.request("/api/accounts/p1/raw/ITEM123", undefined, env);
    expect(res.status).toBe(413);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("TOO_LARGE");
  });

  it("直链缺失 → 409 NO_DOWNLOAD_URL", async () => {
    const { env } = makeEnv();
    seedStandard(env.ACCOUNTS as unknown as MockKV);
    installFetch([tokenHandler(), itemHandler({ "@microsoft.graph.downloadUrl": undefined })]);
    const res = await app.request("/api/accounts/p1/download/ITEM123", undefined, env);
    expect(res.status).toBe(409);
  });
});

describe("授权失效路径", () => {
  it("个人版 refresh_token 失效 → 409 ACCOUNT_INVALID 且账号被标记", async () => {
    const { env, accountsKv } = makeEnv();
    seedStandard(accountsKv);
    installFetch([tokenErrorHandler("invalid_grant", "AADSTS70008: refresh token expired")]);
    const res = await app.request("/api/accounts/p1/items", undefined, env);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("ACCOUNT_INVALID");

    const stored = JSON.parse((accountsKv as unknown as MockKV).dump()["account:p1"]!) as AccountRecord;
    expect(stored.status).toBe("invalid");
  });

  it("Graph 双 401 → 409 并标记账号", async () => {
    const { env, accountsKv } = makeEnv();
    seedStandard(accountsKv);
    installFetch([
      (url) => (url.includes("login.microsoftonline.com") ? Response.json({ access_token: "at", expires_in: 3600 }) : undefined),
      graphErrorHandler(401),
    ]);
    const res = await app.request("/api/accounts/p1/items", undefined, env);
    expect(res.status).toBe(409);
    expect(JSON.parse((accountsKv as unknown as MockKV).dump()["account:p1"]!).status).toBe("invalid");
  });
});

/** 从最近一次 installFetch 的桩里找包含指定片段的请求 URL(辅助断言) */
function installFetchCallsFind(fragment: string): string {
  const stub = vi.mocked(globalThis.fetch);
  const call = stub.mock.calls.find((args) => String(args[0]).includes(fragment));
  return String(call?.[0] ?? "");
}
