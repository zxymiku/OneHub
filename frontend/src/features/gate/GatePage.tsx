import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, apiPost } from "../../shared/api/client";
import { useGate } from "../../shared/gate/GateContext";
import s from "./GatePage.module.css";

/**
 * 站点访问密码门(契约 docs/api.md §2)。
 * worker 侧限速: 10 分钟内 5 次错误后返回 429 GATE_RATELIMITED, 文案随错误码区分展示
 */
export function GatePage() {
  const { refresh, error: gateError } = useGate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    setErrorCode(null);
    try {
      await apiPost("/api/gate/verify", { password });
      setPassword("");
      refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setErrorCode(err.code);
      } else {
        setError("验证失败, 请稍后再试");
        setErrorCode("UNKNOWN");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const rateLimited = errorCode === "GATE_RATELIMITED";

  return (
    <section className={s.gate}>
      <div className={s.stageArt} aria-hidden="true">
        <span className={s.artWedge} />
        <span className={s.artWedgeSecond} />
        <span className={s.artLock}>LOCKED</span>
      </div>

      <form className={s.panel} onSubmit={(e) => void onSubmit(e)}>
        <p className={`ark-micro ${s.eyebrow}`}>
          <span className={s.eyebrowMark} aria-hidden="true" />
          ACCESS GATE · RESTRICTED FIELD
        </p>
        <h1 className={s.title}>
          此站点
          <br />
          已开启访问密码
        </h1>
        <p className={s.lead}>输入站点访问密码以进入。密码由站点部署者设置。</p>

        <label className={`ark-micro ${s.fieldLabel}`} htmlFor="gate-password">
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
          disabled={rateLimited}
        />

        {gateError ? (
          <p className={s.error} role="alert">
            无法连接服务器: {gateError}
          </p>
        ) : error ? (
          <p className={`${s.error} ${rateLimited ? s.errorRate : ""}`} role="alert">
            {error}
          </p>
        ) : null}

        <button type="submit" className={s.action} disabled={submitting || rateLimited}>
          {submitting ? "验证中…" : rateLimited ? "请稍后再试" : "解锁进入 →"}
        </button>
        <p className={`ark-micro ${s.footnote}`}>ONEHUB · 访问尝试受频率保护</p>
      </form>
    </section>
  );
}
