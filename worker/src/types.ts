/** Worker 环境绑定, 与 worker/wrangler.jsonc 一致 */
export interface Env {
  /** 账号注册表 KV(账号配置 + 凭据 + token 缓存) */
  ACCOUNTS: KVNamespace;
  /** 密码门 KV(失败限速计数) */
  GATE: KVNamespace;
  /** 前端静态资产 */
  ASSETS: Fetcher;
  /** 站点访问密码; 未设置 = 完全公开 */
  ACCESS_PASSWORD?: string;
  /** 门 Cookie 的 HMAC 密钥; 设置了 ACCESS_PASSWORD 时必填 */
  GATE_SECRET?: string;
  /** 管理台密码; 未设置 = 管理台整体关闭(403 ADMIN_DISABLED) */
  ADMIN_PASSWORD?: string;
}

export type AccountType = "personal" | "business";
export type AccountStatus = "active" | "invalid";

/** KV account:<id> 的完整记录(含凭据, 仅服务端可见) */
export interface AccountRecord {
  id: string;
  /** 展示名, 如"一号机" */
  name: string;
  type: AccountType;
  status: AccountStatus;
  createdAt: string;
  /** 首次解析 drive 后缓存 */
  driveId?: string;
  // ---- personal ----
  clientId?: string;
  refreshToken?: string;
  // ---- business ----
  tenantId?: string;
  clientSecret?: string;
  upn?: string;
}

/** GET /api/accounts 对外暴露的账号信息(绝不含凭据) */
export interface SafeAccount {
  id: string;
  name: string;
  type: AccountType;
  status: AccountStatus;
}

/** 目录条目(契约见 docs/api.md §4) */
export interface ItemDTO {
  id: string;
  name: string;
  /** 文件夹恒为 null */
  size: number | null;
  isFolder: boolean;
  lastModifiedDateTime: string;
  mimeType: string | null;
}

/** GET /api/accounts/:id/file/:itemId 的响应 */
export interface FileMetaDTO extends ItemDTO {
  downloadUrl: string;
}

/** Hono 泛型环境: Bindings = KV/vars, Variables = 请求级上下文 */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** 账号中间件加载的当前账号记录 */
    account: AccountRecord;
  };
};
