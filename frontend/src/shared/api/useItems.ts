import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../api/client";
import type { ItemDTO, ItemsResponse } from "../api/types";

export interface ItemsState {
  items: ItemDTO[] | null;
  error: string | null;
  errorCode: string | null;
  loading: boolean;
}

/** 拉取指定账号某目录的文件列表(契约 docs/api.md §4) */
export function useItems(accountId: string, path: string) {
  const [state, setState] = useState<ItemsState>({ items: null, error: null, errorCode: null, loading: true });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null, errorCode: null }));
    try {
      const body = await apiGet<ItemsResponse>(
        `/api/accounts/${encodeURIComponent(accountId)}/items?path=${encodeURIComponent(path)}`,
      );
      setState({ items: body.items, error: null, errorCode: null, loading: false });
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code: string }).code) : "UNKNOWN";
      setState({
        items: null,
        error: err instanceof Error ? err.message : "加载失败",
        errorCode: code,
        loading: false,
      });
    }
  }, [accountId, path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
