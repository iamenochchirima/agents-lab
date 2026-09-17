export type Availability = "planned" | "in-progress" | "ready";
export type PlatformKind = "backend" | "compute-native";

export interface BackendProfileDescriptor {
  description: string;
  id: string;
  name: string;
  status: Availability;
}

export interface PlatformVariantDescriptor {
  description: string;
  id: string;
  name: string;
  status: Availability;
}

export interface PlatformInfrastructureDescriptor {
  description: string;
  id: string;
  name: string;
  requirement: "required" | "optional";
  status: Availability;
}

export interface PlatformDescriptor {
  backendProfiles: readonly BackendProfileDescriptor[];
  computerEnvironmentIds: readonly string[];
  description: string;
  durabilityModel: string;
  executionModel: string;
  id: string;
  implementationDocumentId: string;
  infrastructure: readonly PlatformInfrastructureDescriptor[];
  language: string;
  name: string;
  kind: PlatformKind;
  role: string;
  runtime: string;
  status: Availability;
  variants: readonly PlatformVariantDescriptor[];
}
