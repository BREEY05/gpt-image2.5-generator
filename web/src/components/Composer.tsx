import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, ImagePlus, Sparkles, Trash2, Wand2, Zap } from "lucide-react";
import { api } from "../api";
import type { Caps, GeneratePayload, Params, Provider } from "../types";
import { capsForModel, formatMs } from "../types";
import { Button, Field, Select, StatusDot, TextArea, TextInput, cn } from "../ui";

type TestInfo = { busy: boolean; ok?: boolean; message?: string; latencyMs?: number; hint?: string };

const TEMPLATES = [
  {
    label: "产品图",
    text: "A premium product photo of a matte black wireless headphone on a soft gradient background, studio softbox lighting, subtle reflection, ultra sharp, 85mm lens, commercial advertising style"
  },
  {
    label: "插画",
    text: "A cozy reading nook by a rainy window, warm lamp light, muted teal and amber palette, painterly illustration, soft grain"
  },
  {
    label: "海报",
    text: "Minimal Swiss-style poster with bold geometric shapes, high contrast, generous negative space, limited palette of cream and deep red"
  },
  {
    label: "头像",
    text: "A friendly stylized portrait avatar, clean vector-like shading, centered composition, pastel background"
  },
  {
    label: "建筑",
    text: "A brutalist concrete museum at dusk, long shadows, dramatic sky, architectural photography, wide angle"
  }
];

const QUALITY_LABELS: Record<string, string> = {
  low: "低 · 快且省",
  medium: "中 · 平衡",
  high: "高 · 细节更好",
  xhigh: "极高",
  max: "最高",
  auto: "自动"
};

function readAsDataUrl(file: File, onDone: (value: string) => void) {
  const reader = new FileReader();
  reader.onload = () => onDone(String(reader.result || ""));
  reader.readAsDataURL(file);
}

export default function Composer(props: {
  provider: Provider | null;
  presets: Caps[];
  sizePresets: string[];
  busy: boolean;
  elapsed: number;
  testInfo?: TestInfo;
  onGenerate: (payload: Omit<GeneratePayload, "providerId">) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"generate" | "edit">("generate");
  const [model, setModel] = useState("");
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState("medium");
  const [n, setN] = useState(1);
  const [format, setFormat] = useState("png");
  const [background, setBackground] = useState("auto");
  const [compression, setCompression] = useState(90);
  const [moderation, setModeration] = useState("auto");
  const [advanced, setAdvanced] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedError, setAdvancedError] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [mask, setMask] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const imageInput = useRef<HTMLInputElement | null>(null);
  const maskInput = useRef<HTMLInputElement | null>(null);

  const caps = useMemo(() => capsForModel(props.presets, model), [props.presets, model]);

  useEffect(() => {
    const p = props.provider;
    if (!p) {
      setModel("");
      return;
    }
    setModel(p.model || (props.presets[0] ? props.presets[0].id : ""));
    setModels([]);
  }, [props.provider ? props.provider.id : "", props.presets]);

  useEffect(() => {
    if (!caps) return;
    if (caps.quality.indexOf(quality) === -1) {
      setQuality(caps.quality.indexOf("medium") !== -1 ? "medium" : caps.quality[0]);
    }
    if (caps.maxN < n) setN(1);
    if (!caps.background && background === "transparent") setBackground("auto");
    if (caps.customSize === false) {
      const allowed = ["1024x1024", "1536x1024", "1024x1536"];
      if (allowed.indexOf(size) === -1) setSize("1024x1024");
    }
  }, [caps]);

  const fixedSizes = ["1024x1024", "1536x1024", "1024x1536"];
  const visibleSizes = caps.customSize ? props.sizePresets : fixedSizes;
  const dims = size.split("x");
  const width = Number(dims[0]) || 1024;
  const height = Number(dims[1]) || 1024;

  async function pullModels() {
    if (!props.provider) return;
    setLoadingModels(true);
    try {
      const res = await api.models(props.provider.id);
      setModels(res.models.map((m) => m.id));
    } catch (e) {
      setAdvancedError(e instanceof Error ? e.message : "拉取模型失败");
    } finally {
      setLoadingModels(false);
    }
  }

  function submit() {
    if (!props.provider || !prompt.trim() || props.busy) return;
    let extra: Record<string, unknown> | undefined;
    if (advanced.trim()) {
      try {
        const parsed = JSON.parse(advanced);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) extra = parsed as Record<string, unknown>;
        else {
          setAdvancedError("高级参数必须是一个 JSON 对象");
          return;
        }
      } catch (e) {
        setAdvancedError("高级参数不是合法 JSON");
        return;
      }
    }
    if (mode === "edit" && !image) {
      setAdvancedError("编辑模式需要先上传参考图");
      return;
    }
    setAdvancedError(null);
    const params: Params = {
      model: model.trim(),
      size,
      quality,
      n,
      output_format: format,
      background,
      output_compression: compression,
      moderation,
      ...(extra ? { extra } : {})
    };
    props.onGenerate({
      prompt: prompt.trim(),
      mode,
      params,
      image: mode === "edit" && image ? image : undefined,
      mask: mode === "edit" && mask ? mask : undefined
    });
  }

  const options = Array.from(new Set([...(props.presets || []).map((p) => p.id), ...models, model].filter(Boolean)));
  const canGenerate = !!props.provider && !!prompt.trim() && !props.busy && (mode !== "edit" || !!image);

  return (
    <section className="flex w-[424px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-1 border-b border-line px-3 py-2">
        <div className="flex rounded-lg border border-line2 bg-surface p-0.5">
          <button
            onClick={() => setMode("generate")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] transition",
              mode === "generate" ? "bg-violet-500/20 text-accent" : "text-dim hover:text-soft"
            )}
          >
            文生图
          </button>
          <button
            onClick={() => setMode("edit")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] transition",
              mode === "edit" ? "bg-violet-500/20 text-accent" : "text-dim hover:text-soft"
            )}
          >
            编辑 / 参考图
          </button>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-faint">
          {props.testInfo && !props.testInfo.busy && props.testInfo.ok === false ? (
            <span className="text-danger/80">连接异常</span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 py-3.5">
        <div>
          <TextArea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            rows={6}
            placeholder="描述你想要的画面…… 例如：一只橘猫坐在窗台上看雨，柔和自然光，胶片质感，浅景深"
            className="min-h-[132px]"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <div className="flex flex-wrap gap-1">
              {TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  onClick={() => setPrompt((prev) => (prev.trim() ? prev.trim() + "，" + t.text : t.text))}
                  className="rounded-md border border-line2 px-1.5 py-0.5 text-[10.5px] text-dim transition hover:border-violet-500/40 hover:text-soft"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="text-[10.5px] text-faint">{prompt.length} 字 · Ctrl+Enter</span>
          </div>
        </div>

        {mode === "edit" ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => imageInput.current && imageInput.current.click()}
              className="group relative flex h-24 items-center justify-center overflow-hidden rounded-xl border border-dashed border-line2 bg-surface transition hover:border-violet-500/50"
            >
              {image ? (
                <>
                  <img src={image} alt="参考图" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
                    <Trash2
                      className="h-4 w-4 text-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setImage(null);
                      }}
                    />
                  </span>
                </>
              ) : (
                <span className="flex flex-col items-center gap-1 text-[11px] text-dim">
                  <ImagePlus className="h-4 w-4" />
                  上传参考图
                </span>
              )}
            </button>
            <button
              onClick={() => maskInput.current && maskInput.current.click()}
              className="group relative flex h-24 items-center justify-center overflow-hidden rounded-xl border border-dashed border-line2 bg-surface transition hover:border-violet-500/50"
            >
              {mask ? (
                <>
                  <img src={mask} alt="遮罩" className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
                    <Trash2
                      className="h-4 w-4 text-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMask(null);
                      }}
                    />
                  </span>
                </>
              ) : (
                <span className="flex flex-col items-center gap-1 text-[11px] text-dim">
                  <ImagePlus className="h-4 w-4" />
                  遮罩（可选）
                </span>
              )}
            </button>
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files && e.target.files[0];
                if (file) readAsDataUrl(file, setImage);
                e.target.value = "";
              }}
            />
            <input
              ref={maskInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files && e.target.files[0];
                if (file) readAsDataUrl(file, setMask);
                e.target.value = "";
              }}
            />
          </div>
        ) : null}

        <Field label="模型" hint={caps.note || ""}>
          <div className="flex gap-2">
            <TextInput
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="composer-model-options"
              placeholder="gpt-image-1"
              className="font-mono text-[12px]"
            />
            <datalist id="composer-model-options">
              {options.map((id) => (
                <option key={id} value={id} />
              ))}
            </datalist>
            <Button
              size="sm"
              variant="outline"
              loading={loadingModels}
              onClick={pullModels}
              disabled={!props.provider}
              className="shrink-0 whitespace-nowrap px-3"
            >
              拉取
            </Button>
          </div>
        </Field>

        <Field label="尺寸" hint={caps.customSize ? "可自定义 宽x高，16 的倍数" : "该模型使用固定尺寸"}>
          <div className="flex flex-wrap gap-1.5">
            {visibleSizes.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11.5px] transition",
                  size === s
                    ? "border-violet-500/50 bg-violet-500/15 text-accent"
                    : "border-line2 text-muted hover:border-line-strong hover:text-soft"
                )}
              >
                {s}
              </button>
            ))}
          </div>
          {caps.customSize ? (
            <div className="mt-2 flex items-center gap-2">
              <TextInput
                type="number"
                value={width}
                onChange={(e) => setSize(Math.max(16, Number(e.target.value) || 16) + "x" + height)}
                className="h-8 w-[92px] text-[12px]"
              />
              <span className="text-faint">x</span>
              <TextInput
                type="number"
                value={height}
                onChange={(e) => setSize(width + "x" + Math.max(16, Number(e.target.value) || 16))}
                className="h-8 w-[92px] text-[12px]"
              />
              <span className="shrink-0 text-[10.5px] text-faint">16 的倍数</span>
            </div>
          ) : null}
        </Field>

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="画质">
            <Select value={quality} onChange={(e) => setQuality(e.target.value)}>
              {caps.quality.map((q) => (
                <option key={q} value={q}>
                  {QUALITY_LABELS[q] || q}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="数量" hint={"最多 " + caps.maxN}>
            <Select value={String(n)} onChange={(e) => setN(Number(e.target.value))}>
              {Array.from({ length: caps.maxN }, (_, i) => i + 1).map((v) => (
                <option key={v} value={v}>
                  {v} 张
                </option>
              ))}
            </Select>
          </Field>
          <Field label="格式">
            <Select value={format} onChange={(e) => setFormat(e.target.value)}>
              {caps.formats.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="背景">
            <Select value={background} onChange={(e) => setBackground(e.target.value)} disabled={!caps.background || format === "jpeg"}>
              <option value="auto">自动</option>
              <option value="opaque">不透明</option>
              <option value="transparent">透明（PNG/WebP）</option>
            </Select>
          </Field>
          {format !== "png" ? (
            <Field label="压缩质量" hint="0-100">
              <TextInput
                type="number"
                min={0}
                max={100}
                value={compression}
                onChange={(e) => setCompression(Math.max(0, Math.min(100, Number(e.target.value) || 90)))}
                className="h-9"
              />
            </Field>
          ) : null}
          <Field label="内容审核" hint="大多留 auto">
            <Select value={moderation} onChange={(e) => setModeration(e.target.value)}>
              <option value="auto">auto</option>
              <option value="low">low</option>
            </Select>
          </Field>
        </div>

        <div className="rounded-xl border border-line bg-app">
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-[11.5px] text-dim hover:text-soft"
          >
            <span>高级参数（合并进请求体，JSON）</span>
            {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showAdvanced ? (
            <div className="border-t border-line p-2">
              <textarea
                value={advanced}
                onChange={(e) => setAdvanced(e.target.value)}
                rows={4}
                spellCheck={false}
                placeholder='例如 {"input_fidelity":"high"}'
                className="w-full resize-none rounded-lg border border-line2 bg-surface p-2 font-mono text-[11.5px] text-soft outline-none focus:border-violet-500/60"
              />
              <p className="mt-1 text-[10.5px] leading-relaxed text-faint">
                中转的私有参数、input_fidelity、seed 之类都从这里透传，会覆盖同名参数。
              </p>
            </div>
          ) : null}
        </div>

        {advancedError ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11.5px] text-danger">{advancedError}</div>
        ) : null}
      </div>

      <div className="border-t border-line bg-app p-3">
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 text-dim">
            <StatusDot state={props.busy ? "busy" : props.provider ? (props.provider.lastTest && props.provider.lastTest.ok ? "ok" : "idle") : "error"} />
            {props.provider ? props.provider.name : "未选择 Provider"}
            <span className="text-faint">·</span>
            <span className="font-mono text-[10.5px] text-faint">{model || "未设模型"}</span>
          </span>
          <span className="text-faint">{n} 张 · {size}</span>
        </div>
        <Button
          variant="primary"
          className="h-10 w-full text-[13px]"
          disabled={!canGenerate}
          onClick={submit}
        >
          {props.busy ? (
            <>
              <Zap className="h-4 w-4 animate-pulse" />
              生成中 {(props.elapsed / 1000).toFixed(1)}s
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4" />
              {mode === "edit" ? "开始编辑" : "生成图片"}
            </>
          )}
        </Button>
      </div>
    </section>
  );
}
