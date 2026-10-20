import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, Moon, Settings as SettingsIcon, Sparkles, Sun, Zap } from "lucide-react";
import { api, ApiError } from "./api";
import { applyTheme, loadTheme, resolveTheme, saveTheme } from "./theme";
import type { ThemeMode } from "./theme";
import { capsForModel } from "./types";
import type { AppState, Generation, GeneratePayload, Provider } from "./types";
import { Button, IconButton, StatusDot, Toast } from "./ui";
import type { ToastState } from "./ui";
import ProviderRail from "./components/ProviderRail";
import Composer from "./components/Composer";
import Results from "./components/Results";
import HistoryRail from "./components/HistoryRail";
import ProviderModal from "./components/ProviderModal";
import SettingsModal from "./components/SettingsModal";

type TestInfo = { busy: boolean; ok?: boolean; message?: string; latencyMs?: number; hint?: string };

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(true);
  const [providerId, setProviderId] = useState("");
  const [history, setHistory] = useState<Generation[]>([]);
  const [current, setCurrent] = useState<Generation | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [toast, setToast] = useState<ToastState>(null);
  const [providerModal, setProviderModal] = useState<{ open: boolean; provider: Provider | null }>({ open: false, provider: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testInfo, setTestInfo] = useState<Record<string, TestInfo>>({});
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadTheme());
  const startedRef = useRef(0);

  const provider = useMemo(
    () => (state ? state.providers.find((p) => p.id === providerId) || null : null),
    [state, providerId]
  );

  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (themeMode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [themeMode]);

  const changeTheme = useCallback((mode: ThemeMode) => {
    setThemeMode(mode);
    saveTheme(mode);
  }, []);

  const refresh = useCallback(async () => {
    const [next, hist] = await Promise.all([api.state(), api.generations(40)]);
    setState(next);
    setHistory(hist.generations);
    setProviderId((prev) => {
      if (prev && next.providers.some((p) => p.id === prev)) return prev;
      if (next.settings.defaultProviderId && next.providers.some((p) => p.id === next.settings.defaultProviderId)) {
        return next.settings.defaultProviderId;
      }
      return next.providers.length ? next.providers[0].id : "";
    });
  }, []);

  useEffect(() => {
    refresh()
      .catch((e) => setToast({ kind: "error", message: "无法连接本地服务", hint: e instanceof Error ? e.message : String(e), id: Date.now() }))
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    startedRef.current = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - startedRef.current), 100);
    return () => clearInterval(timer);
  }, [busy]);

  const handleGenerate = useCallback(
    async (payload: Omit<GeneratePayload, "providerId">) => {
      if (!provider) return;
      setBusy(true);
      try {
        const res = await api.generate(Object.assign({}, payload, { providerId: provider.id }));
        setCurrent(res.generation);
        api.generations(40).then((h) => setHistory(h.generations)).catch(() => {});
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(e instanceof Error ? e.message : String(e), "", 0);
        setToast({ kind: "error", message: err.message, hint: err.hint, id: Date.now() });
        api.generations(40).then((h) => setHistory(h.generations)).catch(() => {});
      } finally {
        setBusy(false);
      }
    },
    [provider]
  );

  const handleTest = useCallback(
    async (deep: boolean) => {
      if (!provider) return;
      const id = provider.id;
      setTestInfo((prev) => Object.assign({}, prev, { [id]: { busy: true } }));
      try {
        const res = await api.testProvider(id, deep);
        setTestInfo((prev) =>
          Object.assign({}, prev, {
            [id]: { busy: false, ok: res.ok, message: res.message, latencyMs: res.latencyMs, hint: res.hint }
          })
        );
        setToast({
          kind: res.ok ? "ok" : "error",
          message: (res.ok ? "连接正常 · " : "") + res.message,
          hint: res.hint || (res.unknown ? "可以用「深度测试」再确认一次" : ""),
          id: Date.now()
        });
        const next = await api.state();
        setState(next);
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(String(e), "", 0);
        setTestInfo((prev) => Object.assign({}, prev, { [id]: { busy: false, ok: false, message: err.message, hint: err.hint } }));
        setToast({ kind: "error", message: err.message, hint: err.hint, id: Date.now() });
      }
    },
    [provider]
  );

  const handleDeleteProvider = useCallback(
    async (target: Provider) => {
      if (!window.confirm("删除 Provider「" + target.name + "」？本地加密保存的 Key 也会一起删除。")) return;
      await api.deleteProvider(target.id);
      await refresh();
    },
    [refresh]
  );

  const handleDeleteGeneration = useCallback(async (gen: Generation) => {
    await api.deleteGeneration(gen.id);
    setHistory((prev) => prev.filter((item) => item.id !== gen.id));
    setCurrent((prev) => (prev && prev.id === gen.id ? null : prev));
  }, []);

  if (loading || !state) {
    return (
      <div className="flex h-full items-center justify-center bg-app">
        <div className="flex items-center gap-2 text-[13px] text-dim">
          <Sparkles className="h-4 w-4 animate-pulse text-accent" />
          正在启动本地工作台…
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-panel/90 px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-[0_6px_20px_-6px_rgba(139,92,246,0.9)]">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[14px] font-semibold tracking-tight text-ink">GPT Image Studio</h1>
              <span className="rounded-md border border-line2 px-1.5 py-0.5 text-[10px] text-dim">
                v{state.version}
              </span>
            </div>
            <p className="text-[11px] text-faint">本地运行 · Key 加密存放 · 支持官方与第三方中转</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {provider ? (
            <div className="hidden items-center gap-2 rounded-lg border border-line2 bg-elevated px-2.5 py-1.5 md:flex">
              <StatusDot
                state={testInfo[provider.id]?.busy ? "busy" : testInfo[provider.id]?.ok === false ? "error" : provider.lastTest ? (provider.lastTest.ok ? "ok" : "error") : "idle"}
              />
              <span className="text-[12px] text-soft">{provider.name}</span>
              <span className="max-w-[220px] truncate font-mono text-[10.5px] text-faint">{provider.baseUrl}</span>
            </div>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => handleTest(false)} disabled={!provider || testInfo[provider ? provider.id : ""]?.busy}>
            <Zap className="h-3.5 w-3.5" />
            {testInfo[provider ? provider.id : ""]?.busy ? "测试中" : "测试连接"}
          </Button>
          <IconButton
            title="打开图片目录"
            onClick={() => {
              api.reveal().catch(() => setToast({ kind: "error", message: "无法打开目录", id: Date.now() }));
            }}
          >
            <FolderOpen className="h-4 w-4" />
          </IconButton>
          <IconButton
            title={resolveTheme(themeMode) === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            onClick={() => changeTheme(resolveTheme(themeMode) === "dark" ? "light" : "dark")}
          >
            {resolveTheme(themeMode) === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </IconButton>
          <IconButton title="设置" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon className="h-4 w-4" />
          </IconButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <ProviderRail
          providers={state.providers}
          activeId={providerId}
          testInfo={testInfo}
          onSelect={setProviderId}
          onAdd={() => setProviderModal({ open: true, provider: null })}
          onEdit={(p) => setProviderModal({ open: true, provider: p })}
          onDelete={handleDeleteProvider}
          onTest={(p) => {
            setProviderId(p.id);
            handleTest(false);
          }}
        />

        <Composer
          provider={provider}
          presets={state.presets}
          sizePresets={state.sizePresets}
          busy={busy}
          elapsed={elapsed}
          testInfo={provider ? testInfo[provider.id] : undefined}
          onGenerate={handleGenerate}
        />

        <main className="flex min-w-0 flex-1">
          <Results generation={current} />
          <HistoryRail
            generations={history}
            onOpen={(gen) => setCurrent(gen)}
            onDelete={handleDeleteGeneration}
            onReveal={() => {
              api.reveal().catch(() => setToast({ kind: "error", message: "无法打开目录", id: Date.now() }));
            }}
          />
        </main>
      </div>

      <ProviderModal
        open={providerModal.open}
        provider={providerModal.provider}
        presets={state.presets}
        onClose={() => setProviderModal({ open: false, provider: null })}
        onSaved={async (saved) => {
          setProviderModal({ open: false, provider: null });
          await refresh();
          setProviderId(saved.id);
        }}
      />

      <SettingsModal
        open={settingsOpen}
        state={state}
        themeMode={themeMode}
        onThemeChange={changeTheme}
        onClose={() => setSettingsOpen(false)}
        onSaved={async () => {
          await refresh();
          setSettingsOpen(false);
        }}
        onToast={setToast}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}