import { CapabilityManager } from "./CapabilityManager";

/** Platform navigation owns placement; management remains a shared workspace
 * service rather than another native agent runtime or platform-specific catalog.
 */
export function PlatformPluginsPage() {
  return <div className="platform-plugins-page"><CapabilityManager presentation="page" onChanged={() => {}} /></div>;
}
