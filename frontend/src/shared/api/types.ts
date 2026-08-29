/**
 * API 类型定义 — docs/api.md 契约的前端镜像(唯一事实来源是 docs/api.md)
 */

export interface SafeAccount {
  id: string;
  name: string;
  type: "personal" | "business";
  status: "active" | "invalid";
}

export interface AccountsResponse {
  accounts: SafeAccount[];
}

export interface ItemDTO {
  id: string;
  name: string;
  /** 文件夹恒为 null */
  size: number | null;
  isFolder: boolean;
  lastModifiedDateTime: string;
  mimeType: string | null;
}

export interface ItemsResponse {
  path: string;
  items: ItemDTO[];
}

export interface FileMetaDTO extends ItemDTO {
  downloadUrl: string;
}

export interface GateStatus {
  required: boolean;
  unlocked: boolean;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
