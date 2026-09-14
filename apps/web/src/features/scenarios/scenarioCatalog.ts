export interface ScenarioOption {
  description: string;
  id: string;
  name: string;
}

export const scenarioCatalog: readonly ScenarioOption[] = [
  { id: "research", name: "Research task", description: "Gather information and produce a traceable artifact." },
  { id: "coding", name: "Coding task", description: "Inspect a repository, change code, and verify the result." },
  { id: "transactional", name: "Transactional task", description: "Coordinate approval, side effects, and external updates." },
  { id: "filesystem", name: "Filesystem task", description: "Use a workspace to inspect files and produce an artifact." },
];
