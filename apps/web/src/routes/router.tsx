import { createBrowserRouter, redirect } from "react-router";

import { MainLayout } from "../app/layouts/MainLayout";
import { RouteErrorPage } from "../features/system/RouteErrorPage";
import { appPaths } from "./paths";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: MainLayout,
    HydrateFallback: RouteHydrateFallback,
    errorElement: <RouteErrorPage />,
    children: [
      {
        index: true,
        lazy: async () => {
          const { OverviewPage } = await import("../features/overview/OverviewPage");
          return { Component: OverviewPage };
        },
        handle: { label: "Overview" },
      },
      {
        path: "studio",
        lazy: async () => {
          const { StudioPrototypePage } = await import("../features/studio/StudioPrototypePage");
          return { Component: StudioPrototypePage };
        },
        handle: { label: "Studio" },
      },
      {
        path: "studio/hermes",
        lazy: async () => {
          const { HermesSimulationPage } = await import("../features/hermes-simulation/HermesSimulationPage");
          return { Component: HermesSimulationPage };
        },
        handle: { label: "Studio / Hermes simulation" },
      },
      {
        path: "studio/lina",
        lazy: async () => {
          const { LinaPage } = await import("../features/lina/LinaPage");
          return { Component: LinaPage };
        },
        handle: { label: "Studio / Lina architecture" },
      },
      {
        path: "studio/explorers",
        lazy: async () => {
          const { SystemExplorerIndex } = await import("../features/system-explorer/SystemExplorerIndex");
          return { Component: SystemExplorerIndex };
        },
        handle: { label: "Studio / System explorers" },
      },
      {
        path: "studio/comparison",
        lazy: async () => {
          const { SystemComparisonPage } = await import("../features/system-comparison/SystemComparisonPage");
          return { Component: SystemComparisonPage };
        },
        handle: { label: "Studio / System comparison" },
      },
      {
        path: "studio/openclaw",
        lazy: async () => {
          const { OpenClawExplorerPage } = await import("../features/system-explorer/OpenClawExplorerPage");
          return { Component: OpenClawExplorerPage };
        },
        handle: { label: "Studio / OpenClaw explorer" },
      },
      {
        path: "studio/pi",
        lazy: async () => {
          const { PiExplorerPage } = await import("../features/system-explorer/PiExplorerPage");
          return { Component: PiExplorerPage };
        },
        handle: { label: "Studio / Pi explorer" },
      },
      {
        path: "studio/waku",
        lazy: async () => {
          const { WakuExplorerPage } = await import("../features/system-explorer/WakuExplorerPage");
          return { Component: WakuExplorerPage };
        },
        handle: { label: "Studio / Waku Agent explorer" },
      },
      {
        path: "studio/chat",
        lazy: async () => {
          const { StudioChatPage } = await import("../features/studio/StudioChatPage");
          return { Component: StudioChatPage };
        },
        handle: { label: "Studio chat" },
      },
      {
        path: "coverage",
        lazy: async () => {
          const { CoveragePage } = await import("../features/coverage/CoveragePage");
          return { Component: CoveragePage };
        },
        handle: { label: "Harness coverage" },
      },
      {
        path: "runs",
        lazy: async () => {
          const { RunsPage } = await import("../features/workspace/WorkspacePages");
          return { Component: RunsPage };
        },
        handle: { label: "Runs" },
      },
      {
        path: "evals",
        lazy: async () => {
          const { EvalsPage } = await import("../features/evals/EvalsPage");
          return { Component: EvalsPage };
        },
        handle: { label: "Agent evals" },
      },
      {
        path: "experiments",
        lazy: async () => {
          const { ExperimentsPage } = await import("../features/workspace/WorkspacePages");
          return { Component: ExperimentsPage };
        },
        handle: { label: "Experiments" },
      },
      {
        path: "components",
        lazy: async () => {
          const { ComponentLabPage } = await import("../features/component-lab/ComponentLabPage");
          return { Component: ComponentLabPage };
        },
        handle: { label: "Studio" },
      },
      {
        path: "components/:areaId",
        lazy: async () => {
          const { ComponentLabAreaPage } = await import("../features/component-lab/ComponentLabPage");
          return { Component: ComponentLabAreaPage };
        },
        handle: { label: "Studio" },
      },
      {
        path: "platforms",
        Component: PlatformIndexRedirectFallback,
        loader: () => redirect(appPaths.platform("temporal")),
        handle: { label: "Platforms" },
      },
      {
        path: "platforms/:platformId",
        lazy: async () => {
          const { PlatformWorkspaceLayout } = await import("../features/platforms/PlatformWorkspaceLayout");
          return { Component: PlatformWorkspaceLayout };
        },
        handle: { label: "Platform workspace" },
        children: [
          {
            index: true,
            lazy: async () => {
              const { PlatformRunnerPage } = await import("../features/platforms/PlatformRunnerPage");
              return { Component: PlatformRunnerPage };
            },
            handle: { label: "Platform runner" },
          },
          {
            path: "chat",
            lazy: async () => {
              const { PlatformChatPage } = await import("../features/platforms/PlatformChatPage");
              return { Component: PlatformChatPage };
            },
            handle: { label: "Platform chat" },
          },
          {
            path: "plugins",
            lazy: async () => {
              const { PlatformPluginsPage } = await import("../features/platforms/PlatformPluginsPage");
              return { Component: PlatformPluginsPage };
            },
            handle: { label: "Platform plugins" },
          },
        ],
      },
      {
        path: "scenarios",
        lazy: async () => {
          const { ScenariosPage } = await import("../features/workspace/WorkspacePages");
          return { Component: ScenariosPage };
        },
        handle: { label: "Scenarios" },
      },
      {
        path: "architecture",
        lazy: async () => {
          const { ArchitecturePage } = await import("../features/architecture/ArchitecturePage");
          return { Component: ArchitecturePage };
        },
        handle: { label: "Architecture" },
      },
      {
        path: "repository",
        lazy: async () => {
          const { RepositoryMapPage } = await import("../features/repository-map/RepositoryMapPage");
          return { Component: RepositoryMapPage };
        },
        handle: { label: "Repository map" },
      },
      {
        path: "settings",
        lazy: async () => {
          const { SettingsPage } = await import("../features/settings/SettingsPage");
          return { Component: SettingsPage };
        },
        handle: { label: "Settings" },
      },
      {
        path: "*",
        lazy: async () => {
          const { NotFoundPage } = await import("../features/system/NotFoundPage");
          return { Component: NotFoundPage };
        },
        handle: { label: "Not found" },
      },
    ],
  },
  {
    path: "/docs",
    errorElement: <RouteErrorPage />,
    lazy: async () => {
      const { DocumentationLayout } = await import("../features/documentation/DocumentationLayout");
      return { Component: DocumentationLayout };
    },
    children: [
      {
        index: true,
        lazy: async () => {
          const { DocumentationPage } = await import("../features/documentation/DocumentationPage");
          return { Component: DocumentationPage };
        },
      },
      {
        path: "*",
        lazy: async () => {
          const { DocumentationPage } = await import("../features/documentation/DocumentationPage");
          return { Component: DocumentationPage };
        },
      },
    ],
  },
]);

function PlatformIndexRedirectFallback() {
  return null;
}

function RouteHydrateFallback() {
  return <div aria-busy="true" />;
}
