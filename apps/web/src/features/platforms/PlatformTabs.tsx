import { NavLink } from "react-router";

import { appPaths } from "../../routes/paths";
import { platformCatalog } from "./platformCatalog";

export function PlatformTabs({ activePlatformId }: { activePlatformId: string }) {
  return (
    <nav aria-label="Agent platforms" className="platform-tabs">
      {platformCatalog.map((platform) => (
        <NavLink
          className={({ isActive }) => `platform-tab ${isActive || platform.id === activePlatformId ? "is-active" : ""}`}
          end
          key={platform.id}
          to={appPaths.platform(platform.id)}
        >
          {platform.name}
        </NavLink>
      ))}
    </nav>
  );
}
