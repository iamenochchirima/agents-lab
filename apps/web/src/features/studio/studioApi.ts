import { isStudioApiHealth, type StudioApiHealth } from "@agent-harness-lab/studio-http-contract";

const STUDIO_API_BASE_URL = (import.meta.env.VITE_AGENTLAB_STUDIO_API_URL || "http://127.0.0.1:4320").replace(/\/$/, "");

export async function getStudioApiHealth(signal?: AbortSignal): Promise<StudioApiHealth> {
  const response = await fetch(`${STUDIO_API_BASE_URL}/health`, { signal });
  if (!response.ok) {
    throw new Error(`Studio API health request failed with HTTP ${response.status}.`);
  }

  const body: unknown = await response.json();
  if (!isStudioApiHealth(body)) {
    throw new Error("Studio API returned an invalid health response.");
  }
  return body;
}
