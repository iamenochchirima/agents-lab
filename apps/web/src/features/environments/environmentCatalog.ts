import type { Availability } from "../platforms/platformTypes";

export interface EnvironmentDescriptor {
  compatiblePlatformIds: readonly string[];
  description: string;
  id: string;
  isolation: string;
  lifecycle: string;
  name: string;
  network: string;
  resourceControls: string;
  status: Availability;
  workspace: string;
}

const anesuPlatformIds = ["anesu"] as const;

/** Computer environments belong to the external Anesu harness only. */
export const environmentCatalog: readonly EnvironmentDescriptor[] = [
  {
    id: "local-workspace",
    name: "Local workspace process",
    description: "A host-managed workspace for inspecting the harness with direct local files and processes.",
    isolation: "Host process and configured workspace path",
    workspace: "Persistent directory with explicit ownership",
    network: "Inherited from the local process",
    resourceControls: "Process and command timeouts",
    lifecycle: "Prepare → attach → run → inspect → reset on request",
    status: "planned",
    compatiblePlatformIds: anesuPlatformIds,
  },
  {
    id: "sandboxed-container",
    name: "Sandboxed container",
    description: "An isolated computer workspace for controlled filesystem and program execution.",
    isolation: "Container boundary",
    workspace: "Disposable or persistent mounted volume",
    network: "Disabled or restricted by profile",
    resourceControls: "CPU, memory, disk, process, and execution-time limits",
    lifecycle: "Provision → health check → attach → collect artifacts → cleanup",
    status: "planned",
    compatiblePlatformIds: anesuPlatformIds,
  },
  {
    id: "remote-vm",
    name: "VM / remote computer",
    description: "A remotely provisioned computer for long-lived compute-native agent work.",
    isolation: "VM or dedicated remote host boundary",
    workspace: "Persistent remote disk",
    network: "Provider and environment policy",
    resourceControls: "Provider instance limits and session timeouts",
    lifecycle: "Provision → connect → run → collect → suspend or destroy",
    status: "planned",
    compatiblePlatformIds: anesuPlatformIds,
  },
];

export function getEnvironment(environmentId: string | undefined): EnvironmentDescriptor | undefined {
  return environmentCatalog.find((environment) => environment.id === environmentId);
}
