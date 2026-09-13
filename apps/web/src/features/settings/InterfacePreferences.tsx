import { Switch } from "@/components/ui/switch";
import { setInterfacePreference, usePreferences } from "@/app/theme/preferences";

const preferences = [
  {
    key: "reduceMotion",
    title: "Reduce motion",
    description: "Shorten transitions and disable decorative animation.",
  },
  {
    key: "liveIndicators",
    title: "Show live indicators",
    description: "Show status pulses when live execution data is available.",
  },
] as const;

export function InterfacePreferences() {
  const { interface: currentPreferences } = usePreferences();

  return (
    <div className="preference-list">
      {preferences.map((preference) => (
        <label className="preference-row" key={preference.key}>
          <span>
            <strong>{preference.title}</strong>
            <p>{preference.description}</p>
          </span>
          <Switch
            aria-label={preference.title}
            checked={currentPreferences[preference.key]}
            onCheckedChange={(checked) => setInterfacePreference(preference.key, checked)}
          />
        </label>
      ))}
    </div>
  );
}
