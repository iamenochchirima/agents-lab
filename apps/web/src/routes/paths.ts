/** Public browser paths shared by navigation and feature links. */
export const appPaths = {
  overview: "/",
  coverage: "/coverage",
  runs: "/runs",
  experiments: "/experiments",
  platforms: "/platforms",
  scenarios: "/scenarios",
  architecture: "/architecture",
  repository: "/repository",
  settings: "/settings",
  docs: "/docs",
  studio: "/studio",
  studioChat: "/studio/chat",
  components: "/components",
  platform: (platformId: string) => `/platforms/${platformId}`,
  platformSection: (platformId: string, section: string) => `/platforms/${platformId}/${section}`,
  component: (areaId: string) => `/components/${areaId}`,
} as const;
