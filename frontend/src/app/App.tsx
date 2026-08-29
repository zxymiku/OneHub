import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "./shell/Shell";
import { AccountsPage } from "../features/accounts/AccountsPage";
import { GatePage } from "../features/gate/GatePage";
import { GateProvider, useGate } from "../shared/gate/GateContext";

/** 浏览页占位: 由 PR-5(feat/browse)替换为完整实现 */
function BrowsePlaceholder() {
  return (
    <section className="ark-reveal">
      <h2 style={{ fontSize: "clamp(28px, 5vw, 44px)" }}>文件浏览模块接入中</h2>
      <p className="ark-micro">PR-5 / FEAT-BROWSE 将交付目录导航与文件列表</p>
    </section>
  );
}

function BootView({ error }: { error: string | null }) {
  return (
    <section className="ark-reveal">
      <p className="ark-micro">{error ?? "正在连接 OneHub 服务…"}</p>
    </section>
  );
}

/** 视图分发: 密码门锁定时整站只渲染门页(docs/api.md §0) */
function CurrentView() {
  const { status, error } = useGate();
  if (!status) return <BootView error={error} />;
  if (status.required && !status.unlocked) return <GatePage />;
  return (
    <Routes>
      <Route path="/" element={<AccountsPage />} />
      <Route path="/a/:accountId/*" element={<BrowsePlaceholder />} />
      <Route
        path="*"
        element={
          <section className="ark-reveal">
            <h2 style={{ fontSize: "clamp(28px, 5vw, 44px)" }}>页面不存在</h2>
            <p className="ark-micro">检查地址, 或从首页重新进入</p>
          </section>
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <GateProvider>
        <Shell>
          <CurrentView />
        </Shell>
      </GateProvider>
    </BrowserRouter>
  );
}
