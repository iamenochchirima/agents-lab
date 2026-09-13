import { ArrowUpRight } from "lucide-react";
import { Link, Outlet } from "react-router";

import { appPaths } from "../../routes/paths";

export function DocumentationLayout() {
  return (
    <div className="documentation-app">
      <header className="documentation-topbar">
        <Link className="documentation-brand" to={appPaths.overview}>
          <img alt="" className="documentation-brand-mark" src="/brand/icons/agents-lab-icon-gradient.svg" />
          <span>
            <strong>Agent Harness Lab</strong>
            <small>documentation</small>
          </span>
        </Link>
        <span className="documentation-topbar-separator">/</span>
        <span className="documentation-topbar-title">Docs</span>
        <Link className="back-to-lab" to={appPaths.overview}>
          Back to lab <ArrowUpRight aria-hidden="true" size={15} />
        </Link>
      </header>

      <Outlet />
    </div>
  );
}
