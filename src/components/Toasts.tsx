import { useStore } from "../lib/store-context";
import { IconAlert, IconCheck, IconInfo, IconX } from "./Icons";

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <span className="toast__icon">
            {toast.tone === "ok" ? (
              <IconCheck size={14} />
            ) : toast.tone === "error" ? (
              <IconAlert size={14} />
            ) : (
              <IconInfo size={14} />
            )}
          </span>
          <div className="toast__body">
            <span className="toast__title">{toast.title}</span>
            {toast.detail ? <span className="toast__detail">{toast.detail}</span> : null}
          </div>
          <button
            className="toast__close"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss"
          >
            <IconX size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
