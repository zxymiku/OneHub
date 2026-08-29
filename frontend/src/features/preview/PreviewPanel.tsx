import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import "highlight.js/styles/github.css";
import { marked } from "marked";
import type { ItemDTO, FileMetaDTO } from "../../shared/api/types";
import { ApiError } from "../../shared/api/client";
import { formatSize } from "../../shared/format";
import { officeViewerUrl, previewKindOf, UNSUPPORTED_MESSAGE } from "../../shared/fileTypes";
import type { PreviewKind } from "../../shared/fileTypes";
import s from "./PreviewPanel.module.css";

const KIND_LABEL: Record<PreviewKind, string> = {
  markdown: "MARKDOWN",
  text: "纯文本",
  pdf: "PDF 文档",
  image: "图片",
  video: "视频",
  audio: "音频",
  word: "Word 文档",
  excel: "Excel 表格",
  powerpoint: "PPT 演示",
  unsupported: "不支持的类型",
};

async function fetchRawText(accountId: string, itemId: string): Promise<string> {
  const res = await fetch(
    `/api/accounts/${encodeURIComponent(accountId)}/raw/${encodeURIComponent(itemId)}`,
    { credentials: "same-origin" },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? `读取失败(HTTP ${res.status})`);
  }
  return res.text();
}

/** 文本/markdown 正文拉取(raw 代理, ≤2MB) */
function useRawText(accountId: string, itemId: string, enabled: boolean) {
  const [state, setState] = useState<{ text: string | null; error: string | null; loading: boolean }>({
    text: null,
    error: null,
    loading: enabled,
  });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ text: null, error: null, loading: true });
    fetchRawText(accountId, itemId)
      .then((text) => {
        if (!cancelled) setState({ text, error: null, loading: false });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ text: null, error: err.message, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, itemId, enabled]);
  return state;
}

/** 直链媒体(视频/音频)编解码失败兜底 */
function useMediaError() {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), []);
  return { failed, markFailed: () => setFailed(true) };
}

function TextView({ text }: { text: string }) {
  return <pre className={s.text}>{text}</pre>;
}

function MarkdownView({ text }: { text: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false }) as string), [text]);
  useEffect(() => {
    // DOMPurify 已消毒, 这里只做代码高亮; hljs 体积大, 按需加载
    const root = bodyRef.current;
    if (!root) return;
    let cancelled = false;
    void import("highlight.js/lib/common").then(({ default: hljs }) => {
      if (cancelled) return;
      root.querySelectorAll("pre code").forEach((block) => {
        hljs.highlightElement(block as HTMLElement);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [html]);
  return <div ref={bodyRef} className={s.markdown} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 预览面板(契约 docs/api.md §5/§7)。每次打开现取直链, 不缓存(plan.md §5 失败模式) */
export function PreviewPanel({
  accountId,
  item,
  onClose,
}: {
  accountId: string;
  item: ItemDTO;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<FileMetaDTO | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setMetaError(null);
    fetch(`/api/accounts/${encodeURIComponent(accountId)}/file/${encodeURIComponent(item.id)}`, {
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { message: string } } | null;
          throw new Error(body?.error?.message ?? `获取文件信息失败(HTTP ${res.status})`);
        }
        return res.json() as Promise<FileMetaDTO>;
      })
      .then((data) => {
        if (!cancelled) setMeta(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setMetaError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, item.id]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const kind = previewKindOf(item.name, meta?.mimeType);
  const needsRaw = kind === "markdown" || kind === "text";
  const raw = useRawText(accountId, item.id, Boolean(meta) && needsRaw);
  const media = useMediaError();

  const downloadHref = `/api/accounts/${encodeURIComponent(accountId)}/download/${encodeURIComponent(item.id)}`;

  let body: React.ReactNode;
  if (metaError) {
    body = <Fallback title={metaError} downloadHref={downloadHref} name={item.name} />;
  } else if (!meta) {
    body = <p className="ark-micro">正在获取文件信息…</p>;
  } else {
    switch (kind) {
      case "markdown":
      case "text": {
        if (raw.loading) body = <p className="ark-micro">正在读取内容…</p>;
        else if (raw.error) body = <Fallback title={raw.error} downloadHref={downloadHref} name={item.name} />;
        else if (kind === "markdown" && raw.text !== null) body = <MarkdownView text={raw.text} />;
        else body = <TextView text={raw.text ?? ""} />;
        break;
      }
      case "pdf":
        body = <iframe className={s.frame} src={meta.downloadUrl} title={item.name} />;
        break;
      case "image":
        body = (
          <div className={s.center}>
            <img className={s.image} src={meta.downloadUrl} alt={item.name} />
          </div>
        );
        break;
      case "video":
        body = media.failed ? (
          <Fallback title="浏览器无法解码此视频编码" downloadHref={downloadHref} name={item.name} />
        ) : (
          <video className={s.media} controls src={meta.downloadUrl} onError={media.markFailed}>
            <track kind="captions" />
          </video>
        );
        break;
      case "audio":
        body = media.failed ? (
          <Fallback title="浏览器无法解码此音频编码" downloadHref={downloadHref} name={item.name} />
        ) : (
          <div className={s.center}>
            <audio controls src={meta.downloadUrl} onError={media.markFailed} className={s.audio}>
              <track kind="captions" />
            </audio>
          </div>
        );
        break;
      case "word":
      case "excel":
      case "powerpoint":
        body = (
          <div className={s.officeWrap}>
            <p className={`ark-micro ${s.officeNote}`}>由微软 Office 在线渲染 · 大文件可能无法预览</p>
            <iframe className={s.frame} src={officeViewerUrl(meta.downloadUrl)} title={item.name} />
          </div>
        );
        break;
      default:
        body = <Fallback title={UNSUPPORTED_MESSAGE} downloadHref={downloadHref} name={item.name} primary />;
    }
  }

  return (
    <div
      className={s.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${item.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={s.panel}>
        <header className={s.head}>
          <span className={s.marker} aria-hidden="true" />
          <div className={s.headText}>
            <span className={s.name}>{item.name}</span>
            <span className="ark-micro">
              {KIND_LABEL[kind]} · {formatSize(item.size)}
            </span>
          </div>
          <a className={s.headAction} href={downloadHref} aria-label={`下载 ${item.name}`}>
            ↓ 下载
          </a>
          <button ref={closeRef} type="button" className={s.close} onClick={onClose} aria-label="关闭预览">
            ✕
          </button>
        </header>
        <div className={s.body}>{body}</div>
      </div>
    </div>
  );
}

function Fallback({
  title,
  downloadHref,
  name,
  primary = false,
}: {
  title: string;
  downloadHref: string;
  name: string;
  primary?: boolean;
}) {
  return (
    <div className={`${s.fallback} ${primary ? s.fallbackPrimary : ""}`}>
      <p className={s.fallbackTitle}>{title}</p>
      <a className={s.fallbackAction} href={downloadHref} aria-label={`下载 ${name}`}>
        下载查看
      </a>
    </div>
  );
}
