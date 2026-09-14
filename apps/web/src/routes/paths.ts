/** Public browser paths shared by navigation and feature links. */
export const appPaths = {
  overview: "/",
  coverage: "/coverage",
  runs: "/runs",
  experiments: "/experiments",
  platforms: "/platforms",
  environments: "/environments",
  scenarios: "/scenarios",
  architecture: "/architecture",
  repository: "/repository",
  settings: "/settings",
  docs: "/docs",
  platform: (platformId: string) => `/platforms/${platformId}`,
  platformSection: (platformId: string, section: string) => `/platforms/${platformId}/${section}`,
  environment: (environmentId: string) => `/environments/${environmentId}`,
} as const;
