import { randomBytes } from "node:crypto";

/** 账号记录(worker/src/types.ts 的镜像, 契约见 docs/api.md §4 KV 模型) */
export interface AccountRecord {
  id: string;
  name: string;
  type: "personal" | "business";
  status: "active" | "invalid";
  createdAt: string;
  driveId?: string;
  clientId?: string;
  refreshToken?: string;
  tenantId?: string;
  clientSecret?: string;
  upn?: string;
}

export type Flags = Record<string, string | boolean>;

/** 解析 `--key value` 与 `--key=value` 两种形式 */
export function parseArgs(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

export function requireFlag(flags: Flags, key: string, hint: string): string {
  const value = flags[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`缺少 --${key}(${hint})`);
  }
  return value;
}

/** list 输出的脱敏视图: 任何密钥只体现"是否存在" */
export function maskAccount(record: AccountRecord): Record<string, string | boolean> {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    status: record.status,
    upn: record.upn ?? "-",
    clientId: record.clientId ? `${record.clientId.slice(0, 6)}…` : "-",
    hasSecret: Boolean(record.clientSecret || record.refreshToken),
    driveId: record.driveId ?? "-",
    createdAt: record.createdAt,
  };
}

export function mergeIndex(existing: string[], recordId: string): string[] {
  return [...existing.filter((id) => id !== recordId), recordId];
}

export function newId(): string {
  return randomBytes(4).toString("hex");
}
