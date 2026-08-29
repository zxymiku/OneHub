import { describe, expect, it } from "vitest";
import type { AccountRecord } from "../src/lib";
import { maskAccount, mergeIndex, newId, parseArgs, requireFlag } from "../src/lib";

describe("parseArgs", () => {
  it("解析 --key value 与 --key=value 与布尔开关", () => {
    const flags = parseArgs([
      "--name",
      "一号机",
      "--type=business",
      "--remote",
      "--client-id",
      "abc-123",
    ]);
    expect(flags).toEqual({
      name: "一号机",
      type: "business",
      remote: true,
      "client-id": "abc-123",
    });
  });

  it("忽略位置参数", () => {
    expect(parseArgs(["add", "--name", "x"])).toEqual({ name: "x" });
  });
});

describe("requireFlag", () => {
  it("缺失时给出中文提示", () => {
    expect(() => requireFlag({}, "client-id", "应用程序ID")).toThrow("缺少 --client-id");
  });

  it("布尔值视为缺失", () => {
    expect(() => requireFlag({ name: true }, "name", "展示名")).toThrow("缺少 --name");
  });
});

describe("maskAccount", () => {
  it("绝不输出密钥原文", () => {
    const record: AccountRecord = {
      id: "p1",
      name: "一号机",
      type: "personal",
      status: "active",
      createdAt: "2026-08-29T00:00:00Z",
      clientId: "client-id-long-secret",
      refreshToken: "refresh-token-secret",
    };
    const view = maskAccount(record);
    expect(JSON.stringify(view)).not.toContain("refresh-token-secret");
    expect(view.hasSecret).toBe(true);
    expect(view.clientId).toBe("client…");
  });

  it("business 密钥同样只显示存在性", () => {
    const record: AccountRecord = {
      id: "b1",
      name: "账号2",
      type: "business",
      status: "active",
      createdAt: "2026-08-29T00:00:00Z",
      clientSecret: "super-secret-value",
      upn: "a@b.c",
    };
    const view = maskAccount(record);
    expect(JSON.stringify(view)).not.toContain("super-secret-value");
    expect(view.hasSecret).toBe(true);
  });
});

describe("mergeIndex", () => {
  it("去重并保持追加语义(同名覆盖时移到末尾)", () => {
    expect(mergeIndex(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(mergeIndex(["a", "b", "c"], "b")).toEqual(["a", "c", "b"]);
  });
});

describe("newId", () => {
  it("生成 8 位十六进制 id 且不重复", () => {
    const a = newId();
    const b = newId();
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });
});
