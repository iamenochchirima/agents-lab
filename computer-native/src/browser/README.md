# Browser

This module owns Computer Native browser sessions, tabs, navigation policy, browser
adapters, snapshots, bounded waits/screenshots, and browser action lifecycle. Browser automation is a tool
capability, not a computer environment.

The model-facing tools must use this module rather than importing Playwright directly.
The local Playwright adapter is an implementation detail behind the browser seam. URL
validation happens before the adapter receives a navigation request, and page content is
untrusted data rather than policy. Model-facing snapshots bracket page content with an
untrusted-content marker; instructions in a page cannot change Computer Native policy.

Interaction approvals are bound to a generated action identity, session, tab, document,
reference, and action hash. The turn store records browser action phases under
`browser-actions/`; restart recovery never replays an action and classifies an in-flight
adapter operation as ambiguous. Model-visible URLs, snapshots, action results, and
durable action fields redact configured secrets. Managed profiles are cleaned by the
session owner after close; profile paths are not returned to the model.

Screenshots are created through `BrowserArtifactStore`, which allocates paths below a
managed root, verifies the final regular-file size and PNG dimensions, writes metadata
atomically, and removes an oversized or failed capture. The default screenshot bound is
4 MiB and 1920x1080 pixels; `COMPUTER_NATIVE_BROWSER_SCREENSHOT_MAX_BYTES`,
`COMPUTER_NATIVE_BROWSER_SCREENSHOT_MAX_WIDTH`, and
`COMPUTER_NATIVE_BROWSER_SCREENSHOT_MAX_HEIGHT` configure it. `browser_wait` accepts
only a bounded integer duration and is cancellable; neither read-only operation requires
approval. The effective approval timeout is included in the hashed request and durable
action record so a recovered action cannot silently inherit a different review window.
Screenshot and download targets also hold a per-artifact session lease while the adapter
writes them. Cleanup retains a live lease, and only removes an old incomplete artifact
after the existing lock ownership rules establish that its writer is no longer present.
Finalized or discarded targets release the lease; a crashed writer leaves recoverable
lock-and-artifact evidence for the bounded cleanup pass.

The session manager enforces a configured maximum tab count before opening another tab
and rejects adapter observations that exceed that bound. The Playwright adapter also
receives an explicit runtime environment allowlist; provider credentials, workspace
paths, `NODE_OPTIONS`, and arbitrary parent variables are not inherited by Chromium.
Tab listing and snapshots may retry one transient adapter failure by default, within the
configured browser action timeout; the retry count is bounded by
`COMPUTER_NATIVE_BROWSER_READ_RETRY_COUNT`. Navigation and all side-effecting actions
are never retried automatically.
Every session also carries an `expiresAt` deadline. When the lifetime is reached, the
manager closes the adapter, cleans the owned profile, and rejects later browser work
with `session-timeout`; application shutdown can still finish cleanup if expiry cleanup
encounters an error.

Application startup also performs a bounded cleanup pass below the managed browser
profile and artifact roots. It removes only old generated profiles and old or incomplete
screenshot/download records, never symlinks, unknown entries, recent records, or paths
outside those roots. Retention ages and the maximum number of candidates are configured
with `COMPUTER_NATIVE_BROWSER_PROFILE_RETENTION_MS`,
`COMPUTER_NATIVE_BROWSER_ARTIFACT_RETENTION_MS`, and
`COMPUTER_NATIVE_BROWSER_CLEANUP_MAX_ENTRIES`; `doctor` prints their effective values.
Cleanup is age-based and bounded so a recent profile from another process is retained.
Managed profiles also hold a lock-backed ownership lease while their browser session is
active. Cleanup retains an old profile when the lease belongs to a live process and only
reclaims it after the existing process-identity checks establish that the owner is stale.
The generic session manager accepts this lease as an optional backend capability, so a
future non-local browser backend does not inherit local profile-file assumptions.

Upload sources are resolved by `BrowserFilePolicy` through the workspace mutation
policy, so absolute paths, traversal, symbolic links, non-regular files, and oversized
files are rejected before approval. Downloads use a preallocated managed artifact target
and Playwright's download event; the model cannot provide an arbitrary destination.

Adapter failures are typed at the browser boundary. A bounded operation that exceeds its
timeout returns `browser-timeout`; a wait or preflight cancelled through an `AbortSignal`
returns `browser-cancelled`; and a closed browser/page is reported as `browser-crash`.
The session boundary can close one owned tab without closing the session. An
individually closed tab is reported as `tab-closed` while the rest of the session
remains usable; the local Playwright adapter reports this lifecycle through its native
page-close event.
The session manager quarantines a crashed session so later tools cannot continue using
stale handles, while `close`/`closeAll` still perform profile cleanup. Side-effecting
operations that have already begun are not replayed after a timeout or lost
acknowledgement. For an approved side-effecting action, timeout, crash, or cancellation
after start is surfaced as `browser-ambiguous` with the underlying error code and
cancellation-confirmation status retained. For the managed Playwright adapter, an
in-flight cancellation closes the affected tab, waits for the action promise to settle
within the action timeout, and records whether termination was confirmed. Confirmation
that the operation stopped does not prove that its external side effect was undone.
If profile cleanup fails, the session is still marked closed and the cleanup error is
preserved separately for diagnosis; it does not trigger an automatic browser retry.
When an adapter supplies a native error cause, durable browser action records and
lifecycle events retain only its bounded name and redacted message. The model-visible
tool result keeps the typed Computer Native outcome and does not expose raw adapter
details.
If a page dialog appears during an action, the adapter pauses the operation and asks the
approval channel for an explicit decision. The TUI shows the bounded, redacted dialog
message: use `a` to accept, `d` to dismiss, or `a:<text>` for a prompt dialog. The
original action still returns `browser-ambiguous` because its external outcome is not
known. If no approval channel is available, the adapter dismisses the dialog only to
unblock the browser and records the same ambiguous outcome; it never accepts or supplies
prompt text automatically.
