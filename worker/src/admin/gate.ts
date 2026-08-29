import type { Env } from "../types";
import { safeEqual } from "../lib/http";

const COOKIE_NAME = "onehub_admin";
/** 管理 Cookie 有效期 2 小时(短于访客门的 7 天) */
const COOKIE_MAX_AGE_S = 2 * 60 * 60;

/** 管理登录限速: 10 分钟窗口内最多 5 次错误尝试 */
const RATELIMIT_MAX = 5;
const RATELIMIT_WINDOW_S = 600;

export function adminEnabled(env: Env): boolean {
  return Boolean(env.ADMIN_PASSWORD);
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

export async function verifyAdminPassword(env: Env, candidate: string): Promise<boolean> {
  if (!env.ADMIN_PASSWORD) return false;
  return safeEqual(candidate, env.ADMIN_PASSWORD);
}

/** 签发管理 Cookie 值: `<过期时间戳>.<HMAC>`(无状态) */
export async function issueAdminCookieValue(env: Env): Promise<string> {
  if (!env.ADMIN_PASSWORD || !env.GATE_SECRET) {
    throw new Error("启用管理台需要 ADMIN_PASSWORD 与 GATE_SECRET");
  }
  const expiresAt = Date.now() + COOKIE_MAX_AGE_S * 1000;
  const signature = await hmacHex(env.GATE_SECRET, `admin:${expiresAt}`);
  return `${expiresAt}.${signature}`;
}

export async function adminCookieValid(env: Env, value: string | undefined): Promise<boolean> {
  if (!env.GATE_SECRET || !value) return false;
  const dotIndex = value.indexOf(".");
  if (dotIndex <= 0) return false;
  const expiresPart = value.slice(0, dotIndex);
  const signature = value.slice(dotIndex + 1);
  const expiresAt = Number(expiresPart);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  const expected = await hmacHex(env.GATE_SECRET, `admin:${expiresPart}`);
  return safeEqual(signature, expected);
}

export function adminCookie(value: string): string {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE_S}`;
}

export function clearAdminCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function adminRequestUnlocked(env: Env, request: Request): Promise<boolean> {
  if (!adminEnabled(env)) return false;
  const header = request.headers.get("cookie") ?? "";
  const pair = header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  const value = pair === undefined ? undefined : pair.slice(COOKIE_NAME.length + 1);
  return adminCookieValid(env, value);
}

// ---- 登录限速(GATE KV, 与访客门分键) ----

function rlKey(ip: string): string {
  return `rl-admin:${ip}`;
}

export async function adminRateLimitAllow(env: Env, ip: string): Promise<boolean> {
  const raw = await env.GATE.get(rlKey(ip));
  if (raw === null) return true;
  const count = Number(raw);
  return !Number.isFinite(count) || count < RATELIMIT_MAX;
}

export async function adminRateLimitRecordFailure(env: Env, ip: string): Promise<void> {
  const raw = await env.GATE.get(rlKey(ip));
  const count = raw === null ? 0 : Number(raw);
  const next = Number.isFinite(count) ? count + 1 : 1;
  await env.GATE.put(rlKey(ip), String(next), { expirationTtl: RATELIMIT_WINDOW_S });
}

export async function adminRateLimitReset(env: Env, ip: string): Promise<void> {
  await env.GATE.delete(rlKey(ip));
}
