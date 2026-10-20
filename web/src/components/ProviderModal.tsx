import { useEffect, useState } from "react";
import { KeyRound, Server } from "lucide-react";
import { api, ApiError } from "../api";
import type { Caps, Provider } from "../types";
import { Button, Field, Modal, Select, TextInput } from "../ui";

export default function ProviderModal(props: {
  open: boolean;
  provider: Provider | null;
  presets: Caps[];
  onClose: () => void;
  onSaved: (provider: Provider) => void;
}) {
  const editing = !!props.provider;
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [authStyle, setAuthStyle] = useState<"bearer" | "api_key">("bearer");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [deepBusy, setDeepBusy] = useState(false);
  const [deepResult, setDeepResult] = useState<{ ok: boolean; message: string; hint?: string } | null>(null);

  useEffect(() => {
    if (!props.open) return;
    const p = props.provider;
    setName(p ? p.name : "");
    setBaseUrl(p ? p.baseUrl : "https://api.openai.com/v1");
    setAuthStyle(p ? (p.authStyle as "bearer" | "api_key") : "bearer");
    setApiKey("");
    setModel(p ? p.model : props.presets[0] ? props.presets[0].id : "");
    setError(null);
    setSaving(false);
    setDeepBusy(false);
    setDeepResult(null);
  }, [props.open, props.provider, props.presets]);

  async function handleSave() {
    if (!name.trim()) {
      setError({ message: "请填写名称" });
      return;
    }
    if (!baseUrl.trim()) {
      setError({ message: "请填写 Base URL" });
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing && props.provider) {
        const body: Record<string, unknown> = { name: name.trim(), baseUrl: baseUrl.trim(), authStyle, model: model.trim() };
        if (apiKey.trim()) body.apiKey = apiKey.trim();
        const res = await api.updateProvider(props.provider.id, body);
        props.onSaved(res.provider);
      } else {
        const res = await api.createProvider({
          name: name.trim(),
          baseUrl: baseUrl.trim(),
          authStyle,
          apiKey: apiKey.trim(),
          model: model.trim()
        });
        props.onSaved(res.provider);
      }
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : String(e), "", 0);
      setError({ message: err.message, hint: err.hint });
    } finally {
      setSaving(false);
    }
  }

  async function runDeepTest() {
    if (!props.provider) return;
    setDeepBusy(true);
    setDeepResult(null);
    try {
      const res = await api.testProvider(props.provider.id, true, model.trim());
      setDeepResult({ ok: res.ok, message: res.message, hint: res.hint });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : String(e), "", 0);
      setDeepResult({ ok: false, message: err.message, hint: err.hint });
    } finally {
      setDeepBusy(false);
    }
  }

  return (
    <Modal
      open={props.open}
      title={editing ? "编辑 Provider" : "添加 Provider"}
      subtitle="支持 OpenAI 官方，以及任何兼容 Images API 的第三方中转"
      onClose={props.onClose}
      footer={
        <>
          {editing && props.provider ? (
            <div className="mr-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" loading={deepBusy} onClick={runDeepTest}>
                深度测试（真出 1 张图）
              </Button>
              {deepResult && !deepBusy ? (
                <span className={deepResult.ok ? "text-[11px] text-success" : "text-[11px] text-danger"}>
                  {deepResult.message}
                </span>
              ) : null}
            </div>
          ) : null}
          <Button variant="ghost" onClick={props.onClose}>
            取消
          </Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>
            {editing ? "保存修改" : "保存并添加"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="名称">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 OpenAI 官方 / 某中转" autoFocus />
          </Field>
          <Field label="认证方式">
            <Select value={authStyle} onChange={(e) => setAuthStyle(e.target.value === "api_key" ? "api_key" : "bearer")}>
              <option value="bearer">Bearer（OpenAI 官方 / 多数中转）</option>
              <option value="api_key">api-key 头（部分自建网关）</option>
            </Select>
          </Field>
        </div>

        <Field label="Base URL" hint="通常以 /v1 结尾">
          <TextInput
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="font-mono text-[12.5px]"
          />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="rounded-md border border-line2 px-2 py-1 text-[11px] text-muted hover:border-violet-500/40 hover:text-soft"
            onClick={() => setBaseUrl("https://api.openai.com/v1")}
          >
            填入官方地址
          </button>
          <button
            type="button"
            className="rounded-md border border-line2 px-2 py-1 text-[11px] text-muted hover:border-violet-500/40 hover:text-soft"
            onClick={() => setBaseUrl("https://your-relay.example.com/v1")}
          >
            填入中转地址模板
          </button>
          <button
            type="button"
            className="rounded-md border border-line2 px-2 py-1 text-[11px] text-muted hover:border-violet-500/40 hover:text-soft"
            onClick={() => setBaseUrl("http://127.0.0.1:9911/v1")}
          >
            本地 Mock（演示）
          </button>
        </div>

        <Field label="API Key" hint={editing ? "留空表示不修改" : "只保存在本机"}>
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <TextInput
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={editing && props.provider && props.provider.hasKey ? "已保存 " + props.provider.keyMasked + "（留空不修改）" : "sk-..."}
              className="pl-8 font-mono text-[12.5px]"
              autoComplete="off"
            />
          </div>
        </Field>

        <Field label="默认模型" hint="可手填，模型名以你的账号/中转实际支持为准">
          <div className="relative">
            <Server className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <TextInput
              value={model}
              onChange={(e) => setModel(e.target.value)}
              list="provider-model-options"
              placeholder="gpt-image-1"
              className="pl-8 font-mono text-[12.5px]"
            />
            <datalist id="provider-model-options">
              {props.presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </datalist>
          </div>
        </Field>

        <div className="rounded-xl border border-line2 bg-surface px-3 py-2.5 text-[11.5px] leading-relaxed text-dim">
          请求只会发送到上面填写的 Base URL；Key 不回传浏览器，也不会上传到任何第三方服务。保存后可点左侧列表里的闪电图标做连通性测试。
        </div>

        {error ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5">
            <p className="text-[12.5px] text-danger">{error.message}</p>
            {error.hint ? <p className="mt-1 text-[11.5px] text-danger">{error.hint}</p> : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
