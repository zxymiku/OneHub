import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../shared/api/admin";
import type { AdminAccount, AdminStatus, DeviceCodeStartDTO } from "../../shared/api/admin";
import { formatDate } from "../../shared/format";
import s from "./AdminPage.module.css";

type Panel = "list" | "add-personal" | "add-business";

/**
 * 网页管理台(/admin): 独立管理密码, 默认关闭(docs/api.md §8)。
 * 个人版 = 设备码流程可视化; 企业版 = 表单直填即验即存。
 */
export function AdminPage() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refreshStatus = useCallback(() => {
    setLoadError(null);
    adminApi
      .status()
      .then(setStatus)
      .catch((err: Error) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  if (loadError) {
    return <Centered title={`无法连接服务器: ${loadError}`} />;
  }
  if (!status) {
    return <Centered title="正在连接…" />;
  }
  if (!status.enabled) {
    return (
      <Centered
        title="管理台未启用"
        note="在 Worker 上执行 npx wrangler secret put ADMIN_PASSWORD 并重新部署后, 这里即可管理账号。"
      />
    );
  }
  if (!status.unlocked) {
    return <AdminLogin onSuccess={refreshStatus} />;
  }
  return <AdminConsole onLock={refreshStatus} />;
}

function Centered({ title, note }: { title: string; note?: string }) {
  return (
    <section className={s.centered}>
      <p className={s.centeredTitle}>{title}</p>
      {note ? <p className={s.centeredNote}>{note}</p> : null}
      <Link to="/" className={s.backLink}>
        ← 返回首页
      </Link>
    </section>
  );
}

function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
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
      await adminApi.login(password);
      setPassword("");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "验证失败");
      setErrorCode(err instanceof Error && "code" in err ? String((err as { code: string }).code) : null);
    } finally {
      setSubmitting(false);
    }
  }

  const rateLimited = errorCode === "ADMIN_RATELIMITED";

  return (
    <section className={s.login}>
      <form className={s.panel} onSubmit={(e) => void onSubmit(e)}>
        <p className={`ark-micro ${s.eyebrow}`}>
          <span className={s.eyebrowMark} aria-hidden="true" />
          ADMIN CONSOLE · 账号管理
        </p>
        <h1 className={s.title}>输入管理密码</h1>
        <label className={`ark-micro ${s.fieldLabel}`} htmlFor="admin-password">
          管理密码
        </label>
        <input
          id="admin-password"
          className={s.input}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          required
          disabled={rateLimited}
        />
        {error ? (
          <p className={`${s.error} ${rateLimited ? s.errorRate : ""}`} role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className={s.action} disabled={submitting || rateLimited}>
          {submitting ? "验证中…" : "进入管理台 →"}
        </button>
        <p className={`ark-micro ${s.footnote}`}>管理台与站点访问密码相互独立</p>
      </form>
    </section>
  );
}

function AdminConsole({ onLock }: { onLock: () => void }) {
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [panel, setPanel] = useState<Panel>("list");
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const reload = useCallback(() => {
    adminApi
      .list()
      .then((body) => setAccounts(body.accounts))
      .catch((err: Error) => setNotice({ kind: "err", text: err.message }));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function logout() {
    try {
      await adminApi.logout();
    } finally {
      onLock();
    }
  }

  function flash(kind: "ok" | "err", text: string) {
    setNotice({ kind, text });
    if (kind === "ok") {
      window.setTimeout(() => setNotice(null), 4000);
    }
  }

  return (
    <div className={s.console}>
      <header className={s.consoleHead}>
        <div>
          <p className="ark-micro">ADMIN CONSOLE · 账号管理</p>
          <h1 className={s.title}>管理网盘账号</h1>
        </div>
        <div className={s.consoleActions}>
          <Link to="/" className={s.ghostAction}>
            ← 首页
          </Link>
          <button type="button" className={s.ghostAction} onClick={() => void logout()}>
            锁定管理台
          </button>
        </div>
      </header>

      {notice ? (
        <p className={notice.kind === "ok" ? `${s.notice}` : `${s.notice} ${s.noticeErr}`} role={notice.kind === "err" ? "alert" : undefined}>
          {notice.text}
        </p>
      ) : null}

      <nav className={s.tabs} aria-label="管理功能">
        {(
          [
            ["list", "账号列表"],
            ["add-personal", "+ 个人版"],
            ["add-business", "+ 企业版"],
          ] as Array<[Panel, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`${s.tab} ${panel === key ? s.tabActive : ""}`}
            onClick={() => setPanel(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {panel === "list" ? <AccountList accounts={accounts} reload={reload} flash={flash} /> : null}
      {panel === "add-personal" ? <AddPersonal onDone={() => { setPanel("list"); reload(); }} flash={flash} /> : null}
      {panel === "add-business" ? <AddBusiness onDone={() => { setPanel("list"); reload(); }} flash={flash} /> : null}
    </div>
  );
}

function AccountList({
  accounts,
  reload,
  flash,
}: {
  accounts: AdminAccount[] | null;
  reload: () => void;
  flash: (kind: "ok" | "err", text: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  if (!accounts) return <p className="ark-micro">正在加载…</p>;
  if (accounts.length === 0) {
    return (
      <div className={s.empty}>
        <p>还没有账号, 用上方「+ 个人版」或「+ 企业版」添加。</p>
      </div>
    );
  }

  async function confirmRemove() {
    if (!removingId) return;
    try {
      await adminApi.remove(removingId);
      setRemovingId(null);
      flash("ok", "账号已移除");
      reload();
    } catch (err) {
      flash("err", err instanceof Error ? err.message : "移除失败");
    }
  }

  async function confirmRename() {
    if (!renamingId || !renameValue.trim()) return;
    try {
      await adminApi.rename(renamingId, renameValue.trim());
      setRenamingId(null);
      flash("ok", "已重命名");
      reload();
    } catch (err) {
      flash("err", err instanceof Error ? err.message : "重命名失败");
    }
  }

  return (
    <div className={s.list}>
      {accounts.map((account) => (
        <div key={account.id} className={s.row}>
          <div className={s.rowMain}>
            {renamingId === account.id ? (
              <span className={s.renameBox}>
                <input
                  className={s.input}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  aria-label="新展示名"
                  autoFocus
                />
                <button type="button" className={s.action} onClick={() => void confirmRename()}>
                  保存
                </button>
                <button type="button" className={s.ghostAction} onClick={() => setRenamingId(null)}>
                  取消
                </button>
              </span>
            ) : (
              <>
                <span className={s.rowName}>{account.name}</span>
                <span className={`ark-micro ${s.rowType}`}>{account.type === "personal" ? "个人版" : "企业版"}</span>
                <span className={`ark-micro ${account.status === "active" ? s.rowOk : s.rowInvalid}`}>
                  {account.status === "active" ? "在线" : "授权失效"}
                </span>
                <span className={`ark-micro ${s.rowMeta}`}>
                  {account.upn ?? "-"} · drive {account.driveId ? `${account.driveId.slice(0, 8)}…` : "-"} · 添加于 {formatDate(account.createdAt)}
                </span>
              </>
            )}
          </div>
          <div className={s.rowActions}>
            <button
              type="button"
              className={s.ghostAction}
              onClick={() => {
                setRenamingId(account.id);
                setRenameValue(account.name);
              }}
            >
              改名
            </button>
            {removingId === account.id ? (
              <>
                <button type="button" className={s.danger} onClick={() => void confirmRemove()}>
                  确认删除
                </button>
                <button type="button" className={s.ghostAction} onClick={() => setRemovingId(null)}>
                  取消
                </button>
              </>
            ) : (
              <button type="button" className={s.ghostAction} onClick={() => setRemovingId(account.id)}>
                删除
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const POLL_INTERVAL_MS = 2500;

function AddPersonal({ onDone, flash }: { onDone: () => void; flash: (kind: "ok" | "err", text: string) => void }) {
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [start, setStart] = useState<DeviceCodeStartDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pollTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    },
    [],
  );

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      setStart(await adminApi.personalStart({ name: name.trim(), clientId: clientId.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "启动失败");
    } finally {
      setSubmitting(false);
    }
  }

  function schedulePoll(sessionId: string) {
    pollTimer.current = window.setTimeout(() => void poll(sessionId), POLL_INTERVAL_MS);
  }

  async function poll(sessionId: string) {
    try {
      const result = await adminApi.personalPoll(sessionId);
      if (result.status === "pending") {
        schedulePoll(sessionId);
        return;
      }
      if (result.status === "ok") {
        flash("ok", `账号「${result.account.name}」已添加`);
        onDone();
        return;
      }
      setError("设备码已过期, 请重新开始授权");
      setStart(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "授权失败, 请重新开始");
      setStart(null);
    }
  }

  if (start) {
    return (
      <div className={s.formCard}>
        <p className={s.formLead}>两步完成授权:</p>
        <ol className={s.steps}>
          <li>
            打开{" "}
            <a className={s.extLink} href={start.verificationUri} target="_blank" rel="noreferrer">
              {start.verificationUri}
            </a>
          </li>
          <li>
            输入设备码:{" "}
            <strong className={s.userCode}>{start.userCode}</strong>
          </li>
        </ol>
        <p className={`ark-micro ${s.pollHint}`}>
          <span className={s.spinner} aria-hidden="true" />
          正在等待你在微软页面完成授权…(登录的账号将成为「{name}」)
        </p>
        {error ? (
          <p className={s.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form className={s.formCard} onSubmit={(e) => void onSubmit(e)}>
      <p className={s.formLead}>
        通过微软官方设备码流程授权一个个人版 OneDrive(outlook / hotmail 等)。需要先在 Azure 注册公共客户端应用, 见
        docs/setup-azure.md。
      </p>
      <label className={`ark-micro ${s.fieldLabel}`} htmlFor="personal-name">
        展示名(如「一号机」)
      </label>
      <input id="personal-name" className={s.input} value={name} onChange={(e) => setName(e.target.value)} required />
      <label className={`ark-micro ${s.fieldLabel}`} htmlFor="personal-client-id">
        应用程序(客户端) ID
      </label>
      <input
        id="personal-client-id"
        className={s.input}
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
        placeholder="00000000-0000-0000-0000-000000000000"
        required
      />
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className={s.action} disabled={submitting}>
        {submitting ? "正在申请设备码…" : "开始授权 →"}
      </button>
    </form>
  );
}

function AddBusiness({ onDone, flash }: { onDone: () => void; flash: (kind: "ok" | "err", text: string) => void }) {
  const [form, setForm] = useState({ name: "", tenantId: "", clientId: "", clientSecret: "", upn: "" });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(key: keyof typeof form) {
    return (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: event.target.value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminApi.business({
        name: form.name.trim(),
        tenantId: form.tenantId.trim(),
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret.trim(),
        upn: form.upn.trim(),
      });
      flash("ok", `账号「${form.name.trim()}」已添加`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "添加失败");
    } finally {
      setSubmitting(false);
    }
  }

  const fields: Array<{ key: keyof typeof form; label: string; placeholder?: string; type?: string }> = [
    { key: "name", label: "展示名" },
    { key: "tenantId", label: "目录(租户) ID" },
    { key: "clientId", label: "应用程序(客户端) ID" },
    { key: "clientSecret", label: "客户端密钥 Value", type: "password" },
    { key: "upn", label: "目标用户 UPN", placeholder: "user@tenant.onmicrosoft.com" },
  ];

  return (
    <form className={s.formCard} onSubmit={(e) => void onSubmit(e)}>
      <p className={s.formLead}>
        适用于 E5 / E3 / 企业版。提交时服务端会真实验证凭据并解析 OneDrive, 失败不会写入。步骤见 docs/setup-azure.md。
      </p>
      {fields.map((field) => (
        <div key={field.key} className={s.fieldRow}>
          <label className={`ark-micro ${s.fieldLabel}`} htmlFor={`biz-${field.key}`}>
            {field.label}
          </label>
          <input
            id={`biz-${field.key}`}
            className={s.input}
            type={field.type ?? "text"}
            value={form[field.key]}
            onChange={update(field.key)}
            placeholder={field.placeholder}
            required
            autoComplete={field.type === "password" ? "new-password" : "off"}
          />
        </div>
      ))}
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className={s.action} disabled={submitting}>
        {submitting ? "正在验证凭据…" : "验证并添加 →"}
      </button>
    </form>
  );
}
