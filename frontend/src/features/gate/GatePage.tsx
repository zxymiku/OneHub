import { useState } from "react";
import type { FormEvent } from "react";
import { apiPost } from "../../shared/api/client";
import { useGate } from "../../shared/gate/GateContext";
import s from "./GatePage.module.css";

/** 站点访问密码门(契约 docs/api.md §2)。PR-7 将升级完整 endfield 构图与限速文案 */
export function GatePage() {
  const { refresh } = useGate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiPost("/api/gate/verify", { password });
      setPassword("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className={s.gate}>
      <form className={s.panel} onSubmit={(e) => void onSubmit(e)}>
        <p className="ark-micro">ACCESS GATE · 访问验证</p>
        <h1 className={s.title}>此站点已开启访问密码</h1>
        <label className={s.fieldLabel} htmlFor="gate-password">
          访问密码
        </label>
        <input
          id="gate-password"
          className={s.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          required
        />
        {error ? (
          <p className={s.error} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={s.action} disabled={submitting}>
          {submitting ? "验证中…" : "进入 OneHub"}
        </button>
      </form>
    </section>
  );
}
