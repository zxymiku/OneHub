import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** 统一错误结构(契约 docs/api.md §0) */
export function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

export function jsonError(c: Context, status: ContentfulStatusCode, code: string, message: string): Response {
  return c.json(errorBody(code, message), status);
}

/** 账号授权失效(需要重新跑脚本授权) */
export class AuthInvalidError extends Error {
  constructor(message = "账号授权已失效, 请重新添加该账号") {
    super(message);
    this.name = "AuthInvalidError";
  }
}

/** Graph 返回 4xx(资源不存在等) */
export class GraphClientError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status as ContentfulStatusCode;
    this.code = code;
    this.name = "GraphClientError";
  }
}

/** Graph 5xx / 网络故障 */
export class UpstreamError extends Error {
  constructor(message = "OneDrive 服务暂时不可用, 请稍后再试") {
    super(message);
    this.name = "UpstreamError";
  }
}

/** 常量时间字符串比较: 先哈希成定长摘要, 避免泄漏长度/前缀信息 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= bytesA[i]! ^ bytesB[i]!;
  }
  return diff === 0;
}
