import { useTheme } from "@/app/theme/theme";
import type { Theme } from "@/app/theme/theme";

const modes: readonly { id: Theme; label: string; description: string }[] = [
  { id: "light", label: "Light", description: "Crisp and bright" },
  { id: "dark", label: "Dark", description: "Easy on the eyes" },
  { id: "system", label: "System", description: "Follows your OS" },
];

export function ThemeModePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <div aria-label="Theme mode" className="theme-mode-grid" role="group">
      {modes.map((mode) => {
        const selected = theme === mode.id;

        return (
          <button
            aria-pressed={selected}
            className={`theme-mode-card ${selected ? "is-selected" : ""}`}
            key={mode.id}
            onClick={() => setTheme(mode.id)}
            type="button"
          >
            <div className={`theme-mode-preview ${mode.id}`}>
              <div className="theme-mode-preview-bar" />
            </div>
            <div className="theme-mode-card-copy">
              <strong>{mode.label}</strong>
              <small>{mode.description}</small>
            </div>
          </button>
        );
      })}
    </div>
  );
}
