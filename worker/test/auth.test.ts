import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccessToken } from "../src/onedrive/auth";
import { AuthInvalidError } from "../src/lib/http";
import type { Env } from "../src/types";
import {
  MockKV,
  PERSONAL_ACCOUNT,
  BUSINESS_ACCOUNT,
  installFetch,
  parseBody,
} from "./mocks";

function makeEnv(): { env: Env; accountsKv: MockKV } {
  const accountsKv = new MockKV();
  const env = {
    ACCOUNTS: accountsKv as unknown as KVNamespace,
    GATE: new MockKV() as unknown as KVNamespace,
    ASSETS: {} as unknown as Fetcher,
  } as Env;
  return { env, accountsKv };
}

function kvEnv(kv: MockKV): KVNamespace {
  return kv as unknown as KVNamespace;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAccessToken 缓存", () => {
  it("缓存未过期时直接复用, 不请求登录端点", async () => {
    const { env } = makeEnv();
    await env.ACCOUNTS.put(
      `token:${PERSONAL_ACCOUNT.id}`,
      JSON.stringify({ accessToken: "cached-at", expiresAt: Date.now() + 30 * 60 * 1000 }),
    );
    const { calls } = installFetch([]);
    const token = await getAccessToken(env, PERSONAL_ACCOUNT);
    expect(token).toBe("cached-at");
    expect(calls).toHaveLength(0);
  });

  it("临近过期(<120s)时强制刷新", async () => {
    const { env } = makeEnv();
    await env.ACCOUNTS.put(
      `token:${PERSONAL_ACCOUNT.id}`,
      JSON.stringify({ accessToken: "stale-at", expiresAt: Date.now() + 30 * 1000 }),
    );
    const { calls } = installFetch([
      (url) => (url.includes("login.microsoftonline.com") ? Response.json({ access_token: "fresh-at", expires_in: 3600 }) : undefined),
    ]);
    const token = await getAccessToken(env, PERSONAL_ACCOUNT);
    expect(token).toBe("fresh-at");
    expect(calls.some((c) => c.url.includes("login.microsoftonline.com"))).toBe(true);
  });
});

describe("个人版 refresh_token 轮换回写", () => {
  it("刷新后把新 refresh_token 写回账号记录", async () => {
    const { env, accountsKv } = makeEnv();
    installFetch([
      (url, init) => {
        if (!url.includes("login.microsoftonline.com")) return undefined;
        const body = parseBody(init);
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("scope")).toContain("offline_access");
        return Response.json({ access_token: "at-2", refresh_token: "rt-new", expires_in: 3600 });
      },
    ]);
    await getAccessToken(env, PERSONAL_ACCOUNT);

    const stored = JSON.parse((await accountsKv.get(`account:${PERSONAL_ACCOUNT.id}`))!) as typeof PERSONAL_ACCOUNT;
    expect(stored.refreshToken).toBe("rt-new");
  });

  it("invalid_grant → AuthInvalidError", async () => {
    const { env } = makeEnv();
    installFetch([
      (url) =>
        url.includes("login.microsoftonline.com")
          ? Response.json({ error: "invalid_grant", error_description: "expired" }, { status: 400 })
          : undefined,
    ]);
    await expect(getAccessToken(env, PERSONAL_ACCOUNT)).rejects.toBeInstanceOf(AuthInvalidError);
  });

  it("缺少凭据 → AuthInvalidError 且不发起请求", async () => {
    const { env } = makeEnv();
    const { calls } = installFetch([]);
    await expect(
      getAccessToken(env, { ...PERSONAL_ACCOUNT, refreshToken: undefined }),
    ).rejects.toBeInstanceOf(AuthInvalidError);
    expect(calls).toHaveLength(0);
  });
});

describe("企业版 client_credentials", () => {
  it("用租户端点换取令牌, scope=/default", async () => {
    const { env, accountsKv } = makeEnv();
    const { calls } = installFetch([
      (url, init) => {
        if (!url.includes("login.microsoftonline.com/tenant-x/")) return undefined;
        const body = parseBody(init);
        expect(body.get("grant_type")).toBe("client_credentials");
        expect(body.get("scope")).toBe("https://graph.microsoft.com/.default");
        return Response.json({ access_token: "biz-at", expires_in: 5400 });
      },
    ]);
    const token = await getAccessToken(env, BUSINESS_ACCOUNT);
    expect(token).toBe("biz-at");
    const cached = JSON.parse((await kvEnv(accountsKv).get(`token:${BUSINESS_ACCOUNT.id}`))!) as { accessToken: string };
    expect(cached.accessToken).toBe("biz-at");
    expect(calls).toHaveLength(1);
  });
});
