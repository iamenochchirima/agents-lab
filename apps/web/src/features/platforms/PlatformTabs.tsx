import { NavLink, useLocation } from "react-router";

import { appPaths } from "../../routes/paths";
import { platformCatalog } from "./platformCatalog";

export function PlatformTabs({ activePlatformId }: { activePlatformId: string }) {
  const location = useLocation();
  const viewingPlugins = /^\/platforms\/[^/]+\/plugins\/?$/.test(location.pathname);
  return (
    <nav aria-label="Agent platforms" className="platform-tabs">
      {platformCatalog.filter((platform) => platform.id !== "aws-step-functions").map((platform) => (
        <NavLink
          className={({ isActive }) => `platform-tab ${isActive || platform.id === activePlatformId ? "is-active" : ""}`}
          end
          key={platform.id}
          to={viewingPlugins ? appPaths.platformPlugins(platform.id) : appPaths.platform(platform.id)}
        >
          {platform.name}
        </NavLink>
      ))}
    </nav>
  );
}
