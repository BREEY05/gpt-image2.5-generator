import { Coins, Loader2, RefreshCw } from "lucide-react";
import type { Generation, Provider, Quota, UsageAgg, UsageSummary } from "../types";
import { formatTokens, formatUsd } from "../types";
import { cn } from "../ui";

function Stat(props: { label: string; agg?: UsageAgg; hasPrice: boolean }) {
  const agg = props.agg;
  return (
    <div className="flex flex-col justify-center">
      <span className="text-[10px] uppercase tracking-wider text-faint">{props.label}</span>
      <span className="mt-0.5 flex items-baseline gap-1 text-[11.5px] text-dim">
        <b className="text-[13px] font-semibold text-soft">{agg ? agg.requests : 0}</b>
        <span>次</span>
        <span className="text-line-strong">·</span>
        <span>{agg ? agg.images : 0} 张</span>
        <span className="text-line-strong">·</span>
        <span>{formatTokens(agg ? agg.totalTokens : 0)} tokens</span>
        {props.hasPrice ? (
          <>
            <span className="text-line-strong">·</span>
            <span className="text-soft">{formatUsd(agg ? agg.costUsd : 0)}</span>
          </>
        ) : null}
      </span>
    </div>
  );
}

export default function QuotaBar(props: {
  provider: Provider | null;
  quota: Quota | null;
  quotaLoading: boolean;
  usage: UsageSummary | null;
  lastGeneration: Generation | null;
  onRefresh: () => void;
}) {
  const hasPrice = !!(props.usage && (props.usage.prices.priceInputPerM > 0 || props.usage.prices.priceOutputPerM > 0));
  const quota = props.quota;
  const gen = props.lastGeneration;
  const genTokens = gen && gen.tokens ? gen.tokens.totalTokens : 0;

  return (
    <div className="flex h-[60px] shrink-0 items-center gap-5 border-b border-line bg-panel px-4">
      <div className="flex min-w-[320px] items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15">
          <Coins className="h-4 w-4 text-accent" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-faint">API 额度</span>
            <span className="truncate text-[11px] text-dim">{props.provider ? props.provider.name : "未选择 Provider"}</span>
          </div>

          <div className="mt-0.5 flex items-center gap-2">
            {!props.provider ? (
              <span className="text-[12px] text-faint">添加 Provider 后显示</span>
            ) : props.quotaLoading ? (
              <span className="flex items-center gap-1.5 text-[12px] text-dim">
                <Loader2 className="h-3 w-3 animate-spin" />
                查询额度…
              </span>
            ) : quota && quota.available ? (
              <>
                <span className="text-[16px] font-semibold leading-none text-ink">{formatUsd(quota.remaining)}</span>
                <span className="text-[11px] text-dim">
                  {quota.limit != null ? "上限 " + formatUsd(quota.limit) : "剩余"}
                  {quota.used != null ? " · 已用 " + formatUsd(quota.used) : ""}
                </span>
                <span className="rounded border border-line2 px-1 py-0.5 text-[9.5px] text-faint">{quota.label}</span>
              </>
            ) : (
              <span className="flex items-center gap-1 text-[12px] text-dim" title={quota ? quota.hint || "" : ""}>
                {quota ? quota.message : "尚未查询"}
                <span className="text-[10px] text-faint">（本地统计照常记录）</span>
              </span>
            )}
            <button
              onClick={props.onRefresh}
              title="刷新额度"
              className="ml-0.5 text-faint transition hover:text-soft disabled:opacity-40"
              disabled={!props.provider || props.quotaLoading}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", props.quotaLoading && "animate-spin")} />
            </button>
          </div>
        </div>
      </div>

      <div className="h-8 w-px shrink-0 bg-line" />
      <Stat label="今日" agg={props.usage ? props.usage.today : undefined} hasPrice={hasPrice} />
      <div className="h-8 w-px shrink-0 bg-line" />
      <Stat label="本月" agg={props.usage ? props.usage.month : undefined} hasPrice={hasPrice} />

      <div className="ml-auto flex items-center gap-3">
        {!hasPrice ? (
          <span className="hidden text-[10.5px] text-faint lg:block" title="在设置里填写单价后，这里会显示预估金额">
            未设单价，仅统计 token
          </span>
        ) : null}
        {gen && gen.status === "ok" ? (
          <div className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[10.5px] text-dim">
            本次 {gen.imageCount || gen.files.length} 张
            <span className="mx-1.5 text-line-strong">·</span>
            {formatTokens(genTokens)} tokens
            {hasPrice ? (
              <>
                <span className="mx-1.5 text-line-strong">·</span>
                <span className="text-soft">{formatUsd(gen.costUsd || 0)}</span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
