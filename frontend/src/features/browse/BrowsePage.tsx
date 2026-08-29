import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { ItemDTO, SafeAccount } from "../../shared/api/types";
import { apiGet } from "../../shared/api/client";
import { useItems } from "../../shared/api/useItems";
import { extensionOf, formatDate, formatSize, splitPath } from "../../shared/format";
import { PreviewPanel } from "../preview/PreviewPanel";
import s from "./BrowsePage.module.css";

type SortKey = "name" | "size" | "date";

function useAccountName(accountId: string): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiGet<{ accounts: SafeAccount[] }>("/api/accounts")
      .then((body) => {
        if (!cancelled) {
          setName(body.accounts.find((a) => a.id === accountId)?.name ?? null);
        }
      })
      .catch(() => {
        /* 名称缺失不阻断浏览 */
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);
  return name;
}

/** 文件浏览页(契约 docs/api.md §4; 下载 §6)。列表屏按契约降为 complex 密度 */
export function BrowsePage() {
  const { accountId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const path = normalizePathParam(searchParams.get("path"));
  const { items, error, errorCode, loading, reload } = useItems(accountId, path);
  const accountName = useAccountName(accountId);

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState("");
  const [previewItem, setPreviewItem] = useState<ItemDTO | null>(null);

  const visible = useMemo(() => {
    const list = (items ?? []).filter((item) => item.name.toLowerCase().includes(filter.toLowerCase()));
    const folderFirst = (a: ItemDTO, b: ItemDTO): number => Number(b.isFolder) - Number(a.isFolder);
    const byKey = (a: ItemDTO, b: ItemDTO): number => {
      if (sortKey === "size") return (a.size ?? 0) - (b.size ?? 0);
      if (sortKey === "date") return a.lastModifiedDateTime.localeCompare(b.lastModifiedDateTime);
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    };
    return [...list].sort((a, b) => folderFirst(a, b) || (sortAsc ? byKey(a, b) : -byKey(a, b)));
  }, [items, filter, sortKey, sortAsc]);

  const segments = splitPath(path);
  const stats = useMemo(() => {
    const folders = visible.filter((i) => i.isFolder).length;
    const files = visible.length - folders;
    const bytes = visible.reduce((sum, i) => sum + (i.size ?? 0), 0);
    return { folders, files, bytes, depth: segments.length };
  }, [visible, segments.length]);

  function go(nextPath: string) {
    setSearchParams({ path: nextPath });
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortAsc((asc) => !asc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const downloadHref = (item: ItemDTO): string =>
    `/api/accounts/${encodeURIComponent(accountId)}/download/${encodeURIComponent(item.id)}`;

  return (
    <div className={s.page}>
      <header className={s.head}>
        <Link to="/" className={s.back}>
          ← HUB
        </Link>
        <div className={s.headMain}>
          <p className="ark-micro">{accountName ?? "网盘"} · FILE FIELD</p>
          <nav className={s.crumbs} aria-label="目录路径">
            <button type="button" className={s.crumb} onClick={() => go("/")}>
              根目录
            </button>
            {segments.map((segment, index) => {
              const target = `/${segments.slice(0, index + 1).join("/")}`;
              const isLast = index === segments.length - 1;
              return (
                <span key={target} className={s.crumbGroup}>
                  <span className={s.crumbSep} aria-hidden="true">
                    /
                  </span>
                  {isLast ? (
                    <span className={`${s.crumb} ${s.crumbCurrent}`} aria-current="location">
                      {segment}
                    </span>
                  ) : (
                    <button type="button" className={s.crumb} onClick={() => go(target)}>
                      {segment}
                    </button>
                  )}
                </span>
              );
            })}
          </nav>
        </div>
        <input
          className={s.filter}
          type="search"
          placeholder="筛选当前目录…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="按名称筛选"
        />
      </header>

      {/* 读出仪表: 由当前目录状态驱动 */}
      <dl className={s.instruments}>
        <div>
          <dt className="ark-micro">层级</dt>
          <dd className="ark-readout">{String(stats.depth).padStart(2, "0")}</dd>
        </div>
        <div>
          <dt className="ark-micro">文件夹</dt>
          <dd className="ark-readout">{String(stats.folders).padStart(2, "0")}</dd>
        </div>
        <div>
          <dt className="ark-micro">文件</dt>
          <dd className="ark-readout">{String(stats.files).padStart(2, "0")}</dd>
        </div>
        <div>
          <dt className="ark-micro">合计</dt>
          <dd className="ark-readout">{formatSize(stats.bytes)}</dd>
        </div>
      </dl>

      {loading ? (
        <div className={s.list} aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={`${s.row} ${s.rowSkeleton}`} />
          ))}
        </div>
      ) : error ? (
        <div className={s.notice}>
          <p className={s.noticeTitle}>{error}</p>
          {errorCode === "ACCOUNT_INVALID" ? (
            <p className="ark-micro">请在服务器上对该账号重新执行 npm run account:add</p>
          ) : null}
          <button type="button" className={s.action} onClick={() => void reload()}>
            重试
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className={s.notice}>
          <p className={s.noticeTitle}>{filter ? "没有匹配的文件" : "此文件夹为空"}</p>
          <p className="ark-micro">EMPTY DIRECTORY</p>
        </div>
      ) : (
        <div className={s.list} data-density="complex">
          <div className={`${s.row} ${s.rowHead}`}>
            <button type="button" className={s.sorter} onClick={() => toggleSort("name")}>
              名称 {sortMark(sortKey === "name", sortAsc)}
            </button>
            <button type="button" className={s.sorter} onClick={() => toggleSort("size")}>
              大小 {sortMark(sortKey === "size", sortAsc)}
            </button>
            <button type="button" className={s.sorter} onClick={() => toggleSort("date")}>
              修改日期 {sortMark(sortKey === "date", sortAsc)}
            </button>
            <span className={s.sorterStub} aria-hidden="true" />
          </div>
          <ul className={s.rows}>
            {visible.map((item) => (
              <li key={item.id}>
                <div className={`${s.row} ${item.isFolder ? "" : s.rowFile}`}>
                  {item.isFolder ? (
                    <button type="button" className={s.name} onClick={() => go(`${path === "/" ? "" : path}/${item.name}`)}>
                      <span className={s.marker} data-kind="folder" aria-hidden="true" />
                      <span className={s.nameText}>{item.name}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={s.name}
                      onClick={() => setPreviewItem(item)}
                      title={`预览 ${item.name}`}
                    >
                      <span className={s.marker} data-kind="file" aria-hidden="true" />
                      <span className={s.nameText}>{item.name}</span>
                      {extensionOf(item.name) ? (
                        <span className={`ark-micro ${s.ext}`}>{extensionOf(item.name)}</span>
                      ) : null}
                    </button>
                  )}
                  <span className={`ark-readout ${s.size}`}>{formatSize(item.size)}</span>
                  <span className={`ark-readout ${s.date}`}>{formatDate(item.lastModifiedDateTime)}</span>
                  {!item.isFolder ? (
                    <a
                      className={s.dl}
                      href={downloadHref(item)}
                      title={`下载 ${item.name}`}
                      aria-label={`下载 ${item.name}`}
                    >
                      ↓
                    </a>
                  ) : (
                    <span className={s.dl} aria-hidden="true" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {previewItem ? (
        <PreviewPanel accountId={accountId} item={previewItem} onClose={() => setPreviewItem(null)} />
      ) : null}
    </div>
  );
}

function normalizePathParam(raw: string | null): string {
  if (!raw) return "/";
  const segments = raw.split("/").filter((s) => s.length > 0 && s !== ".");
  return `/${segments.join("/")}`;
}

function sortMark(active: boolean, asc: boolean): string {
  return active ? (asc ? "↑" : "↓") : "";
}
