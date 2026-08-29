import { getAccount, putAccount, tokenKey } from "../config/registry";
import type { AccountRecord, Env } from "../types";
import { AuthInvalidError } from "../lib/http";

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface CachedToken {
  accessToken: string;
  /** 绝对过期时间戳(ms) */
  expiresAt: number;
}

/** 提前 2 分钟视为过期, 避免临界点调用失败 */
const TTL_SAFETY_S = 120;

const PERSONAL_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const PERSONAL_SCOPE = "offline_access Files.Read.All User.Read";

/**
 * 取可用的 Graph access_token: 优先 KV 缓存, 未命中/强制刷新时走认证策略。
 * personal = refresh_token 换发(轮换后回写 KV); business = client_credentials。
 */
export async function getAccessToken(
  env: Env,
  account: AccountRecord,
  opts?: { forceRefresh?: boolean },
): Promise<string> {
  if (!opts?.forceRefresh) {
    const cachedRaw = await env.ACCOUNTS.get(tokenKey(account.id));
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as CachedToken;
        if (cached.expiresAt - TTL_SAFETY_S * 1000 > Date.now()) {
          return cached.accessToken;
        }
      } catch {
        // 缓存损坏, 走重新获取
      }
    }
  }

  const { accessToken, expiresIn } =
    account.type === "personal"
      ? await refreshPersonalToken(env, account)
      : await fetchBusinessToken(account);

  const cached: CachedToken = { accessToken, expiresAt: Date.now() + expiresIn * 1000 };
  await env.ACCOUNTS.put(tokenKey(account.id), JSON.stringify(cached), {
    expirationTtl: Math.max(60, expiresIn - TTL_SAFETY_S),
  });
  return accessToken;
}

/** 个人版: refresh_token 换新令牌。Microsoft 会轮换 refresh_token, 不回写会在闲置 90 天后失效 */
async function refreshPersonalToken(
  env: Env,
  account: AccountRecord,
): Promise<{ accessToken: string; expiresIn: number }> {
  if (!account.clientId || !account.refreshToken) {
    throw new AuthInvalidError("个人版账号缺少 client_id 或 refresh_token");
  }
  const res = await fetch(PERSONAL_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: account.clientId,
      grant_type: "refresh_token",
      refresh_token: account.refreshToken,
      scope: PERSONAL_SCOPE,
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenEndpointResponse;
  if (!res.ok || !data.access_token) {
    // AAD 原始 error_description 含 Trace ID 等内部信息, 不透传给用户; 完整原因记日志
    console.error(`personal refresh failed: ${data.error ?? "unknown"} ${data.error_description ?? ""}`);
    throw new AuthInvalidError("个人账号授权已失效, 请在服务器上重新执行 account:add 授权");
  }
  if (data.refresh_token) {
    // 读-改-写: CLI 可能在两次刷新之间覆盖过记录, 以 KV 最新值为基线
    const latest = (await getAccount(env.ACCOUNTS, account.id)) ?? account;
    latest.refreshToken = data.refresh_token;
    await putAccount(env.ACCOUNTS, latest);
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
}

/** 企业版: client_credentials, scope 固定 /.default(管理员已在 Azure 侧同意) */
async function fetchBusinessToken(account: AccountRecord): Promise<{ accessToken: string; expiresIn: number }> {
  if (!account.tenantId || !account.clientId || !account.clientSecret) {
    throw new AuthInvalidError("企业版账号缺少 tenant_id / client_id / client_secret");
  }
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(account.tenantId)}/oauth2/v2.0/token`;
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: account.clientId,
      client_secret: account.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenEndpointResponse;
  if (!res.ok || !data.access_token) {
    console.error(`business token failed: ${data.error ?? "unknown"} ${data.error_description ?? ""}`);
    throw new AuthInvalidError("企业版应用验证失败, 请检查应用密钥与管理员同意是否有效");
  }
  return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
}
