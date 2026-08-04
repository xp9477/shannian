export type Density = "comfortable" | "compact";
export type ThemeMode = "system" | "light" | "dark";
export type ViewMode = "list" | "grid";

const DENSITY_KEY = "shannian_density";
const THEME_KEY = "shannian_theme";
const VIEW_KEY = "shannian_view";

export function getDensity(): Density {
  return (localStorage.getItem(DENSITY_KEY) as Density) || "comfortable";
}

export function setDensity(d: Density) {
  localStorage.setItem(DENSITY_KEY, d);
}

export function getViewMode(): ViewMode {
  return (localStorage.getItem(VIEW_KEY) as ViewMode) || "list";
}

export function setViewMode(v: ViewMode) {
  localStorage.setItem(VIEW_KEY, v);
}

export function getThemeMode(): ThemeMode {
  return (localStorage.getItem(THEME_KEY) as ThemeMode) || "light";
}

export function setThemeMode(m: ThemeMode) {
  localStorage.setItem(THEME_KEY, m);
  applyTheme(m);
}

export function applyTheme(mode: ThemeMode = getThemeMode()) {
  const dark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
