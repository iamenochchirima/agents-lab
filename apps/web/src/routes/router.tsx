import { createBrowserRouter } from "react-router";

import { MainLayout } from "../app/layouts/MainLayout";
import { RouteErrorPage } from "../features/system/RouteErrorPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: MainLayout,
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
        path: "experiments",
        lazy: async () => {
          const { ExperimentsPage } = await import("../features/workspace/WorkspacePages");
          return { Component: ExperimentsPage };
        },
        handle: { label: "Experiments" },
      },
      {
        path: "platforms",
        lazy: async () => {
          const { PlatformIndexPage } = await import("../features/platforms/PlatformIndexPage");
          return { Component: PlatformIndexPage };
        },
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
        ],
      },
      {
        path: "environments",
        lazy: async () => {
          const { EnvironmentsPage } = await import("../features/environments/EnvironmentPages");
          return { Component: EnvironmentsPage };
        },
        handle: { label: "Environments" },
      },
      {
        path: "environments/:environmentId",
        lazy: async () => {
          const { EnvironmentDetailPage } = await import("../features/environments/EnvironmentPages");
          return { Component: EnvironmentDetailPage };
        },
        handle: { label: "Environment profile" },
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
