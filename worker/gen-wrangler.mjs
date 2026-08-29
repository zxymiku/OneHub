#!/usr/bin/env node
/**
 * 由 wrangler.template.jsonc 生成 worker/wrangler.jsonc(生成物不入库)。
 * 开源安全:仓库中永远不含真实 KV namespace ID,部署/开发时注入。
 *
 * ID 来源优先级: 环境变量 > worker/.dev.vars 同名键 > 占位符(仅本地模拟)。
 * 本脚本幂等,每次 dev/deploy 前都会运行;请勿手改生成物。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(here, "wrangler.template.jsonc");
const outputPath = path.join(here, "wrangler.jsonc");

/** 解析 worker/.dev.vars 的 KEY=VALUE(本地开发便利, 不导出) */
function readDevVars() {
  try {
    const vars = {};
    for (const line of readFileSync(path.join(here, ".dev.vars"), "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match) vars[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
    return vars;
  } catch {
    return {};
  }
}

/** 纯函数: 模板 + ID 来源 → 最终配置文本(便于测试) */
export function renderConfig(env) {
  const accountsId = env.CF_KV_ACCOUNTS_ID || "<KV_NAMESPACE_ID>";
  const gateId = env.CF_KV_GATE_ID || "<KV_NAMESPACE_ID_2>";
  return readFileSync(templatePath, "utf8")
    .replaceAll("<KV_NAMESPACE_ID>", accountsId)
    .replaceAll("<KV_NAMESPACE_ID_2>", gateId);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const env = { ...readDevVars(), ...process.env };
  const accountsId = env.CF_KV_ACCOUNTS_ID?.trim();
  const gateId = env.CF_KV_GATE_ID?.trim();
  if (!accountsId || !gateId) {
    console.warn(
      "⚠ 未设置 CF_KV_ACCOUNTS_ID / CF_KV_GATE_ID(环境变量或 worker/.dev.vars), 生成占位配置 —— 仅可本地 wrangler dev 模拟, 部署与远程 KV 将失败",
    );
  }
  const banner = `// ⚠ 本文件由 worker/gen-wrangler.mjs 自动生成, 请勿手改; 模板: wrangler.template.jsonc\n// 生成时间: ${new Date().toISOString()}\n`;
  writeFileSync(outputPath, banner + renderConfig(env));
  console.log(
    accountsId && gateId
      ? "✓ 已生成 worker/wrangler.jsonc(真实 KV id, 环境注入)"
      : "✓ 已生成 worker/wrangler.jsonc(占位符, 仅本地模拟)",
  );
}
