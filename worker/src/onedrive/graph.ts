import { getAccessToken } from "./auth";
import { markAccountInvalid } from "../config/registry";
import type { AccountRecord, Env, ItemDTO } from "../types";
import { AuthInvalidError, GraphClientError, UpstreamError } from "../lib/http";

const GRAPH = "https://graph.microsoft.com/v1.0";
/** 目录聚合硬上限, 防止异常巨目录拖垮免费额度 */
const MAX_ITEMS = 5000;
const MAX_PAGES = 25;

interface GraphItem {
  id?: string;
  name?: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: Record<string, unknown>;
  file?: { mimeType?: string };
  "@microsoft.graph.downloadUrl"?: string;
}

interface GraphListResponse {
  value?: GraphItem[];
  "@odata.nextLink"?: string;
}

/** business 走 /users/{upn}/drive, personal 走 /me/drive */
function driveRoot(account: AccountRecord): string {
  return account.type === "personal"
    ? `${GRAPH}/me/drive`
    : `${GRAPH}/users/${encodeURIComponent(account.upn ?? "")}/drive`;
}

/** 归一化用户输入路径: 去空段/`.`/反斜杠, 拒绝 `:`(与 Graph root: 语法冲突) */
export function normalizePath(path: string | undefined): string {
  if (!path) return "/";
  const segments = path
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s.length > 0 && s !== ".");
  if (segments.some((s) => s.includes(":"))) {
    throw new GraphClientError(400, "BAD_PATH", "路径包含非法字符");
  }
  return `/${segments.join("/")}`;
}

/** 路径 → Graph root:{path}: 语法(冒号后带引导斜杠), 逐段编码保留分隔符 */
function encodeGraphPath(normalized: string): string {
  if (normalized === "/") return "/root";
  const encoded = normalized
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `/root:/${encoded}:`;
}

function toDTO(item: GraphItem): ItemDTO | null {
  if (!item.id || !item.name) return null;
  return {
    id: item.id,
    name: item.name,
    size: item.folder ? null : (item.size ?? 0),
    isFolder: Boolean(item.folder),
    lastModifiedDateTime: item.lastModifiedDateTime ?? "",
    mimeType: item.file?.mimeType ?? null,
  };
}

/**
 * 带 token 的 Graph GET: 401 时强制刷新重试一次, 再失败标记账号失效;
 * 404 → GraphClientError, 429/5xx → UpstreamError。
 */
async function graphJson<T>(env: Env, account: AccountRecord, url: string): Promise<T> {
  const doFetch = async (token: string): Promise<Response> =>
    fetch(url, { headers: { authorization: `Bearer ${token}` } });

  let res = await doFetch(await getAccessToken(env, account));
  if (res.status === 401) {
    res = await doFetch(await getAccessToken(env, account, { forceRefresh: true }));
  }

  if (res.ok) {
    return (await res.json()) as T;
  }
  if (res.status === 401) {
    await markAccountInvalid(env.ACCOUNTS, account);
    throw new AuthInvalidError();
  }
  if (res.status === 404) {
    throw new GraphClientError(404, "NOT_FOUND", "文件或目录不存在");
  }
  if (res.status === 429) {
    throw new UpstreamError("请求过于频繁, 请稍后再试");
  }
  if (res.status >= 400 && res.status < 500) {
    throw new GraphClientError(res.status, "GRAPH_REQUEST", "OneDrive 请求失败, 请稍后再试");
  }
  throw new UpstreamError();
}

/** 列目录: Worker 侧聚合 @odata.nextLink 分页后一次返回(契约 docs/api.md §4) */
export async function listChildren(env: Env, account: AccountRecord, normalizedPath: string): Promise<ItemDTO[]> {
  const firstUrl = `${driveRoot(account)}${encodeGraphPath(normalizedPath)}/children?$top=200&$select=id,name,size,lastModifiedDateTime,folder,file`;
  const items: ItemDTO[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; url !== null && page < MAX_PAGES; page += 1) {
    const data: GraphListResponse = await graphJson<GraphListResponse>(env, account, url);
    for (const item of data.value ?? []) {
      const dto = toDTO(item);
      if (dto) items.push(dto);
      if (items.length >= MAX_ITEMS) return items;
    }
    url = data["@odata.nextLink"] ?? null;
  }
  return items;
}

export interface FullItem {
  meta: ItemDTO;
  downloadUrl: string | null;
}

/** 单文件元数据 + 预授权临时直链(@microsoft.graph.downloadUrl) */
export async function getItem(env: Env, account: AccountRecord, itemId: string): Promise<FullItem> {
  if (!/^[A-Za-z0-9!_.~-]+$/.test(itemId)) {
    throw new GraphClientError(400, "BAD_ITEM_ID", "文件 ID 不合法");
  }
  const data = await graphJson<GraphItem>(env, account, `${driveRoot(account)}/items/${encodeURIComponent(itemId)}`);
  const meta = toDTO(data);
  if (!meta) throw new UpstreamError("OneDrive 返回了异常数据");
  return { meta, downloadUrl: data["@microsoft.graph.downloadUrl"] ?? null };
}
