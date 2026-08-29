import type { ApiErrorBody } from "./types";

/** 契约错误(docs/api.md §0), code 为机器码, message 为可直接展示的中文 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "NETWORK", "无法连接服务器, 请检查网络或稍后再试");
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    if (body?.error) {
      throw new ApiError(res.status, body.error.code, body.error.message);
    }
    throw new ApiError(res.status, "UNKNOWN", `请求失败(HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: "DELETE" });
}
