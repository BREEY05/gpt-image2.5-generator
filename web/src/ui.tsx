import React from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

type BtnVariant = "primary" | "outline" | "ghost" | "danger";

export function Button(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: BtnVariant;
    size?: "sm" | "md";
    loading?: boolean;
  }
) {
  const { variant = "outline", size = "md", loading = false, className, children, disabled, ...rest } = props;
  const base =
    "inline-flex select-none items-center justify-center gap-1.5 rounded-lg font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40";
  const sizes = size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]";
  const variants: Record<BtnVariant, string> = {
    primary:
      "bg-violet-500 text-white shadow-[0_10px_30px_-12px_rgba(139,92,246,0.95)] hover:bg-violet-400 active:scale-[0.99]",
    outline:
      "border border-line2 bg-elevated text-soft hover:border-line-strong hover:bg-elevated",
    ghost: "text-muted hover:bg-elevated hover:text-ink",
    danger: "border border-rose-500/25 bg-rose-500/10 text-danger hover:bg-rose-500/20"
  };
  return (
    <button className={cn(base, sizes, variants[variant], className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, children, ...rest } = props;
  return (
    <button
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-lg text-dim transition hover:bg-elevated hover:text-soft",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return (
    <input
      className={cn(
        "h-9 w-full rounded-lg border border-line2 bg-surface px-2.5 text-[13px] text-ink outline-none transition placeholder:text-faint focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/15",
        className
      )}
      {...rest}
    />
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props;
  return (
    <textarea
      className={cn(
        "w-full resize-none rounded-xl border border-line2 bg-surface p-3 text-[13.5px] leading-relaxed text-ink outline-none transition placeholder:text-faint focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/15",
        className
      )}
      {...rest}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props;
  return (
    <select
      className={cn(
        "h-9 w-full appearance-none rounded-lg border border-line2 bg-surface px-2.5 text-[13px] text-ink outline-none transition focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/15",
        className
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Field(props: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", props.className)}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11.5px] font-medium uppercase tracking-wide text-dim">{props.label}</span>
        {props.hint ? <span className="text-[11px] text-faint">{props.hint}</span> : null}
      </div>
      {props.children}
    </label>
  );
}

export function Modal(props: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  React.useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);

  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6 backdrop-blur-[3px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        className={cn(
          "flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl border border-line2 bg-card shadow-2xl",
          props.width || "max-w-[560px]"
        )}
      >
        <div className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">{props.title}</h2>
            {props.subtitle ? <p className="mt-0.5 text-[12px] text-dim">{props.subtitle}</p> : null}
          </div>
          <IconButton onClick={props.onClose} aria-label="关闭">
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{props.children}</div>
        {props.footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-panel px-5 py-3">
            {props.footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type ToastState = { kind: "ok" | "error" | "info"; message: string; hint?: string; id: number } | null;

export function Toast(props: { toast: ToastState; onClose: () => void }) {
  const toast = props.toast;
  React.useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(props.onClose, toast.kind === "error" ? 9000 : 4000);
    return () => clearTimeout(timer);
  }, [toast, props.onClose]);

  if (!toast) return null;
  const tone =
    toast.kind === "error"
      ? "border-rose-500/30 bg-danger-soft"
      : toast.kind === "ok"
      ? "border-emerald-500/30 bg-success-soft"
      : "border-line2 bg-elevated";
  const Icon = toast.kind === "error" ? AlertTriangle : toast.kind === "ok" ? CheckCircle2 : Info;
  const iconColor = toast.kind === "error" ? "text-danger" : toast.kind === "ok" ? "text-success" : "text-muted";
  return (
    <div className="fixed bottom-5 right-5 z-[60] w-[400px]">
      <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3 shadow-2xl", tone)}>
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconColor)} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-ink">{toast.message}</p>
          {toast.hint ? <p className="mt-1 text-[12px] leading-snug text-muted">{toast.hint}</p> : null}
        </div>
        <IconButton onClick={props.onClose} className="h-6 w-6">
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

export function StatusDot(props: { state?: "ok" | "error" | "idle" | "busy"; className?: string }) {
  const color =
    props.state === "ok"
      ? "bg-emerald-400"
      : props.state === "error"
      ? "bg-rose-400"
      : props.state === "busy"
      ? "bg-amber-400 animate-pulse"
      : "bg-faint";
  return <span className={cn("inline-block h-1.5 w-1.5 rounded-full", color, props.className)} />;
}