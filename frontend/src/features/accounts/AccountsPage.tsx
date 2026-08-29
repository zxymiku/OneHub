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
      {/* ---- HERO: 签名构图(转子舞台 + 超大标题 + 状态读出) ---- */}
      <section className={s.hero}>
        <div className={s.heroCopy}>
          <p className={`ark-micro ${s.heroEyebrow}`}>ONEHUB FIELD SYSTEM · 多盘聚合入口</p>
          <h1 className={s.heroTitle}>
            你的多个
            <br />
            OneDrive
            <span className={s.heroTitleMark}>→</span>
            一个入口
          </h1>
          <p className={s.heroLead}>
            选择一个网盘进入浏览。文件可直接获取 OneDrive 下载直链, 常见文档 / 视频 / 音频支持在线预览。
          </p>
          <dl className={s.heroReadout}>
            <div className={s.readoutCell}>
              <dt className="ark-micro">接入账号</dt>
              <dd className={`ark-readout ${s.readoutValue}`}>{String(count).padStart(2, "0")}</dd>
            </div>
            <div className={s.readoutCell}>
              <dt className="ark-micro">下载方式</dt>
              <dd className={`ark-readout ${s.readoutValue}`}>直链 302</dd>
            </div>
            <div className={s.readoutCell}>
              <dt className="ark-micro">凭据暴露</dt>
              <dd className={`ark-readout ${s.readoutValue}`}>00</dd>
            </div>
          </dl>
        </div>

        {/* 签名视觉: 纯 CSS 转子舞台(不复制任何版权资产) */}
        <div className={s.rotor} aria-hidden="true">
          <span className={s.rotorRing} />
          <span className={s.rotorRingInner} />
          <span className={s.rotorSweep} />
          <span className={s.rotorCross} />
          <span className={s.rotorTag}>LINK-01</span>
        </div>
      </section>

      {/* ---- 账号矩阵 ---- */}
      <section className={s.matrix} aria-label="网盘账号">
        <header className={s.matrixHead}>
          <span className={s.matrixIndex} aria-hidden="true">
            01
          </span>
          <h2 className={s.matrixTitle}>选择网盘</h2>
          <span className="ark-micro">TAP TO LINK</span>
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
            <p className="ark-micro">
              部署者可在服务器上执行 npm run account:add 添加账号, 步骤见 README
            </p>
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
