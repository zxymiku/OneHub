import { describe, expect, it } from "vitest";
import { extensionOf, formatDate, formatSize, splitPath } from "../src/shared/format";

describe("formatSize", () => {
  it("文件夹(null)显示破折号", () => {
    expect(formatSize(null)).toBe("—");
  });

  it("字节与进位", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(3.5 * 1024 * 1024 * 1024)).toBe("3.5 GB");
  });
});

describe("formatDate", () => {
  it("ISO → YYYY-MM-DD", () => {
    expect(formatDate("2026-08-01T12:34:56Z")).toBe("2026-08-01");
  });

  it("空值与非法值 → 破折号", () => {
    expect(formatDate("")).toBe("—");
    expect(formatDate("not-a-date")).toBe("—");
  });
});

describe("splitPath", () => {
  it("拆分并忽略空段", () => {
    expect(splitPath("/相册/2026/")).toEqual(["相册", "2026"]);
    expect(splitPath("/")).toEqual([]);
  });
});

describe("extensionOf", () => {
  it("取小写扩展名", () => {
    expect(extensionOf("报告.DOCX")).toBe("docx");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
  });

  it("无扩展名/点文件 → 空串", () => {
    expect(extensionOf("README")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("file.")).toBe("");
  });
});
