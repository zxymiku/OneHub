import { apiDelete, apiGet, apiPost, ApiError } from "./client";
import type { SafeAccount } from "./types";

export interface AdminStatus {
  enabled: boolean;
  unlocked: boolean;
}

/** 管理台脱敏账号视图(契约 docs/api.md §8.1) */
export interface AdminAccount extends SafeAccount {
  upn: string | null;
  hasSecret: boolean;
  driveId: string | null;
  createdAt: string;
}

export interface DeviceCodeStartDTO {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

export type PersonalPollDTO =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "ok"; account: SafeAccount };

export const adminApi = {
  status: () => apiGet<AdminStatus>("/api/admin/status"),
  login: (password: string) => apiPost<{ ok: true }>("/api/admin/auth", { password }),
  logout: () => apiDelete<{ ok: true }>("/api/admin/auth"),
  list: () => apiGet<{ accounts: AdminAccount[] }>("/api/admin/accounts"),
  rename: (id: string, name: string) => apiPut<{ ok: true }>(`/api/admin/accounts/${encodeURIComponent(id)}`, { name }),
  remove: (id: string) => apiDelete<{ ok: true }>(`/api/admin/accounts/${encodeURIComponent(id)}`),
  business: (input: { name: string; tenantId: string; clientId: string; clientSecret: string; upn: string }) =>
    apiPost<{ account: SafeAccount }>("/api/admin/accounts/business", input),
  personalStart: (input: { name: string; clientId: string }) =>
    apiPost<DeviceCodeStartDTO>("/api/admin/accounts/personal/start", input),
  personalPoll: (sessionId: string) =>
    apiPost<PersonalPollDTO>("/api/admin/accounts/personal/poll", { sessionId }),
};

function apiPut<T>(path: string, body: unknown): Promise<T> {
  return apiPutRequest(path, body);
}

async function apiPutRequest<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "无法连接服务器, 请检查网络或稍后再试");
  }
  if (!res.ok) {
    const body2 = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (body2?.error) throw new ApiError(res.status, body2.error.code, body2.error.message);
    throw new ApiError(res.status, "UNKNOWN", `请求失败(HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}
