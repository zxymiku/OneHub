import type { Env } from "../types";
import { safeEqual } from "../lib/http";

const COOKIE_NAME = "onehub_gate";
/** 门 Cookie 有效期 7 天 */
const COOKIE_MAX_AGE_S = 7 * 24 * 60 * 60;

/** 失败限速: 10 分钟窗口内最多 5 次错误尝试 */
const RATELIMIT_MAX = 5;
const RATELIMIT_WINDOW_S = 600;

export function gateRequired(env: Env): boolean {
  return Boolean(env.ACCESS_PASSWORD);
}

function gateConfigured(env: Env): env is Env & { ACCESS_PASSWORD: string; GATE_SECRET: string } {
  return Boolean(env.ACCESS_PASSWORD && env.GATE_SECRET);
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 常量时间比较密码(SHA-256 定长摘要) */
export async function verifyPassword(env: Env, candidate: string): Promise<boolean> {
  if (!env.ACCESS_PASSWORD) return true;
  return safeEqual(candidate, env.ACCESS_PASSWORD);
}

/** 签发门 Cookie 值: `<过期时间戳>.<HMAC>`(无状态校验, 不依赖存储) */
export async function issueCookieValue(env: Env): Promise<string> {
  if (!gateConfigured(env)) {
    throw new Error("设置了 ACCESS_PASSWORD 时必须配置 GATE_SECRET");
  }
  const expiresAt = Date.now() + COOKIE_MAX_AGE_S * 1000;
  const signature = await hmacHex(env.GATE_SECRET, String(expiresAt));
  return `${expiresAt}.${signature}`;
}

export async function cookieValueValid(env: Env, value: string | undefined): Promise<boolean> {
  if (!env.GATE_SECRET || !value) return false;
  const dotIndex = value.indexOf(".");
  if (dotIndex <= 0) return false;
  const expiresPart = value.slice(0, dotIndex);
  const signature = value.slice(dotIndex + 1);
  const expiresAt = Number(expiresPart);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = await hmacHex(env.GATE_SECRET, expiresPart);
  return safeEqual(signature, expected);
}

export function gateCookie(value: string): string {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_S}`;
}

export function clearGateCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** 从请求 Cookie 头判断当前请求是否已通过密码门 */
export async function requestUnlocked(env: Env, request: Request): Promise<boolean> {
  if (!gateRequired(env)) return true;
  const header = request.headers.get("cookie") ?? "";
  const pair = header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  const value = pair === undefined ? undefined : pair.slice(COOKIE_NAME.length + 1);
  return cookieValueValid(env, value);
}

// ---- 失败限速(KV 计数, IP 维度) ----

function rlKey(ip: string): string {
  return `rl:${ip}`;
}

/** true = 允许尝试 */
export async function rateLimitAllow(env: Env, ip: string): Promise<boolean> {
  const raw = await env.GATE.get(rlKey(ip));
  if (raw === null) return true;
  const count = Number(raw);
  return !Number.isFinite(count) || count < RATELIMIT_MAX;
}

export async function rateLimitRecordFailure(env: Env, ip: string): Promise<void> {
  const raw = await env.GATE.get(rlKey(ip));
  const count = raw === null ? 0 : Number(raw);
  const next = Number.isFinite(count) ? count + 1 : 1;
  await env.GATE.put(rlKey(ip), String(next), { expirationTtl: RATELIMIT_WINDOW_S });
}

export async function rateLimitReset(env: Env, ip: string): Promise<void> {
  await env.GATE.delete(rlKey(ip));
}
