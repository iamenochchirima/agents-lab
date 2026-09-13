import { useSyncExternalStore } from "react";

export interface AccentTokens {
  accent: string;
  strong: string;
  soft: string;
  two: string;
}

export interface AccentPreset {
  id: string;
  name: string;
  swatch: string;
  light: AccentTokens;
  dark: AccentTokens;
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  {
    id: "indigo",
    name: "Indigo",
    swatch: "#5B5BF0",
    light: { accent: "#5B5BF0", strong: "#4A46E8", soft: "rgba(91, 91, 240, 0.10)", two: "#8B5CF6" },
    dark: { accent: "#818CF8", strong: "#6366F1", soft: "rgba(129, 140, 248, 0.12)", two: "#A78BFA" },
  },
  {
    id: "violet",
    name: "Violet",
    swatch: "#8B5CF6",
    light: { accent: "#8B5CF6", strong: "#7C3AED", soft: "rgba(139, 92, 246, 0.10)", two: "#A855F7" },
    dark: { accent: "#A78BFA", strong: "#8B5CF6", soft: "rgba(167, 139, 250, 0.12)", two: "#C084FC" },
  },
  {
    id: "cyan",
    name: "Cyan",
    swatch: "#0EA5E9",
    light: { accent: "#0EA5E9", strong: "#0284C7", soft: "rgba(14, 165, 233, 0.10)", two: "#06B6D4" },
    dark: { accent: "#38BDF8", strong: "#0EA5E9", soft: "rgba(56, 189, 248, 0.12)", two: "#22D3EE" },
  },
  {
    id: "emerald",
    name: "Emerald",
    swatch: "#10B981",
    light: { accent: "#10B981", strong: "#059669", soft: "rgba(16, 185, 129, 0.10)", two: "#14B8A6" },
    dark: { accent: "#34D399", strong: "#10B981", soft: "rgba(52, 211, 153, 0.12)", two: "#2DD4BF" },
  },
  {
    id: "rose",
    name: "Rose",
    swatch: "#F43F5E",
    light: { accent: "#F43F5E", strong: "#E11D48", soft: "rgba(244, 63, 94, 0.10)", two: "#EC4899" },
    dark: { accent: "#FB7185", strong: "#F43F5E", soft: "rgba(251, 113, 133, 0.12)", two: "#F472B6" },
  },
] as const;

export type Density = "comfortable" | "compact";

export interface InterfacePreferences {
  reduceMotion: boolean;
  liveIndicators: boolean;
}

interface PreferencesState {
  accentId: string;
  density: Density;
  interface: InterfacePreferences;
}

const STORAGE_KEYS = {
  accent: "agentlab-accent",
  density: "agentlab-density",
  reduceMotion: "agentlab-pref-reduce-motion",
  liveIndicators: "agentlab-pref-live-indicators",
} as const;

let initialized = false;
const listeners = new Set<() => void>();

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preferences continue to work for the current session.
  }
}

function readState(): PreferencesState {
  const storedAccent = readStorage(STORAGE_KEYS.accent);
  return {
    accentId: ACCENT_PRESETS.find((accent) => accent.id === storedAccent)?.id ?? "indigo",
    density: readStorage(STORAGE_KEYS.density) === "compact" ? "compact" : "comfortable",
    interface: {
      reduceMotion: readStorage(STORAGE_KEYS.reduceMotion) === "1",
      liveIndicators: readStorage(STORAGE_KEYS.liveIndicators) !== "0",
    },
  };
}

let state = readState();

function emit() {
  listeners.forEach((listener) => listener());
}

function applyAccentToDom() {
  if (typeof document === "undefined") return;
  const preset = ACCENT_PRESETS.find((accent) => accent.id === state.accentId) ?? ACCENT_PRESETS[0];
  const tokens = document.documentElement.classList.contains("dark") ? preset.dark : preset.light;
  const root = document.documentElement.style;
  root.setProperty("--accent", tokens.accent);
  root.setProperty("--accent-strong", tokens.strong);
  root.setProperty("--accent-soft", tokens.soft);
  root.setProperty("--accent-2", tokens.two);
}

function applyPreferencesToDom() {
  if (typeof document === "undefined") return;
  applyAccentToDom();
  const root = document.documentElement;
  root.dataset.density = state.density;
  root.classList.toggle("v-reduce-motion", state.interface.reduceMotion);
  root.classList.toggle("v-hide-live", !state.interface.liveIndicators);
}

export function initializePreferences() {
  if (initialized || typeof document === "undefined") return;
  initialized = true;
  applyPreferencesToDom();

  new MutationObserver(applyAccentToDom).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

function setState(next: Partial<PreferencesState>) {
  state = { ...state, ...next };
  applyPreferencesToDom();
  emit();
}

export function subscribePreferences(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setAccent(id: string) {
  if (!ACCENT_PRESETS.some((accent) => accent.id === id)) return;
  writeStorage(STORAGE_KEYS.accent, id);
  setState({ accentId: id });
}

export function setDensity(density: Density) {
  writeStorage(STORAGE_KEYS.density, density);
  setState({ density });
}

export function setInterfacePreference(key: keyof InterfacePreferences, value: boolean) {
  const storageKey = key === "reduceMotion" ? STORAGE_KEYS.reduceMotion : STORAGE_KEYS.liveIndicators;
  writeStorage(storageKey, value ? "1" : "0");
  setState({ interface: { ...state.interface, [key]: value } });
}

export function usePreferences() {
  return useSyncExternalStore(subscribePreferences, () => state, () => state);
}
