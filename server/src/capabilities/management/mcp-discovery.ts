import { HttpMcpServer, type HttpMcpServerOptions } from "../integrations/mcp/http-server.js";
import type { McpToolManifest } from "../integrations/mcp/local-transport.js";

/** Negotiate a newly configured HTTP source with bounded read-only discovery.
 * Existing admitted packages pin the returned version; tool invocation never uses
 * this fallback loop, so a write cannot be replayed under another protocol.
 * Authentication and network policy stay in the supplied host-owned callbacks.
 */
export async function discoverHttpMcp(options: Omit<HttpMcpServerOptions, "protocolVersion">, signal: AbortSignal): Promise<{ readonly protocolVersion: string; readonly tools: readonly McpToolManifest[] }> {
  const discoverySignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  for (const protocolVersion of ["2026-07-28", "2025-11-25", "2025-06-18"]) {
    if (discoverySignal.aborted) throw new Error("MCP discovery was cancelled or timed out.");
    const server = new HttpMcpServer({ ...options, protocolVersion });
    try {
      const tools = await server.listTools(discoverySignal);
      return { protocolVersion: server.protocolVersion, tools };
    } catch { if (discoverySignal.aborted) throw new Error("MCP discovery was cancelled or timed out."); }
    finally { await server.close(); }
  }
  throw new Error("MCP discovery failed for supported HTTP protocol versions. Check the connection, credentials and provider compatibility.");
}
