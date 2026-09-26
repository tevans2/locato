import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

export function Panel({ title, subtitle, actions, children, flush = false }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className={`adm-panel${flush ? " is-flush" : ""}`}>
      {(title || actions) && (
        <header className="adm-panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="adm-panel-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({ label, value, delta, hint }: { label: string; value: string; delta?: { value: number; label: string } | null; hint?: string }) {
  const direction = delta ? (delta.value > 0 ? "up" : delta.value < 0 ? "down" : "flat") : null;
  return (
    <div className="adm-stat">
      <span className="adm-stat-label">{label}</span>
      <strong className="adm-stat-value">{value}</strong>
      {delta && (
        <span className={`adm-stat-delta is-${direction}`}>
          {delta.value > 0 ? "▲" : delta.value < 0 ? "▼" : "•"} {delta.value > 0 ? "+" : ""}
          {delta.value} <span>{delta.label}</span>
        </span>
      )}
      {!delta && hint && <span className="adm-stat-hint">{hint}</span>}
    </div>
  );
}

export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "good" | "warn" | "bad" | "brand"; children: ReactNode; title?: string }) {
  return (
    <span className={`adm-badge is-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="adm-empty">{children}</div>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="adm-loading" role="status">
      <Loader2 size={16} className="adm-spin" aria-hidden /> {label}…
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="adm-error" role="alert">
      <AlertTriangle size={16} aria-hidden />
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="adm-btn is-small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

// Loads `load()` on mount, whenever `deps` change, and optionally on an interval while the tab
// is visible. Keeps the previous data on screen during refreshes so polling doesn't flash.
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const next = await loadRef.current();
      if (current !== generation.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (current !== generation.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!pollMs) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, refresh]);

  return { data, error, loading, refresh };
}

export interface ConfirmRequest {
  readonly title: string;
  readonly body: ReactNode;
  readonly confirmLabel: string;
  readonly tone?: "danger" | "default";
  // When set, the confirm button stays disabled until this exact text is typed.
  readonly typeToConfirm?: string;
  readonly run: () => Promise<void>;
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (request && !dialog.open) {
      setTyped("");
      setError(null);
      setBusy(false);
      dialog.showModal();
    } else if (!request && dialog.open) {
      dialog.close();
    }
  }, [request]);

  const blocked = request?.typeToConfirm !== undefined && typed !== request.typeToConfirm;

  async function confirm() {
    if (!request || blocked) return;
    setBusy(true);
    setError(null);
    try {
      await request.run();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className="adm-dialog" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
      {request && (
        <form method="dialog" onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
          <header className="adm-dialog-head">
            <h2>{request.title}</h2>
            <button type="button" className="adm-icon-btn" aria-label="Close" onClick={onClose} disabled={busy}>
              <X size={16} />
            </button>
          </header>
          <div className="adm-dialog-body">{request.body}</div>
          {request.typeToConfirm !== undefined && (
            <label className="adm-field">
              <span>
                Type <code>{request.typeToConfirm}</code> to confirm
              </span>
              <input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus autoComplete="off" spellCheck={false} />
            </label>
          )}
          {error && <ErrorNote message={error} />}
          <footer className="adm-dialog-foot">
            <button type="button" className="adm-btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className={`adm-btn ${request.tone === "danger" ? "is-danger" : "is-primary"}`} disabled={busy || blocked}>
              {busy && <Loader2 size={14} className="adm-spin" aria-hidden />}
              {request.confirmLabel}
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly tone: "good" | "bad";
}

export function Toasts({ toasts }: { toasts: readonly Toast[] }) {
  return (
    <div className="adm-toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`adm-toast is-${toast.tone}`}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}
