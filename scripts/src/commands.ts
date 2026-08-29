import type { AccountRecord, Flags } from "./lib";
import { maskAccount, mergeIndex, newId, requireFlag } from "./lib";
import { kvDelete, kvGet, kvListKeys, kvPut } from "./kv";
import { pollDeviceCode, resolveDriveId, startDeviceCode, verifyBusinessCredentials } from "./auth-flows";

const INDEX_KEY = "accounts:index";

async function loadAllAccounts(remote: boolean): Promise<AccountRecord[]> {
  const keys = await kvListKeys(remote);
  const records: AccountRecord[] = [];
  for (const key of keys.filter((k) => k.startsWith("account:"))) {
    const raw = await kvGet(key, remote);
    if (!raw) continue;
    try {
      records.push(JSON.parse(raw) as AccountRecord);
    } catch {
      // 跳过损坏记录
    }
  }
  return records;
}

async function saveAccount(remote: boolean, record: AccountRecord): Promise<void> {
  await kvPut(`account:${record.id}`, JSON.stringify(record), remote);
  const others = (await loadAllAccounts(remote)).map((r) => r.id);
  await kvPut(INDEX_KEY, JSON.stringify(mergeIndex(others, record.id)), remote);
}

export async function addCommand(flags: Flags): Promise<void> {
  const name = requireFlag(flags, "name", "展示名, 如 --name 一号机");
  const type = requireFlag(flags, "type", "账号类型 personal | business");
  if (type !== "personal" && type !== "business") {
    throw new Error(`--type 只支持 personal 或 business, 收到: ${type}`);
  }
  const remote = Boolean(flags.remote);
  const existing = await loadAllAccounts(remote);
  const sameName = existing.find((a) => a.name === name);
  const id = sameName?.id ?? newId();
  const createdAt = sameName?.createdAt ?? new Date().toISOString();

  let record: AccountRecord;
  if (type === "personal") {
    const clientId = requireFlag(flags, "client-id", "Azure 应用程序(客户端) ID, 见 docs/setup-azure.md");
    console.log("① 申请个人版设备码…");
    const start = await startDeviceCode(clientId);
    console.log(`\n  ① 打开  ${start.verification_uri}`);
    console.log(`  ② 输入代码  ${start.user_code}\n`);
    const tokens = await pollDeviceCode(clientId, start);
    console.log("③ 授权成功, 解析 drive…");
    const driveId = await resolveDriveId(tokens.accessToken);
    record = {
      id, name, type: "personal", status: "active", createdAt,
      clientId, refreshToken: tokens.refreshToken, driveId,
    };
  } else {
    const tenantId = requireFlag(flags, "tenant-id", "Azure 目录(租户) ID");
    const clientId = requireFlag(flags, "client-id", "Azure 应用程序(客户端) ID");
    const clientSecret = requireFlag(flags, "client-secret", "Azure 客户端密钥 Value");
    const upn = requireFlag(flags, "upn", "目标用户 UPN(登录邮箱)");
    console.log("① 验证企业版应用凭据…");
    const token = await verifyBusinessCredentials({ tenantId, clientId, clientSecret });
    console.log("② 验证通过, 解析 drive…");
    const driveId = await resolveDriveId(token, upn);
    record = {
      id, name, type: "business", status: "active", createdAt,
      tenantId, clientId, clientSecret, upn, driveId,
    };
  }

  await saveAccount(remote, record);
  console.log(`\n✓ 已${sameName ? "覆盖更新" : "添加"}账号「${name}」 id=${id} drive=${driveIdText(record)}`);
  console.log(`  写入${remote ? "远程 KV(线上生效)" : "本地 KV(wrangler dev 预览; 部署前记得加 --remote)"}`);
  console.log(`  当前配置: ${JSON.stringify(maskAccount(record), null, 2)}`);
}

function driveIdText(record: AccountRecord): string {
  return record.driveId ?? "-";
}

export async function listCommand(flags: Flags): Promise<void> {
  const remote = Boolean(flags.remote);
  const accounts = await loadAllAccounts(remote);
  if (accounts.length === 0) {
    console.log(`(${remote ? "远程" : "本地"} KV 中还没有账号, 用 account:add 添加)`);
    return;
  }
  for (const record of accounts) {
    console.log(JSON.stringify(maskAccount(record)));
  }
}

export async function removeCommand(flags: Flags): Promise<void> {
  const remote = Boolean(flags.remote);
  const id = typeof flags.id === "string" ? flags.id : undefined;
  const name = typeof flags.name === "string" ? flags.name : undefined;
  if (!id && !name) throw new Error("请用 --id <账号id> 或 --name <展示名> 指定要移除的账号");
  const accounts = await loadAllAccounts(remote);
  const target = id ? accounts.find((a) => a.id === id) : accounts.find((a) => a.name === name);
  if (!target) throw new Error(`未找到账号(${id ?? name}), 先用 account:list 查看现有账号`);
  await kvDelete(`account:${target.id}`, remote);
  await kvDelete(`token:${target.id}`, remote);
  const remaining = (await loadAllAccounts(remote)).map((a) => a.id);
  await kvPut(INDEX_KEY, JSON.stringify(remaining), remote);
  console.log(`✓ 已移除账号「${target.name}」 id=${target.id}`);
}

/**
 * 本地 → 线上 KV 同步(本地专属管理台的配套上传)。
 * 语义: 本地账号整体上传(同 id 覆盖); 线上已有而本地没有的账号保留不动;
 * 最终 index = 两者并集。删除请用管理台或 account:remove --remote。
 */
export async function syncCommand(flags: Flags): Promise<void> {
  const dryRun = Boolean(flags["dry-run"]);
  const localKeys = await kvListKeys(false);
  const accountKeys = localKeys.filter((k) => k.startsWith("account:"));
  if (accountKeys.length === 0) {
    throw new Error("本地 KV 中没有账号。先在本地管理台(/admin)添加, 或用 account:add(不加 --remote)");
  }

  const localRecords: AccountRecord[] = [];
  for (const key of accountKeys) {
    const raw = await kvGet(key, false);
    if (!raw) continue;
    try {
      localRecords.push(JSON.parse(raw) as AccountRecord);
    } catch {
      console.warn(`⚠ 跳过损坏的本地记录: ${key}`);
    }
  }
  if (localRecords.length === 0) throw new Error("本地账号记录全部无法解析, 请重新添加");

  const remoteIds = await parseIndex(true);
  const remoteOnlyIds = remoteIds.filter((id) => !localRecords.some((r) => r.id === id));
  const localIds = localRecords.map((r) => r.id);

  console.log(`本地账号 ${localRecords.length} 个:`);
  for (const record of localRecords) {
    console.log(`  ↑ ${JSON.stringify(maskAccount(record))}`);
  }
  if (remoteOnlyIds.length > 0) {
    console.log(`线上已有而本地没有的账号 ${remoteOnlyIds.length} 个, 将保留不动(如需删除用 account:remove --remote)`);
  }
  if (dryRun) {
    console.log("(--dry-run 未写入)");
    return;
  }

  for (const record of localRecords) {
    await kvPut(`account:${record.id}`, JSON.stringify(record), true);
  }
  const mergedIndex = [...new Set([...remoteOnlyIds, ...localIds])];
  await kvPut(INDEX_KEY, JSON.stringify(mergedIndex), true);
  console.log(`\n✓ 已同步 ${localRecords.length} 个账号到线上 KV(经 Cloudflare 认证连接加密传输)`);
  console.log("  线上网站现在即可看到这些账号; 访客依旧无法接触任何凭据。");
}

async function parseIndex(remote: boolean): Promise<string[]> {
  const raw = await kvGet(INDEX_KEY, remote);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function printUsage(): void {
  console.log(`OneHub 账号管理 CLI

用法(npm run 执行, 见根 package.json):
  npm run account:add -- --name 一号机 --type personal --client-id <应用程序ID>
  npm run account:add -- --name 账号2 --type business --client-id <ID> --tenant-id <租户ID> \\
        --client-secret <密钥Value> --upn user@tenant.onmicrosoft.com
  npm run account:list
  npm run account:remove -- --id <id>          # 或 --name <展示名>
  npm run account:sync                         # 本地管理台账号 → 线上 KV
  npm run account:sync -- --dry-run            # 只预览不写入

选项:
  --remote    写/读线上 KV(默认写本地 wrangler dev 预览数据)
  --help      显示本帮助

管理台(本地开发访问 /admin)与 CLI 管理同一份本地数据; 线上更新用 account:sync。
Azure 应用注册步骤见 docs/setup-azure.md。`);
}
