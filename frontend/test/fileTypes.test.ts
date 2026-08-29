import { describe, expect, it } from "vitest";
import { officeViewerUrl, previewKindOf, UNSUPPORTED_MESSAGE } from "../src/shared/fileTypes";

describe("previewKindOf(按扩展名)", () => {
  it("文档三件套", () => {
    expect(previewKindOf("报告.docx")).toBe("word");
    expect(previewKindOf("报表.XLSX")).toBe("excel");
    expect(previewKindOf("演示.pptx")).toBe("powerpoint");
  });

  it("旧版 Office 明确不支持", () => {
    expect(previewKindOf("老文档.doc")).toBe("unsupported");
    expect(previewKindOf("老表格.xls")).toBe("unsupported");
    expect(previewKindOf("老幻灯.ppt")).toBe("unsupported");
  });

  it("markdown / 文本 / pdf", () => {
    expect(previewKindOf("笔记.md")).toBe("markdown");
    expect(previewKindOf("日志.log")).toBe("text");
    expect(previewKindOf("说明书.pdf")).toBe("pdf");
    expect(previewKindOf("页面.html")).toBe("text");
  });

  it("媒体与图片", () => {
    expect(previewKindOf("电影.mp4")).toBe("video");
    expect(previewKindOf("录音.flac")).toBe("audio");
    expect(previewKindOf("照片.JPEG")).toBe("image");
  });
});

describe("previewKindOf(mimeType 兜底)", () => {
  it("无扩展名时用 mimeType 判定", () => {
    expect(previewKindOf("unknown-file", "video/mp4")).toBe("video");
    expect(previewKindOf("unknown-file", "image/png")).toBe("image");
    expect(previewKindOf("unknown-file", "application/pdf")).toBe("pdf");
    expect(previewKindOf("无扩展名", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("word");
  });

  it("完全未知 → unsupported", () => {
    expect(previewKindOf("程序.exe", "application/octet-stream")).toBe("unsupported");
    expect(previewKindOf("无扩展名", null)).toBe("unsupported");
  });
});

describe("officeViewerUrl", () => {
  it("直链整体 URL 编码", () => {
    const url = officeViewerUrl("https://dl.example.com/a b/文件.docx?tempauth=abc&x=1");
    expect(url.startsWith("https://view.officeapps.live.com/op/view.aspx?src=")).toBe(true);
    const encoded = url.split("src=")[1]!;
    expect(decodeURIComponent(encoded)).toBe("https://dl.example.com/a b/文件.docx?tempauth=abc&x=1");
    expect(encoded).not.toContain(" ");
  });
});

describe("文案契约(需求 3)", () => {
  it("不支持提示语与需求一致", () => {
    expect(UNSUPPORTED_MESSAGE).toBe("此文件类型不支持在线预览,请下载后查看");
  });
});
