/**
 * 预览类型判定矩阵(plan.md §6)。
 * 扩展名优先;扩展名无法识别时退化用 Graph mimeType 兜底。
 */

export type PreviewKind =
  | "markdown"
  | "text"
  | "pdf"
  | "image"
  | "video"
  | "audio"
  | "word"
  | "excel"
  | "powerpoint"
  | "unsupported";

export const UNSUPPORTED_MESSAGE = "此文件类型不支持在线预览,请下载后查看";

const BY_EXTENSION: Record<string, PreviewKind> = {
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  log: "text",
  json: "text",
  xml: "text",
  yml: "text",
  yaml: "text",
  csv: "text",
  tsv: "text",
  ini: "text",
  conf: "text",
  toml: "text",
  sql: "text",
  // html/xml 源码按纯文本展示, 不渲染, 避免注入面
  html: "text",
  htm: "text",
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  avif: "image",
  ico: "image",
  mp4: "video",
  webm: "video",
  ogv: "video",
  m4v: "video",
  mov: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  flac: "audio",
  m4a: "audio",
  aac: "audio",
  opus: "audio",
  docx: "word",
  xlsx: "excel",
  pptx: "powerpoint",
  // 旧版 Office 格式微软在线渲染不支持 → 明确落入不支持
};

const MIME_PREFIX_KIND: Array<{ prefix: string; kind: PreviewKind }> = [
  { prefix: "image/", kind: "image" },
  { prefix: "video/", kind: "video" },
  { prefix: "audio/", kind: "audio" },
  { prefix: "text/plain", kind: "text" },
  { prefix: "text/markdown", kind: "markdown" },
  { prefix: "text/csv", kind: "text" },
  { prefix: "application/pdf", kind: "pdf" },
  { prefix: "application/json", kind: "text" },
];

/** 判定文件的预览方式 */
export function previewKindOf(name: string, mimeType?: string | null): PreviewKind {
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) {
    const ext = name.slice(dot + 1).toLowerCase();
    const kind = BY_EXTENSION[ext];
    if (kind) return kind;
  }
  if (mimeType) {
    const lower = mimeType.toLowerCase();
    for (const entry of MIME_PREFIX_KIND) {
      if (lower.startsWith(entry.prefix)) return entry.kind;
    }
    if (lower.includes("wordprocessingml")) return "word";
    if (lower.includes("spreadsheetml")) return "excel";
    if (lower.includes("presentationml")) return "powerpoint";
  }
  return "unsupported";
}

/** 微软官方 Office 在线渲染(需可公开访问的临时直链, Worker 侧每次现取) */
export function officeViewerUrl(downloadUrl: string): string {
  return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(downloadUrl)}`;
}
