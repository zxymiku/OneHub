import type { ContentfulStatusCode } from "hono/utils/http-status";
/**
 * 管理台的授权流程(docs/api.md §8.2/§8.3)。
 * 与 scripts/ 的 CLI 流程独立: 运行在 Workers 运行时, 设备码保存在服务端 KV。
 */
import { getAccount, putAccount } from "../config/registry";
import { resolveDriveId } from "./drive";
import type { AccountRecord, SafeAccount } from "../types";

const PERSONAL_TOKEN_BASE = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const PERSONAL_SCOPE = "offline_access Files.Read.All User.Read";
/** 设备码有效期(微软默认 15 分钟) */
const PENDING_TTL_S = 900;

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class FlowError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "FlowError";
  }
}

export interface DeviceCodeStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export function newSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 校验展示名: 非空且不与现有账号重名(网页端显式报错, 不像 CLI 那样同名覆盖) */
export async function assertNameAvailable(kv: KVNamespace, name: string): Promise<void> {
  const indexRaw = await kv.get("accounts:index");
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(indexRaw ?? "[]");
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    ids = [];
  }
  for (const id of ids) {
    const record = await getAccount(kv, id);
    if (record?.name === name) {
      throw new FlowError(409, "DUPLICATE_NAME", `已有同名账号「${name}」, 请换一个展示名或先删除原账号`);
    }
  }
}

// ---- 设备码 pending 存取(KV `pending:<sessionId>`) ----

interface PendingAuth {
  name: string;
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}

async function putPending(kv: KVNamespace, sessionId: string, pending: PendingAuth): Promise<void> {
  await kv.put(`pending:${sessionId}`, JSON.stringify(pending), { expirationTtl: PENDING_TTL_S });
}

async function getPending(kv: KVNamespace, sessionId: string): Promise<PendingAuth | null> {
  if (!/^[0-9a-f]{16}$/.test(sessionId)) return null;
  const raw = await kv.get(`pending:${sessionId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingAuth;
  } catch {
    return null;
  }
}

async function deletePending(kv: KVNamespace, sessionId: string): Promise<void> {
  await kv.delete(`pending:${sessionId}`);
}

/** 个人版第一步: 申请设备码, 存 pending, 返回给前端展示 */
export async function startPersonalFlow(
  kv: KVNamespace,
  name: string,
  clientId: string,
): Promise<{ sessionId: string; userCode: string; verificationUri: string; expiresIn: number }> {
  const res = await fetch(`${PERSONAL_TOKEN_BASE}/devicecode`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: PERSONAL_SCOPE }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
    error_description?: string;
  };
  if (!res.ok || !data.device_code || !data.user_code || !data.verification_uri) {
    throw new FlowError(
      409,
      "FLOW_START_FAILED",
      "申请设备码失败, 请检查应用程序(客户端) ID 与「允许公共客户端流」设置",
    );
  }
  const sessionId = newSessionId();
  await putPending(kv, sessionId, {
    name,
    clientId,
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresAt: Date.now() + (data.expires_in ?? PENDING_TTL_S) * 1000,
    interval: data.interval ?? 5,
  });
  return {
    sessionId,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in ?? PENDING_TTL_S,
  };
}

export type PollResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "ok"; account: SafeAccount };

/** 个人版轮询: 用户在微软页面完成授权后返回完整账号 */
export async function pollPersonalFlow(env: { ACCOUNTS: KVNamespace }, sessionId: string): Promise<PollResult> {
  const pending = await getPending(env.ACCOUNTS, sessionId);
  if (!pending) return { status: "expired" };

  const res = await fetch(`${PERSONAL_TOKEN_BASE}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: pending.clientId,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: pending.deviceCode,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenEndpointResponse;

  if (data.error === "authorization_pending") return { status: "pending" };
  if (data.error === "slow_down") return { status: "pending" };

  const cleanup = () => void deletePending(env.ACCOUNTS, sessionId);

  if (!res.ok || !data.access_token || !data.refresh_token) {
    cleanup();
    throw new FlowError(409, "AUTH_FAILED", "微软拒绝了本次授权, 请重新开始并确认登录的是目标个人账号");
  }

  let driveId: string;
  try {
    driveId = await resolveDriveId(data.access_token);
  } catch {
    cleanup();
    throw new FlowError(409, "DRIVE_FAILED", "登录成功但无法访问该账号的 OneDrive, 请稍后重试");
  }

  const record: AccountRecord = {
    id: newId(),
    name: pending.name,
    type: "personal",
    status: "active",
    createdAt: new Date().toISOString(),
    clientId: pending.clientId,
    refreshToken: data.refresh_token,
    driveId,
  };
  await putAccount(env.ACCOUNTS, record);
  cleanup();
  return { status: "ok", account: toSafe(record) };
}

/** 企业版: 验证凭据并落库(docs/api.md §8.2) */
export async function addBusinessAccount(
  kv: KVNamespace,
  input: { name: string; tenantId: string; clientId: string; clientSecret: string; upn: string },
): Promise<SafeAccount> {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(input.tenantId)}/oauth2/v2.0/token`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenEndpointResponse;
  if (!res.ok || !data.access_token) {
    throw new FlowError(
      409,
      "VALIDATION_FAILED",
      "凭据验证失败: 请核对租户 ID / 应用程序 ID / 密钥 Value, 并确认已在 Azure 完成管理员同意",
    );
  }

  let driveId: string;
  try {
    driveId = await resolveDriveId(data.access_token, input.upn);
  } catch {
    throw new FlowError(409, "VALIDATION_FAILED", "凭据有效但无法访问该用户的 OneDrive, 请核对 UPN 并确认该用户已启用 OneDrive");
  }

  const record: AccountRecord = {
    id: newId(),
    name: input.name,
    type: "business",
    status: "active",
    createdAt: new Date().toISOString(),
    tenantId: input.tenantId,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    upn: input.upn,
    driveId,
  };
  await putAccount(kv, record);
  return toSafe(record);
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toSafe(record: AccountRecord): SafeAccount {
  return { id: record.id, name: record.name, type: record.type, status: record.status };
}
