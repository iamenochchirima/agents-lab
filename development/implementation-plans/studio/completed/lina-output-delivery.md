# Lina Output and delivery

## Scope and accepted decisions

Implement the [Output research](../../../../docs/research/lina/output-research.md) as a maintained graph, JSON contracts/examples and deterministic Studio simulation. Native adapter operations are controlled fixtures. This does not add live channel sends, credential exchange, a runtime outbox or platform reliability guarantees.

Final-only is the default presentation. Required final/prompt custody transfers before dispatch and execution release. Preview acceptance cannot fulfill a final obligation. Unknown non-idempotent sends hold for exact reconciliation by default; explicitly configured warned resend records duplicate risk. Internal child results stay with their parent unless separately admitted for publication. State owns storage, Safety owns authorization, Input owns prompt answers and Environment owns artifact access/custody.

## Checklist

- [x] Thirteen nodes with branch edges, source-owned handoffs and connection examples.
- [x] Preserved Input delivery bridge and native receipt observations; no agent rerun for repair.
- [x] Precise JSON schemas, discriminated content, examples and local rules for each node.
- [x] Main answer traversal through Output and custody/release independence.
- [x] Text, typed results, media-only, refusals, failures and quiet outcomes.
- [x] Long/code-fenced text and four-choice prompt fallback.
- [x] Preview, final promotion, stale updates, progress coalescing and Stop.
- [x] Proactive eligibility, fanout, internal child results and authorized announcements.
- [x] Tool-send duplicate prevention preserves distinct content and recipient scope.
- [x] Artifact access/expiry/upload custody and retention through partial/unknown output.
- [x] Bounded safe retry/provider wait, permanent failure and accepted-sibling preservation.
- [x] Recovery before/after registration/send-start/acceptance/receipt persistence uses original identity.
- [x] Claim fencing and duplicate/out-of-order/unmatched/late receipt evidence.
- [x] Modal cases and configuration, Auto, Next, manual following, Reset and Stop.
- [x] Relevant tests, typecheck/build, browser verification and docs links.

## Node ownership

Capture intent → resolve route → check policy → render parts → optional media or stream → register obligation → schedule → execute transport attempt → record observations. Retry and reconciliation branch separately; settlement accounts for each required part/recipient. Internal returns and quiet completion bypass transport. State request/receipt connections resume exact owner phases.

Output lives beneath Input and above State in the relationship layout, close to its main route and persistence owners. The existing Arrange blocks operation retains its role; saved design notes and user links remain preserved.

## Validation and limitations

The maintained graph contains thirteen Output nodes and eighty-two connections
(153 nodes and 725 connections across Lina). The modal has 56 delivery cases.
All 1,021 Lina tests and the production typecheck/build pass. The isolated Chrome browser check passes: modal settings, manual traversal,
mismatched/matched reconciliation, automatic playback, manual graph following
and collapsible colored JSON contracts. Local documentation links and
`git diff --check` pass. The build retains its existing large-chunk warning. Fixture limits are teaching controls, not current live WhatsApp/Telegram account limits. Platform acceptance, optional delivered/read facts and human comprehension are distinct. No exactly-once claim follows from these design records.


## Reproduce validation

```bash
apps/web/node_modules/.bin/tsx --test apps/web/tests/lina*.test.ts
pnpm --filter @agent-harness-lab/web build
node --test apps/web/tests/browser/lina-output.browser.test.mjs
```

The browser check needs the web service and Studio API with matching allowed
origin; see the [browser guide](../../../../apps/web/tests/browser/README.md).
Completed 2026-10-09. Native sends, durable production outbox storage and measured
provider reliability remain outside this design slice.
