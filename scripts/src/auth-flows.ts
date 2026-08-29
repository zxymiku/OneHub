const PERSONAL_TOKEN_BASE = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const PERSONAL_SCOPE = "offline_access Files.Read.All User.Read";

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error_description?: string; error?: string };
  return data.error_description ?? data.error ?? `HTTP ${res.status}`;
}

export interface DeviceCodeStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/** 个人版设备码流第一步 */
export async function startDeviceCode(clientId: string): Promise<DeviceCodeStart> {
  const res = await fetch(`${PERSONAL_TOKEN_BASE}/devicecode`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, scope: PERSONAL_SCOPE }),
  });
  if (!res.ok) throw new Error(`申请设备码失败: ${await readError(res)}`);
  return (await res.json()) as DeviceCodeStart;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
}

export interface PersonalTokens {
  accessToken: string;
  refreshToken: string;
}

/** 轮询设备码授权结果(authorization_pending / slow_down 按 RFC 8628 处理) */
export async function pollDeviceCode(
  clientId: string,
  start: DeviceCodeStart,
  onWait?: (message: string) => void,
): Promise<PersonalTokens> {
  const deadline = Date.now() + start.expires_in * 1000;
  let intervalMs = Math.max(1, start.interval || 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const res = await fetch(`${PERSONAL_TOKEN_BASE}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: start.device_code,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as TokenResponse;
    if (res.ok && data.access_token && data.refresh_token) {
      return { accessToken: data.access_token, refreshToken: data.refresh_token };
    }
    if (data.error === "authorization_pending") {
      onWait?.("等待你在浏览器中完成授权…");
      continue;
    }
    if (data.error === "slow_down") {
      intervalMs += 3000;
      continue;
    }
    throw new Error(`授权失败: ${data.error_description ?? data.error ?? res.status}`);
  }
  throw new Error("设备码已过期, 请重新执行 account:add");
}

/** 企业版: client_credentials 验证(仅校验可用性, token 不入库, Worker 自行获取) */
export async function verifyBusinessCredentials(input: {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(input.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      }),
    },
  );
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(`企业版凭据验证失败(检查租户ID/应用ID/密钥/管理员同意): ${data.error_description ?? data.error ?? res.status}`);
  }
  return data.access_token;
}

/** 解析目标 driveId: personal 传 access_token; business 额外传 upn */
export async function resolveDriveId(accessToken: string, upn?: string): Promise<string> {
  const url = upn
    ? `${GRAPH}/users/${encodeURIComponent(upn)}/drive`
    : `${GRAPH}/me/drive`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) {
    throw new Error(
      `解析 drive 失败${upn ? `(检查 UPN 是否正确、该用户是否已启用 OneDrive)` : ""}: ${data.error?.message ?? res.status}`,
    );
  }
  return data.id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
