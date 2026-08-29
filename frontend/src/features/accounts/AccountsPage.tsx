import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../../shared/api/client";
import type { AccountsResponse, SafeAccount } from "../../shared/api/types";
import s from "./AccountsPage.module.css";

interface AccountsState {
  accounts: SafeAccount[] | null;
  error: string | null;
  loading: boolean;
}

export function useAccounts() {
  const [state, setState] = useState<AccountsState>({ accounts: null, error: null, loading: true });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const body = await apiGet<AccountsResponse>("/api/accounts");
      setState({ accounts: body.accounts, error: null, loading: false });
    } catch (err) {
      setState({ accounts: null, error: err instanceof Error ? err.message : "加载失败", loading: false });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}

const TYPE_LABEL: Record<SafeAccount["type"], string> = {
  personal: "个人版",
  business: "企业版",
};

export function AccountsPage() {
  const { accounts, error, loading, reload } = useAccounts();
  const count = accounts?.length ?? 0;

  return (
    <div>
      {/* ---- 账号矩阵(首页主体, 不放口号文案) ---- */}
      <section className={s.matrix} aria-label="网盘账号">
        <header className={s.matrixHead}>
          <span className={s.matrixIndex} aria-hidden="true">
            01
          </span>
          <h1 className={s.matrixTitle}>选择网盘</h1>
          <span className={`ark-readout ${s.matrixCount}`}>{String(count).padStart(2, "0")} 个</span>
        </header>

        {loading ? (
          <div className={s.grid} aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`${s.card} ${s.cardSkeleton}`} />
            ))}
          </div>
        ) : error ? (
          <div className={s.notice}>
            <p className={s.noticeTitle}>{error}</p>
            <button type="button" className={s.action} onClick={() => void reload()}>
              重试
            </button>
          </div>
        ) : count === 0 ? (
          <div className={s.notice}>
            <p className={s.noticeTitle}>还没有接入任何网盘账号</p>
            <p className="ark-micro">账号由部署者在本地管理台添加, 同步后即可显示</p>
          </div>
        ) : (
          <ul className={s.grid}>
            {accounts!.map((account, index) => (
              <li key={account.id}>
                <Link className={`${s.card} ark-reveal`} to={`/a/${account.id}?path=%2F`}>
                  <span className={s.cardIndex} aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className={s.cardName}>{account.name}</span>
                  <span className={s.cardMeta}>
                    <span className={`ark-micro ${s.cardType}`}>{TYPE_LABEL[account.type]}</span>
                    {account.status === "invalid" ? (
                      <span className={`ark-micro ${s.cardInvalid}`}>授权失效</span>
                    ) : (
                      <span className={`ark-micro ${s.cardEnter}`}>进入 →</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
