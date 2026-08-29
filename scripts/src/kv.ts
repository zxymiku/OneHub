import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
/** worker 目录(wrangler.jsonc 所在, 作为 kv 命令的 cwd 以自动发现配置) */
export const workerDir = path.resolve(scriptDir, "..", "..", "worker");

function wranglerBin(): string {
  return path.resolve(workerDir, "..", "node_modules", "wrangler", "bin", "wrangler.js");
}

/** wrangler.jsonc 是生成物: 缺失时按 CF_KV_* 环境变量/.dev.vars 生成(开源零标识符链路) */
function ensureWranglerConfig(): void {
  if (!existsSync(path.join(workerDir, "wrangler.jsonc"))) {
    execFileSync(process.execPath, [path.join(workerDir, "gen-wrangler.mjs")], {
      cwd: workerDir,
      stdio: "inherit",
    });
  }
}

function runWrangler(args: string[], allowFailure: boolean): string | null {
  ensureWranglerConfig();
  try {
    return execFileSync(process.execPath, [wranglerBin(), ...args], {
      cwd: workerDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    if (allowFailure) return null;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `wrangler 执行失败(${args.join(" ")})。请确认已 npm install 并完成 npx wrangler login。原因: ${message}`,
    );
  }
}

function modeFlag(remote: boolean): string {
  return remote ? "--remote" : "--local";
}

/**
 * 经 wrangler 读写 KV(绑定 ACCOUNTS)。默认 --local(wrangler dev 的本地预览数据),
 * --remote 写线上。密钥参数经 execFile 传递, 不经 shell, 不回显。
 */
export function kvPut(key: string, value: string, remote: boolean): void {
  runWrangler(["kv", "key", "put", key, value, "--binding=ACCOUNTS", modeFlag(remote)], false);
}

export function kvGet(key: string, remote: boolean): string | null {
  const out = runWrangler(
    ["kv", "key", "get", key, "--binding=ACCOUNTS", modeFlag(remote)],
    true,
  );
  return out === null ? null : out.trimEnd();
}

export function kvDelete(key: string, remote: boolean): void {
  runWrangler(["kv", "key", "delete", key, "--binding=ACCOUNTS", "--force", modeFlag(remote)], true);
}

export function kvListKeys(remote: boolean): string[] {
  const out = runWrangler(["kv", "key", "list", "--binding=ACCOUNTS", modeFlag(remote)], true);
  if (!out) return [];
  try {
    const parsed: unknown = JSON.parse(out);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => (typeof entry === "string" ? entry : (entry as { name?: string }).name))
      .filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
}
