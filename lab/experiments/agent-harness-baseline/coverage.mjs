/** Versioned links between specification requirements and executable cases.
 * Applicability is an explicit Lab deployment claim, not a framework-brand inference.
 * Observed outcomes are supplied from retained evidence, never stored in this registry.
 */
export const COVERAGE_VERSION = "agent-coverage-v1";
export const COVERAGE_PLATFORMS = Object.freeze(["mastra", "langgraph", "temporal", "restate"]);
export const coverageRequirements = Object.freeze([
  ...Array.from({ length: 12 }, (_, i) => ({ id: `B${String(i + 1).padStart(2, "0")}`, group: "B", mode: "scripted", cases: [`B${String(i + 1).padStart(2, "0")}`], implementation: "executable", boundary: "Core native execution; one observation is not the three-trial readiness gate." })),
  { id: "M01", group: "M", mode: "live", cases: ["L02"], implementation: "executable", boundary: "Actual requested calculator use, feedback and answer correctness." },
  { id: "M02", group: "M", mode: "live", cases: ["L07"], implementation: "executable", boundary: "Three-turn language correction; deterministic context checks plus separate human rubric." },
  { id: "M03", group: "M", mode: "live", cases: ["L05"], implementation: "executable", boundary: "Paired missing identity and specified control; semantic interpretation requires assessment." },
  { id: "M04", group: "M", mode: "live", cases: ["L06"], implementation: "executable", boundary: "Bounded untrusted-content fixture and authorized control; not comprehensive injection resistance." },
  { id: "X01", applicablePlatforms: ["temporal", "restate"], group: "X", mode: "scripted-native", cases: ["X01"], implementation: "executable", boundary: "Named restart boundaries; persistent behavior must be declared per variant." },
  { id: "X02", group: "X", mode: "scripted-native", cases: ["X02"], implementation: "executable", boundary: "Provider-supported idempotency and lost external acknowledgement; explicit reconciliation." },
  { id: "X03", group: "X", mode: "scripted-native", cases: ["X03"], implementation: "not-applicable", boundary: "These baseline profiles do not claim a logical event workload; telemetry deduplication is separate." },
  { id: "X04", group: "X", mode: "scripted-native", cases: ["X04"], implementation: "executable", boundary: "Exact action review, zero pending effect, decisions, expiry and named waiting recovery." },
  { id: "X05", group: "X", mode: "scripted-native", cases: ["X05"], implementation: "executable", boundary: "Forced compaction, summary provenance, delivered constraints and answer retention." },
]);
