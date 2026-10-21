import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Cpu, Download, Image as ImageIcon, Sparkles, X } from "lucide-react";
import type { Generation } from "../types";
import { formatMs, formatTime, formatTokens, formatUsd } from "../types";
import { cn } from "../ui";

export default function Results(props: { generation: Generation | null }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const gen = props.generation;

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-app">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-2 text-[12px] text-dim">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <span className="text-soft">本次结果</span>
          {gen ? (
            <>
              <span className="text-faint">/</span>
              <span className="font-mono text-[11px] text-faint">{gen.params.model}</span>
              <span className="rounded border border-line2 px-1.5 py-0.5 text-[10px] text-dim">
                {gen.params.size} · {gen.params.quality}
              </span>
              <span className="text-[10.5px] text-faint">{formatMs(gen.latencyMs)}</span>
            </>
          ) : null}
        </div>
        {gen ? <span className="text-[10.5px] text-faint">{formatTime(gen.createdAt)}</span> : null}
      </div>

      {!gen ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <div className="max-w-[380px] text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line2 bg-elevated">
              <ImageIcon className="h-6 w-6 text-faint" />
            </div>
            <h2 className="text-[14px] font-medium text-soft">还没有生成任何图片</h2>
            <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
              在左侧写好提示词、调好参数，点「生成图片」。第一次使用请先在 API 提供方里添加并测试连接。
            </p>
          </div>
        </div>
      ) : gen.status === "error" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/[0.07] p-4">
            <div className="flex items-center gap-2 text-[13px] font-medium text-danger">
              <AlertTriangle className="h-4 w-4" />
              生成失败
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-danger">{gen.error}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-dim">
              <span>{gen.providerName}</span>
              <span className="font-mono">{gen.params.model}</span>
              <span>{formatMs(gen.latencyMs)}</span>
              <span>{formatTime(gen.createdAt)}</span>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              提示：401 多为 Key 问题，404 多为 Base URL 或模型名问题，429 为限流/额度。可点右上角「测试连接」确认。
            </p>
          </div>
          <div className="mt-3 rounded-xl border border-line bg-surface p-3">
            <div className="text-[10.5px] uppercase tracking-wide text-faint">prompt</div>
            <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-muted">{gen.prompt}</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-line px-4 py-3">
            <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted">{gen.prompt}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-faint">
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3" />
                {gen.providerName}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatMs(gen.latencyMs)}
              </span>
              <span>{gen.params.n} 张 · {gen.params.output_format.toUpperCase()}</span>
              {gen.tokens && gen.tokens.totalTokens > 0 ? (
                <span>
                  {formatTokens(gen.tokens.totalTokens)} tokens
                  {gen.costUsd ? " · 约 " + formatUsd(gen.costUsd) : ""}
                </span>
              ) : null}
              {gen.params.background && gen.params.background !== "auto" ? <span>背景 {gen.params.background}</span> : null}
            </div>
          </div>

          <div
            className={cn(
              "grid gap-3 p-4",
              gen.files.length === 1 ? "grid-cols-1" : gen.files.length === 2 ? "grid-cols-2" : "grid-cols-2 2xl:grid-cols-3"
            )}
          >
            {gen.files.map((url) => (
              <div
                key={url}
                className="group relative overflow-hidden rounded-xl border border-line bg-surface"
                style={{ aspectRatio: gen.files.length === 1 ? "auto" : "1 / 1" }}
              >
                <img
                  src={url}
                  alt="生成结果"
                  className="h-full w-full cursor-zoom-in object-contain"
                  onClick={() => setLightbox(url)}
                />
                <div className="pointer-events-none absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <a
                    href={url}
                    download
                    className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-lg bg-black/60 text-soft backdrop-blur hover:bg-black/80"
                    title="下载"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {lightbox ? (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-black/85 p-6 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <div className="mb-3 flex items-center justify-between text-muted">
            <span className="max-w-[70%] truncate text-[12px]">{gen ? gen.prompt : ""}</span>
            <div className="flex items-center gap-2">
              <a
                href={lightbox}
                download
                className="flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-[12px] text-soft hover:bg-white/10"
                onClick={(e) => e.stopPropagation()}
              >
                <Download className="h-3.5 w-3.5" />
                下载
              </a>
              <button className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 hover:bg-white/10">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox} alt="预览" className="max-h-full max-w-full rounded-lg object-contain" />
          </div>
        </div>
      ) : null}
    </section>
  );
}
