export type ThemeMode = "dark" | "light" | "system";

const STORAGE_KEY = "gpt-image-studio-theme";

export function loadTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "dark" || value === "light" || value === "system") return value;
  } catch (e) {}
  return "dark";
}

export function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    try {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    } catch (e) {
      return "dark";
    }
  }
  return mode;
}

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

export function saveTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch (e) {}
  applyTheme(mode);
}
