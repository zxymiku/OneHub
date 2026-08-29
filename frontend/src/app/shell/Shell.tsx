import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import s from "./Shell.module.css";
import { useGate } from "../../shared/gate/GateContext";
import { apiDelete } from "../../shared/api/client";

/** 全局应用壳: 竖排浅色 rail + 顶栏 + 舞台 + 底部炭黑仪表 dock(endfield 壳层语法) */
export function Shell({ children }: { children: ReactNode }) {
  const { status: gate, error: gateError, refresh } = useGate();
  const [online, setOnline] = useState<boolean | null>(null);
  const [adminEnabled, setAdminEnabled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((res) => {
        if (!cancelled) setOnline(res.ok);
      })
      .catch(() => {
        if (!cancelled) setOnline(false);
      });
    fetch("/api/admin/status")
      .then((res) => res.json())
      .then((body: { enabled?: boolean }) => {
        if (!cancelled) setAdminEnabled(Boolean(body.enabled));
      })
      .catch(() => {
        /* 管理台状态获取失败时隐藏入口 */
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  const viewLabel = location.pathname === "/" ? "HUB / 账号矩阵" : `LINK ${location.pathname}`;

  async function lockAgain() {
    try {
      await apiDelete("/api/gate/verify");
    } finally {
      refresh();
    }
  }

  return (
    <div className={s.shell}>
      <a className="ark-skip-link" href="#stage">
        跳到主内容
      </a>
      <aside className={s.rail} aria-label="站点导航">
        <Link to="/" className={s.railMark} aria-label="OneHub 首页">
          OH
        </Link>
        <span className={s.railVertical} aria-hidden="true">
          ONEHUB · FIELD LINK
        </span>
        <Link to="/" className={s.railHome}>
          <span aria-hidden="true" className={s.railHomeGlyph} />
          <span className="ark-micro">首页</span>
        </Link>
      </aside>

      <div className={s.frame}>
        <header className={s.topbar}>
          <span className={`ark-micro ${s.topbarView}`}>{viewLabel}</span>
          <span className={s.topbarRight}>
            {adminEnabled && location.pathname !== "/admin" ? (
              <Link to="/admin" className={`ark-micro ${s.adminLink}`}>
                管理
              </Link>
            ) : null}
            {gate?.required ? (
              gate.unlocked ? (
                <button type="button" className={`ark-micro ${s.chipState}`} onClick={() => void lockAgain()} title="重新锁定站点">
                  已解锁 · 点击锁定
                </button>
              ) : (
                <span className={`ark-micro ${s.chipWarn}`}>已锁定</span>
              )
            ) : null}
            {gateError ? <span className={`ark-micro ${s.chipWarn}`}>离线</span> : null}
          </span>
        </header>

        <main id="stage" className={s.stage}>
          {children}
        </main>

        <footer className={s.dock}>
          <span className={s.dockCell}>
            <span
              className={`${s.dockDot} ${online === null ? "" : online ? s.dockDotOn : s.dockDotOff}`}
              aria-hidden="true"
            />
            <span className="ark-micro">{online === false ? "服务不可达" : "ONEHUB"}</span>
          </span>
          <span className={`ark-micro ${s.dockCell}`}>SYSTEM READY</span>
          <span className={`ark-micro ${s.dockTail}`}>ARK-UI · ENDFIELD · MAXIMAL</span>
        </footer>
      </div>
    </div>
  );
}
