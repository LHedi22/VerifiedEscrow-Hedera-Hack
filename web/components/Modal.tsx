"use client";

import { useEffect, useRef } from "react";

/**
 * App Flow §6: keyboard-reachable, Esc closes (unless busy), focus returns to the trigger on close.
 * Errors show inline and keep the modal open; the primary button disables and spins while waiting.
 */
export default function Modal({
  title, children, onClose, onConfirm, confirmLabel, busy = false, error, danger = false, confirmDisabled = false, testid,
}: {
  title: string; children: React.ReactNode; onClose: () => void; onConfirm: () => void; confirmLabel: string;
  busy?: boolean; error?: React.ReactNode; danger?: boolean; confirmDisabled?: boolean; testid?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => trigger?.focus?.();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
      if (e.key === "Tab" && ref.current) { // keep focus inside the modal
        const f = [...ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), textarea, input, select, a[href]")];
        if (!f.length) return;
        const [first, last] = [f[0], f[f.length - 1]];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} data-testid={testid}>
        <h2>{title}</h2>
        {children}
        {error && <div className="form-error" style={{ marginTop: 12 }} data-testid="modal-error">{error}</div>}
        <div className="actions">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm} disabled={busy || confirmDisabled}
                  data-autofocus data-testid="modal-confirm">
            {busy && <span className="spinner" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
