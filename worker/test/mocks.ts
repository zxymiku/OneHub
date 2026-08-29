import { vi } from "vitest";
import type { AccountRecord } from "../src/types";

/** 最小 KVNamespace 模拟: 仅实现本项目用到的 get/put/delete */
export class MockKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string, _opts?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  seed(entries: Record<string, string>): void {
    for (const [key, value] of Object.entries(entries)) this.store.set(key, value);
  }

  dump(): Record<string, string> {
    return Object.fromEntries(this.store);
  }
}

export type FetchHandler = (
  url: string,
  init?: RequestInit,
) => Response | undefined | Promise<Response | undefined>;

export interface InstalledFetch {
  calls: Array<{ url: string; init?: RequestInit }>;
}

/** 安装按序匹配的 fetch 桩, handler 返回 undefined 表示不处理 */
export function installFetch(handlers: FetchHandler[]): InstalledFetch {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    for (const handler of handlers) {
      const res = await handler(url, init);
      if (res !== undefined) return res;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", stub);
  return { calls };
}

export function parseBody(init?: RequestInit): URLSearchParams {
  return new URLSearchParams(String(init?.body ?? ""));
}

// ---- 固定数据 ----

export const PERSONAL_ACCOUNT: AccountRecord = {
  id: "p1",
  name: "一号机",
  type: "personal",
  status: "active",
  createdAt: "2026-08-29T00:00:00Z",
  clientId: "cid-personal",
  refreshToken: "rt-old",
};

export const BUSINESS_ACCOUNT: AccountRecord = {
  id: "b1",
  name: "账号2",
  type: "business",
  status: "active",
  createdAt: "2026-08-29T00:00:00Z",
  tenantId: "tenant-x",
  clientId: "cid-business",
  clientSecret: "cs-secret",
  upn: "admin@t.onmicrosoft.com",
};

export function seedAccounts(kv: MockKV, records: AccountRecord[]): void {
  const entries: Record<string, string> = {
    "accounts:index": JSON.stringify(records.map((r) => r.id)),
  };
  for (const record of records) {
    entries[`account:${record.id}`] = JSON.stringify(record);
  }
  kv.seed(entries);
}

// ---- 常用 Graph / AAD 响应桩 ----

/** 登录端点: 回固定 access_token, 若请求带 refresh_token 则返回轮换值 */
export function tokenHandler(accessToken = "at-1"): FetchHandler {
  return (url, init) => {
    if (!url.includes("login.microsoftonline.com")) return undefined;
    const body = parseBody(init);
    const refreshToken = body.get("refresh_token");
    return Response.json({
      access_token: accessToken,
      expires_in: 3600,
      ...(refreshToken ? { refresh_token: `${refreshToken}-next` } : {}),
    });
  };
}

export function tokenErrorHandler(error: string, description: string): FetchHandler {
  return (url) => {
    if (!url.includes("login.microsoftonline.com")) return undefined;
    return Response.json({ error, error_description: description }, { status: 400 });
  };
}

export function childrenHandler(pages: string[][]): FetchHandler {
  let pageIndex = 0;
  return (url) => {
    if (!url.includes("graph.microsoft.com")) return undefined;
    if (!url.includes("/children") && !url.includes("/next-page")) return undefined;
    const page = pages[pageIndex] ?? [];
    const hasNext = pageIndex < pages.length - 1;
    pageIndex += 1;
    return Response.json({
      value: page.map((name) => ({
        id: `item-${name}`,
        name,
        size: name.endsWith("/") ? undefined : 128,
        lastModifiedDateTime: "2026-08-01T00:00:00Z",
        ...(name.endsWith("/") ? { folder: {} } : { file: { mimeType: "text/plain" } }),
      })),
      ...(hasNext ? { "@odata.nextLink": "https://graph.microsoft.com/v1.0/next-page" } : {}),
    });
  };
}

export function itemHandler(overrides: Record<string, unknown> = {}): FetchHandler {
  return (url) => {
    if (!url.includes("graph.microsoft.com")) return undefined;
    const match = url.match(/\/items\/([^/?]+)/);
    if (!match) return undefined;
    return Response.json({
      id: decodeURIComponent(match[1]!),
      name: "文件.txt",
      size: 24,
      lastModifiedDateTime: "2026-08-01T00:00:00Z",
      file: { mimeType: "text/plain" },
      "@microsoft.graph.downloadUrl": "https://dl.example.com/file?tempauth=xyz",
      ...overrides,
    });
  };
}

export function graphErrorHandler(status: number): FetchHandler {
  return (url) => {
    if (!url.includes("graph.microsoft.com")) return undefined;
    return Response.json({ error: { code: "x" } }, { status });
  };
}

/** 直链内容桩 */
export function downloadContentHandler(): FetchHandler {
  return (url) => {
    if (!url.includes("dl.example.com")) return undefined;
    return new Response("hello onehub", { status: 200, headers: { "content-type": "text/plain" } });
  };
}
