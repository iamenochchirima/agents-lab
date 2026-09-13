import { BookOpen, Settings } from "lucide-react";
import { NavLink, Link } from "react-router";

import { appPaths } from "../../routes/paths";
import { mainNavigation } from "./mainNavigation";

export function MainSidebar() {
  return (
    <aside className="app-sidebar">
      <Link className="brand" to={appPaths.overview}>
        <img alt="" className="brand-mark" src="/brand/icons/agents-lab-icon-gradient.svg" />
        <span className="brand-copy">
          <strong>Agent Harness Lab</strong>
          <small>local workspace</small>
        </span>
      </Link>

      <nav aria-label="Workspace navigation" className="sidebar-navigation">
        {mainNavigation.map((item) => (
          <NavLink
            className={({ isActive }) => `sidebar-link ${isActive ? "is-active" : ""}`}
            end={item.to === appPaths.overview}
            key={item.to}
            to={item.to}
          >
            <span aria-hidden="true" className="sidebar-link-icon">
              <item.icon />
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-rule" />
        <NavLink
          className={({ isActive }) => `sidebar-link ${isActive ? "is-active" : ""}`}
          to={appPaths.settings}
        >
          <span aria-hidden="true" className="sidebar-link-icon"><Settings /></span>
          <span>Settings</span>
        </NavLink>
        <NavLink
          className={({ isActive }) => `sidebar-link ${isActive ? "is-active" : ""}`}
          to={appPaths.docs}
        >
          <span aria-hidden="true" className="sidebar-link-icon"><BookOpen /></span>
          <span>Docs</span>
        </NavLink>
      </div>
    </aside>
  );
}
