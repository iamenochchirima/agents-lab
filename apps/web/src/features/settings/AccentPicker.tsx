import type { CSSProperties } from "react";
import { Check } from "lucide-react";

import { ACCENT_PRESETS, setAccent, usePreferences } from "@/app/theme/preferences";

export function AccentPicker() {
  const { accentId } = usePreferences();
  const selectedAccent = ACCENT_PRESETS.find((accent) => accent.id === accentId) ?? ACCENT_PRESETS[0];

  return (
    <div className="accent-picker">
      {ACCENT_PRESETS.map((accent) => (
        <button
          aria-label={`${accent.name} accent`}
          aria-pressed={accent.id === accentId}
          className={`accent-swatch ${accent.id === accentId ? "is-selected" : ""}`}
          key={accent.id}
          onClick={() => setAccent(accent.id)}
          style={{ "--swatch": accent.swatch } as CSSProperties}
          title={accent.name}
          type="button"
        >
          {accent.id === accentId && <Check aria-hidden="true" size={14} />}
        </button>
      ))}
      <span className="accent-picker-name">{selectedAccent.name}</span>
    </div>
  );
}
