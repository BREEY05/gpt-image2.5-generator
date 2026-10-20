import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { api, ApiError } from "../api";
import type { AppState } from "../types";
import { Button, Field, Modal, Select, TextInput, cn } from "../ui";
import type { ToastState } from "../ui";
import type { ThemeMode } from "../theme";

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "dark", label: "深色" },
  { value: "light", label: "浅色" },
  { value: "system", label: "跟随系统" }
];

export default function SettingsModal(props: {
  open: boolean;
  state: AppState;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onClose: () => void;
  onSaved: () => void;
  onToast: (t: ToastState) => void;
}) {
  const [concurrency, setConcurrency] = useState(2);
  const [defaultProviderId, setDefaultProviderId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setConcurrency(props.state.settings.concurrency || 2);
    setDefaultProviderId(props.state.settings.defaultProviderId || "");
  }, [props.open, props.state]);

  async function handleSave() {
    setSaving(true);
    try {
      await api.saveSettings({ concurrency, defaultProviderId });
      props.onSaved();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : String(e), "", 0);
      props.onToast({ kind: "error", message: err.message, hint: err.hint, id: Date.now() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={props.open}
      title="设置"
      subtitle="本地工作台的运行参数"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            取消
          </Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            保存
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="界面主题" hint="立即生效">
          <div className="grid grid-cols-3 gap-1.5">
            {THEMES.map((option) => (
              <button
                key={option.value}
                onClick={() => props.onThemeChange(option.value)}
                className={cn(
                  "rounded-lg border px-2 py-1.5 text-[12px] transition",
                  props.themeMode === option.value
                    ? "border-accent/50 bg-accent/15 text-accent"
                    : "border-line2 text-dim hover:border-line-strong hover:text-soft"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label="并发数" hint="同时进行的出图任务，1-8">
          <TextInput
            type="number"
            min={1}
            max={8}
            value={concurrency}
            onChange={(e) => setConcurrency(Math.max(1, Math.min(8, Number(e.target.value) || 2)))}
          />
        </Field>

        <Field label="默认 Provider" hint="启动时自动选中">
          <Select value={defaultProviderId} onChange={(e) => setDefaultProviderId(e.target.value)}>
            <option value="">（不指定）</option>
            {props.state.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="图片目录">
          <div className="flex items-center gap-2">
            <TextInput readOnly value={props.state.dataDir} className="font-mono text-[12px]" />
            <Button
              variant="outline"
              className="shrink-0 whitespace-nowrap"
              onClick={() => {
                api.reveal().catch(() => props.onToast({ kind: "error", message: "无法打开目录", id: Date.now() }));
              }}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              打开
            </Button>
          </div>
        </Field>

        <div className="rounded-xl border border-line2 bg-surface px-3 py-2.5 text-[11.5px] leading-relaxed text-dim">
          元数据（提示词、参数、耗时）存在 data/app.db（SQLite），图片存在 data/images。备份整个 data 目录即可迁移；其中 .secret
          是解密 Key 的密钥，丢失后需要重新填写 API Key。
        </div>
      </div>
    </Modal>
  );
}
