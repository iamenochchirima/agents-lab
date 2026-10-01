const REQUIRED_LINUX_CHECKS = [
  "binary_version",
  "platform_supported",
  "session_active",
  "ax_capability",
  "screen_capture_capability",
] as const;

/**
 * Validate the stable Linux health contract used by both Cua runtimes.
 * `overall: "ok"` alone is not enough because a future driver could omit a
 * check or report a different platform while keeping the aggregate healthy.
 */
export function cuaLinuxHealthProblem(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "the health report is not an object";
  const report = value as Record<string, unknown>;
  if (report.schema_version !== "1") return "the health report schema version is unsupported";
  if (report.platform !== "linux") return "the health report is not for Linux";
  if (report.overall !== "ok") return "the aggregate health status is not ok";
  if (!Array.isArray(report.checks)) return "the health report has no check list";

  const checks = new Map<string, string>();
  for (const entry of report.checks) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.name === "string" && typeof record.status === "string") {
      checks.set(record.name, record.status);
    }
  }
  const failed = REQUIRED_LINUX_CHECKS.find((name) => checks.get(name) !== "pass");
  return failed ? `required Linux health check '${failed}' did not pass` : undefined;
}
