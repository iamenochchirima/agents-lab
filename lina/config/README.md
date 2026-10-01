# Configuration

Lina configuration belongs here: model settings, workspace policy, tool
policy, and security controls. Do not put Lab experiment configuration in this
directory.

The first terminal slice reads `LINA_*` settings and the optional
`OPENROUTER_API_KEY` from the process environment. The deterministic local provider is
the default. OpenRouter must be selected explicitly and requires both a model and key.
Workspace mutations are bounded independently: `LINA_MAX_FILE_BYTES` limits
one file, `LINA_MAX_PATCH_SET_BYTES` limits the resulting bytes across one
multi-file patch set, and `LINA_MAX_TREE_BYTES` limits one directory-tree
operation. The effective values are included in the standalone `doctor` output and in
the prepared mutation evidence where the operation uses them.

Computer use is enabled separately with `LINA_COMPUTER_ENABLED=true`. The normal
development policy is:

```text
LINA_COMPUTER_ENVIRONMENT=browser
LINA_COMPUTER_SURFACE=auto
LINA_COMPUTER_STRATEGY=typesafe
```

The surface policy selects the managed browser or, under the explicit
`ubuntu-x11-cua` environment profile, the isolated desktop. The configured computer
surface uses Jev/TypeSafe over bounded Cua semantic candidates; traditional vision,
compare mode, and automatic fallback are retired from production admission. The browser
search tool opens a real results page in the isolated Cua browser. It uses Bing by default;
set `LINA_BROWSER_SEARCH_PROVIDER` to `bing`, `duckduckgo`, or `google` to select a
supported provider. Search terms are sent to that provider. Search and direct navigation
return a fresh browser snapshot after a short bounded wait; the conversation model chooses
what to do next. In interactive chat, the isolated browser stays available for follow-up
prompts in the same conversation and closes when Lina exits. Browser calls use
`LINA_BROWSER_ACTION_TIMEOUT_MS` (30 seconds by default)
instead of the shorter generic tool timeout. The browser input route defaults to `dom_event` on Linux/macOS and `trusted`
on Windows. In pinned Cua 0.28.2, the Linux and macOS adapters refuse trusted CDP input for standalone
Chromium because it would activate the browser window. `dom_event` is synthetic and
does not prove the control accepted the click; Lina always re-observes and verifies the
requested result, and trust-gated controls may still refuse it. Set
`LINA_COMPUTER_BROWSER_INPUT_ROUTE` explicitly to override the platform default; Lina
never silently switches routes after a refusal. `doctor` and `/computer` report the effective environment,
surface policy, strategy, input route, model names, and readiness without revealing
provider credentials. When computer use is enabled, `doctor` also performs read-only
Cua capability and health probes for the configured profiles and reports installed Cua
package/runtime identities plus bounded host-product checks. It never starts a native
application or browser session as part of that diagnostic.

Ordinary browser tasks use a Cua-owned `isolated_new` profile. Existing-profile
attachment is a separate opt-in capability: set
`LINA_COMPUTER_EXISTING_PROFILE=true`, then explicitly ask to use an already-open
Chrome or Edge window. The TUI shows a separate approval explaining that live tabs,
cookies, and storage may be exposed. The adapter still requires one exact visible,
Cua-attested window and a single-use Cua authorization-host decision; the setting does
not grant general desktop access. Live Chrome/X11 acceptance is still required before
this mode is described as generally supported.
