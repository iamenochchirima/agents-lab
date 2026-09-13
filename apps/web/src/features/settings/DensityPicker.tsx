import { setDensity, usePreferences } from "@/app/theme/preferences";

export function DensityPicker() {
  const { density } = usePreferences();

  return (
    <div aria-label="Interface density" className="density-picker" role="group">
      {(["comfortable", "compact"] as const).map((option) => (
        <button
          aria-pressed={density === option}
          className={`density-option ${density === option ? "is-selected" : ""}`}
          key={option}
          onClick={() => setDensity(option)}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
}
