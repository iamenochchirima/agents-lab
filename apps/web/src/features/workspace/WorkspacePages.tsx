import { WorkspaceSectionView } from "./WorkspaceSectionView";

export function RunsPage() {
  return <WorkspaceSectionView view="runs" />;
}

export function ExperimentsPage() {
  return <WorkspaceSectionView view="experiments" />;
}

export function PlatformsPage() {
  return <WorkspaceSectionView view="platforms" />;
}

export function ScenariosPage() {
  return <WorkspaceSectionView view="scenarios" />;
}
