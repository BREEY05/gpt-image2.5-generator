import { Pencil, Plus, ShieldCheck, Trash2, Zap } from "lucide-react";
import type { Provider } from "../types";
import { formatMs } from "../types";
import { IconButton, StatusDot, cn } from "../ui";

type TestInfo = { busy: boolean; ok?: boolean; message?: string; latencyMs?: number; hint?: string };

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch (e) {
    return url;
  }
}

export default function ProviderRail(props: {
  providers: Provider[];
  activeId: string;
  testInfo: Record<string, TestInfo>;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onEdit: (p: Provider) => void;
  onDelete: (p: Provider) => void;
  onTest: (p: Provider) => void;
}) {
  return (
    <aside className="flex w-[250px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-dim">API 提供方</span>
        <IconButton onClick={props.onAdd} title="添加 Provider">
          <Plus className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {props.providers.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-line2 px-3 py-6 text-center">
            <p className="text-[12.5px] text-muted">还没有配置 API</p>
            <p className="mt-1 text-[11px] leading-relaxed text-faint">
              添加 OpenAI 官方，或任何兼容 /v1/images/generations 的第三方中转
            </p>
            <button
              onClick={props.onAdd}
              className="mt-3 rounded-lg bg-violet-500 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-violet-400"
            >
              添加第一个
            </button>
          </div>
        ) : null}

        {props.providers.map((p) => {
          const active = p.id === props.activeId;
          const t = props.testInfo[p.id];
          const state = t?.busy ? "busy" : t?.ok === false ? "error" : p.lastTest ? (p.lastTest.ok ? "ok" : "error") : "idle";
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => props.onSelect(p.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") props.onSelect(p.id);
              }}
              className={cn(
                "group w-full cursor-pointer rounded-xl border px-2.5 py-2 text-left transition",
                active ? "border-violet-500/40 bg-violet-500/10" : "border-transparent hover:bg-elevated"
              )}
            >
              <div className="flex items-center gap-2">
                <StatusDot state={state} />
                <span className={cn("min-w-0 flex-1 truncate text-[12.5px] font-medium", active ? "text-ink" : "text-soft")}>
                  {p.name}
                </span>
                <span className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100">
                  <IconButton
                    title="测试"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onTest(p);
                    }}
                  >
                    <Zap className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    title="编辑"
                    className="h-6 w-6"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onEdit(p);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </IconButton>
                  <IconButton
                    title="删除"
                    className="h-6 w-6 hover:text-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDelete(p);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 pl-3.5">
                <span className="truncate font-mono text-[10.5px] text-faint">{hostOf(p.baseUrl)}</span>
                <span className="shrink-0 text-[10px] text-faint">{p.model || "未设模型"}</span>
              </div>
              {t && !t.busy ? (
                <div className={cn("mt-1 truncate pl-3.5 text-[10.5px]", t.ok ? "text-success" : "text-danger/80")}>
                  {t.message}
                  {t.latencyMs ? " · " + formatMs(t.latencyMs) : ""}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="border-t border-line px-3 py-2.5">
        <div className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-success" />
          <span>Key 经 AES-256-GCM 加密后存放在本机 data/.secret，不会进入浏览器</span>
        </div>
      </div>
    </aside>
  );
}
