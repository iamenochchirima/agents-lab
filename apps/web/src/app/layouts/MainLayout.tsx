import { Settings } from "lucide-react";
import { Link, Outlet, useMatches } from "react-router";

import { ThemeToggle } from "../theme/ThemeToggle";
import { MainSidebar } from "../navigation/MainSidebar";
import { appPaths } from "../../routes/paths";

interface RouteHandle {
  label?: string;
}

export function MainLayout() {
  const matches = useMatches();
  const handle = [...matches]
    .reverse()
    .map((match) => match.handle as RouteHandle | undefined)
    .find((candidate) => candidate?.label);

  return (
    <div className="app-shell">
      <MainSidebar />
      <div className="app-workspace">
        <header className="topbar">
          <span className="topbar-context">Agent Harness Lab</span>
          <span className="topbar-separator">/</span>
          <span className="topbar-page">{handle?.label ?? "Workspace"}</span>
          <div className="topbar-actions">
            <ThemeToggle />
            <Link aria-label="Open settings" className="topbar-settings" to={appPaths.settings}>
              <Settings aria-hidden="true" size={16} />
            </Link>
          </div>
        </header>
        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
