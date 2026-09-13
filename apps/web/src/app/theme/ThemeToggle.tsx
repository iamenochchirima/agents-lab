import { Moon, Sun } from "lucide-react";

import { useTheme } from "./theme";

export function ThemeToggle() {
  const { resolvedTheme, toggle } = useTheme();
  const dark = resolvedTheme === "dark";

  return (
    <button
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="theme-toggle"
      onClick={toggle}
      type="button"
    >
      <span aria-hidden="true">{dark ? <Moon size={16} /> : <Sun size={16} />}</span>
      <span className="sr-only">{dark ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}
