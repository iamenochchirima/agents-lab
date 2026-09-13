import { AccentPicker } from "./AccentPicker";
import { DensityPicker } from "./DensityPicker";
import { InterfacePreferences } from "./InterfacePreferences";
import { ThemeModePicker } from "./ThemeModePicker";

export function SettingsView() {
  return (
    <div className="page-content settings-page">
      <section className="page-heading">
        <div>
          <span className="eyebrow">Application</span>
          <h1>Settings</h1>
          <p>Change the way the lab looks and behaves. These preferences apply across the application and are stored in this browser.</p>
        </div>
      </section>

      <section className="panel settings-panel">
        <div className="settings-section">
          <div className="settings-section-heading">
            <span className="panel-label">Theme</span>
            <h2>Choose a colour mode</h2>
            <p>System mode follows the operating system preference and updates when it changes.</p>
          </div>
          <ThemeModePicker />
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <span className="panel-label">Accent</span>
            <h2>Choose a visual tone</h2>
            <p>The selected accent updates links, focus rings, active navigation, and status emphasis.</p>
          </div>
          <AccentPicker />
        </div>

        <div className="settings-section">
          <div className="settings-section-heading">
            <span className="panel-label">Interface</span>
            <h2>Adjust density and motion</h2>
          </div>
          <DensityPicker />
          <p className="settings-description">Compact reduces spacing inside cards and data panels.</p>
          <div className="settings-interface-spacer" />
          <InterfacePreferences />
        </div>
      </section>
    </div>
  );
}
