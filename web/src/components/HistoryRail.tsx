import { FolderOpen, ToggleLeft, Trash2, TriangleAlert } from "lucide-react";
import type { Generation } from "../types";
import { formatMs, formatTime } from "../types";
import { IconButton, cn } from "../ui";

export default function HistoryRail(props: {
  generations: Generation[];
  onOpen: (gen: Generation) => void;
  onDelete: (gen: Generation) => void;
  onReveal: () => void;
}) {
  return (
    <aside className="hidden w-[268px] shrink-0 flex-col border-l border-line bg-panel xl:flex">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-dim">
          历史记录 <span className="ml-1 text-faint">{props.generations.length}</span>
        </span>
        <IconButton onClick={props.onReveal} title="打开图片目录">
          <FolderOpen className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
        {props.generations.length === 0 ? (
          <p className="mt-8 px-3 text-center text-[11.5px] leading-relaxed text-faint">
            生成过的图片会出现在这里，保存在本机 data/images
          </p>
        ) : null}

        {props.generations.map((gen) => {
          const thumb = gen.files && gen.files.length ? gen.files[0] : "";
          return (
            <div
              key={gen.id}
              role="button"
              tabIndex={0}
              onClick={() => props.onOpen(gen)}
              onKeyDown={(e) => {
                if (e.key === "Enter") props.onOpen(gen);
              }}
              className="group flex cursor-pointer gap-2 rounded-lg p-1.5 transition hover:bg-elevated"
            >
              <div
                className={cn(
                  "h-11 w-11 shrink-0 overflow-hidden rounded-md border",
                  gen.status === "error" ? "flex items-center justify-center border-rose-500/20 bg-rose-500/10" : "border-line2 bg-surface"
                )}
              >
                {gen.status === "error" ? (
                  <TriangleAlert className="h-4 w-4 text-danger/80" />
                ) : thumb ? (
                  <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <ToggleLeft className="h-4 w-4 text-faint" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[11.5px] leading-snug text-soft">{gen.prompt}</p>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-faint">
                  <span className="truncate">{gen.status === "error" ? "失败" : formatMs(gen.latencyMs)}</span>
                  <span className="shrink-0 text-faint">·</span>
                  <span className="shrink-0">{formatTime(gen.createdAt)}</span>
                </div>
              </div>
              <IconButton
                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 hover:text-danger"
                title="删除"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onDelete(gen);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </div>
          );
        })}
      </div>

      <div className="border-t border-line px-3 py-2 text-[10.5px] text-faint">
        记录存在 data/app.db · 点击查看大图
      </div>
    </aside>
  );
}
