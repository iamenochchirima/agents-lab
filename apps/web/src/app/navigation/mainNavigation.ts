import {
  FlaskConical,
  Layers3,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  Play,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { appPaths } from "../../routes/paths";

export interface MainNavigationItem {
  label: string;
  icon: LucideIcon;
  to: string;
}

export const mainNavigation: readonly MainNavigationItem[] = [
  { label: "Overview", icon: LayoutDashboard, to: appPaths.overview },
  { label: "Coverage", icon: ListChecks, to: appPaths.coverage },
  { label: "Runs", icon: Play, to: appPaths.runs },
  { label: "Experiments", icon: FlaskConical, to: appPaths.experiments },
  { label: "Platforms", icon: Layers3, to: appPaths.platforms },
  { label: "Scenarios", icon: ListTodo, to: appPaths.scenarios },
];
