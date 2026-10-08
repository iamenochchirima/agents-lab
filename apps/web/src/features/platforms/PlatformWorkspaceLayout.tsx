import { NavLink, Outlet, useParams } from "react-router";

import { getPlatform } from "./platformCatalog";
import type { PlatformDescriptor } from "./platformTypes";
import { PlatformTabs } from "./PlatformTabs";
import { appPaths } from "../../routes/paths";
import "./platforms.css";

export interface PlatformOutletContext {
  platform: PlatformDescriptor;
}

export function PlatformWorkspaceLayout() {
  const { platformId } = useParams();
  const platform = getPlatform(platformId);

  if (!platform) {
    return <div className="page-content"><section className="panel empty-state"><h1>Platform not found</h1><p>The selected platform is not registered in the laboratory.</p></section></div>;
  }

  return (
    <div className="page-content platform-page">
      <PlatformTabs activePlatformId={platform.id} />
      <nav className="platform-section-nav" aria-label={`${platform.name} workspace`}>
        <NavLink end className={({ isActive }) => `platform-section-link${isActive ? " is-active" : ""}`} to={appPaths.platform(platform.id)}>Run setup</NavLink>
        <NavLink className={({ isActive }) => `platform-section-link${isActive ? " is-active" : ""}`} to={appPaths.platformSection(platform.id, "chat")}>Chat</NavLink>
        <NavLink className={({ isActive }) => `platform-section-link${isActive ? " is-active" : ""}`} to={appPaths.platformPlugins(platform.id)}>Plugins</NavLink>
      </nav>

      <Outlet context={{ platform }} />
    </div>
  );
}
