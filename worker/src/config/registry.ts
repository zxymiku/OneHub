import type { AccountRecord, SafeAccount } from "../types";

const INDEX_KEY = "accounts:index";

export function accountKey(id: string): string {
  return `account:${id}`;
}

export function tokenKey(id: string): string {
  return `token:${id}`;
}

export function newAccountId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function listAccountIds(kv: KVNamespace): Promise<string[]> {
  const raw = await kv.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function getAccount(kv: KVNamespace, id: string): Promise<AccountRecord | null> {
  const raw = await kv.get(accountKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AccountRecord;
  } catch {
    return null;
  }
}

export async function putAccount(kv: KVNamespace, record: AccountRecord): Promise<void> {
  await kv.put(accountKey(record.id), JSON.stringify(record));
  const ids = await listAccountIds(kv);
  if (!ids.includes(record.id)) {
    ids.push(record.id);
    await kv.put(INDEX_KEY, JSON.stringify(ids));
  }
}

export async function removeAccount(kv: KVNamespace, id: string): Promise<boolean> {
  const existing = await getAccount(kv, id);
  if (!existing) return false;
  await kv.delete(accountKey(id));
  await kv.delete(tokenKey(id));
  const ids = await listAccountIds(kv);
  await kv.put(INDEX_KEY, JSON.stringify(ids.filter((x) => x !== id)));
  return true;
}

/** 授权失效时打标记, /api/accounts 会把 status 透传给前端 */
export async function markAccountInvalid(kv: KVNamespace, record: AccountRecord): Promise<void> {
  record.status = "invalid";
  await putAccount(kv, record);
}

export function toSafeAccount(record: AccountRecord): SafeAccount {
  return { id: record.id, name: record.name, type: record.type, status: record.status };
}
