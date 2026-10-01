# Browser form failure: source check

Date: 2026-09-25. This is a design diagnosis, not a claim that the reported Kasitek form has been reproduced or fixed. Local revisions inspected: Cua `9bbfa7dd3`, Hermes `b6b53c69a6`, OpenClaw `912685f4422`.

## What the reported trace proves

The user's TUI trace shows an approved `Company type` combobox click, a Cua `unverifiable` effect, another snapshot, a repeated click blocked by Lina's no-replay guard, and exhaustion of the configured eight model/tool rounds. It does not show the full post-click semantic snapshot, so it does not establish whether the combobox opened, exposed options, or ignored the synthetic click. No form submission or completed form is established.

The Cua [`browser_click` implementation](https://github.com/trycua/cua/blob/main/libs/cua-driver/rust/crates/cua-driver-core/src/browser/tools.rs) calls `this.click()` on the `dom_event` route and returns `effect: "unverifiable"` after successful dispatch. [Cua's browser guide](https://github.com/trycua/cua/blob/main/docs/content/docs/how-to-guides/driver/drive-a-web-page.mdx) says to take a fresh snapshot and verify the expected state. Therefore `unverifiable` alone is not a failure and is not success. Lina currently maps it to an error-style ambiguous result and blocks identical replay in [`browser/tools.ts`](../../lina/src/browser/tools.ts). That protects against duplicate effects, but the model still needs usable post-click evidence to continue.

Lina's existing [`browser-task-continuation.test.ts`](../../lina/tests/browser-task-continuation.test.ts) proves a scripted fake adapter/model can follow an uncertain click with a snapshot and complete a mixed-control form in 16 rounds. It does not reproduce this site's widget, Cua's actual click delivery, or the model's choice after seeing the site's 16 KB/247-ref partial snapshot. The current default is 16 rounds in [`config.ts`](../../lina/src/config/config.ts), but the screenshot's eight-round failure could be an older build or an explicit override. Increasing a limit alone is not a widget fix.

## Reference harnesses

- [Hermes browser tools](https://github.com/NousResearch/hermes-agent/blob/main/tools/browser_tool.py) expose snapshot refs, click, fill, and a generic key press including ArrowDown/Tab/Enter. The model chooses those tools across rounds. Hermes uses `agent-browser`/configured browser backends, not Lina's Cua-only route. Its tool set is a useful interaction contract, not proof that Cua already supports every operation.
- [OpenClaw's main browser tool](https://github.com/openclaw/openclaw/blob/main/extensions/browser/src/browser-tool.schema.ts) exposes `act` kinds including press, select, and fill. Its managed-browser implementation routes select to [Playwright `selectOptionViaPlaywright`](https://github.com/openclaw/openclaw/blob/main/extensions/browser/src/browser/pw-tools-core.interactions.execution.ts); its existing-session route uses Chrome MCP. This is a different execution backend from Lina's chosen Cua-only browser.
- [OpenClaw's Cua computer plugin](https://github.com/openclaw/openclaw/blob/main/extensions/cua-computer/src/browser-actions.ts) passes snapshot, click, and type through typed Cua calls with execution-scoped references. It does not supply a Cua-native select/key operation in the inspected code. Copying this wrapper alone would not resolve Cua's Linux native-select or trust-gated click limits.

## Smallest credible fix path

1. Reproduce the exact failed form through Lina's real TUI and Cua route. Capture the redacted model-visible snapshot before and after `Company type`, including the control's role, `expanded` state, option refs, selected value, and the configured input route. The feedback loop must fail on the reported inability to advance, not merely exercise a fake form.
2. If the fresh snapshot shows an opened custom listbox, give the model that current state and let it choose the observed option. Preserve no-replay for the dispatched click, but do not present Cua's routine `dom_event` uncertainty as evidence that the whole task failed. If the click had no effect, establish whether Cua needs a separately supported trusted/foreground gesture. Do not invent a coordinate or silently change route.
3. If the blocking control is a native HTML `<select>`, prove and add a generic current-ref Cua select or key operation, then expose it as an ordinary Lina browser tool. The active browser plan's section 6 covers this, but it does not by itself cover custom combobox continuation.
4. Return enough fresh, focused page state for the model to decide without repeated blind snapshots. Keep resource limits, but test a realistic multi-field task against the actual model/tool round budget. Report unsupported widgets clearly and verify final field values before any success claim.

Tabs and downloads are separate browser capabilities. They will not fix this form failure. No live repro or code fix was performed in this research check.
