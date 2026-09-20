# Anesu computer-use playground

This walkthrough covers the user-facing browser flow and the Ubuntu/X11 native CUA
flow. The browser fixture is also used for deterministic strategy testing; contributors
should not need to mention it during ordinary chat.

## Natural browser smoke test

From the repository root:

```text
pnpm run chat
```

Ask the agent:

```text
Open https://www.iana.org/domains/example and click the “Domains” link.
```

Replace the URL and label with any allowed page and one visible button or link you
actually want to use. The label is matched against the page's accessible text, not a
CSS selector or coordinate.

Anesu uses one bounded `browser_open_and_click` workflow: it opens the allowed URL,
matches the exact accessible button or link label, shows the normal approval panel, and
clicks once after approval. The managed browser remains open so the interaction can be
observed. This path uses browser accessibility state and exact labels; it is not yet
native desktop computer use.

## Dual-strategy browser validation

The development `anesu/.env` can enable the computer tool and use the stored TypeSafe
credential. From the repository root:

```text
pnpm run chat
```

Ask the agent:

```text
Use computer to reveal the safe result in the local fixture.
```

With `ANESU_COMPUTER_STRATEGY=typesafe`, Anesu starts a visible managed Chromium
profile, gives Jev the bounded accessibility state, asks the existing structured browser
approval panel for permission, clicks the selected fixture button once, and verifies the
success marker. The browser closes when the computer call finishes.

To exercise the traditional path, set these local-only values in `anesu/.env`:

```text
ANESU_COMPUTER_STRATEGY=traditional
ANESU_COMPUTER_TRADITIONAL_MODEL=<vision-capable-openrouter-model>
```

To compare both decision proposals without allowing a second click:

```text
ANESU_COMPUTER_STRATEGY=compare
```

The computer tool also supports a natural open-only request for an allowed public
URL:

```text
Can you open kasitek.co.za?
```

That path uses the managed browser URL policy, opens the requested page, takes one
fresh snapshot, and reports `opened`. It does not force the local fixture action or
ask Jev to invent a click. If the request also asks for an interaction, the page is
handled by the bounded model-selected action path and still requires approval.
For an external page without a configured application verifier, the terminal result
reports `action_dispatched` with `verification: not-configured` after the approved
action and one fresh follow-up snapshot; it does not retry the action or claim that
the user's larger goal was proven.

For keyboard confirmation, make the key explicit in the request, for example:
`Open https://example.com and press Enter in the Search terms field.` The action space
will expose `press` only for that explicit supported key, and the normal approval panel
appears before `browser_press` runs.

For a native HTML select, quote the exact visible option label, for example:
`Open https://example.com and select "South Africa" in Country.` The option is shown
in the approval panel and checked against the current select options before it runs.

For a read-only settling delay, make the duration explicit, for example:
`Open https://example.com and wait 250 milliseconds.` The computer action space exposes
one bounded wait candidate, capped at 10 seconds. Jev selects that candidate, Anesu
calls the existing `browser_wait` primitive without input approval, captures a fresh
snapshot, and reports `waited`; the model cannot supply or extend the duration.

For bounded page navigation, make the direction explicit, for example:
`Open https://example.com and scroll down 800 pixels.` The action is capped at 2,000
pixels, shown in the structured approval panel, invalidates the old element references,
and reports `scrolled` after a fresh snapshot. The model cannot choose a different
direction or amount.

Jev may also abstain. The browser decision includes a `none` choice and refuses a
selection below the shared 0.5 confidence gate before the approval panel is shown;
the confidence value never grants approval by itself.

## Native Ubuntu/X11 CUA slice

The native path uses the installed `@trycua/cua-driver` package in the Anesu process;
it does not require a separately running CUA MCP server. It is available only when
you already have a disposable X11 display. Choose `traditional` for a vision-capable
OpenRouter model, or `typesafe` when the foreground application exposes a CUA
accessibility tree and you have a TypeSafe credential. Configure `anesu/.env` as follows:

```text
ANESU_COMPUTER_ENABLED=true
ANESU_COMPUTER_ENVIRONMENT=ubuntu-x11-cua
ANESU_COMPUTER_STRATEGY=traditional
ANESU_COMPUTER_OPENROUTER_API_KEY=<openrouter-key>
ANESU_COMPUTER_TRADITIONAL_MODEL=<vision-capable-openrouter-model>
ANESU_COMPUTER_TRADITIONAL_VISION=true
ANESU_COMPUTER_CUA_DISPLAY_ID=primary
ANESU_COMPUTER_CUA_ISOLATED_DISPLAY=true
```

For native Jev, use:

```text
ANESU_COMPUTER_STRATEGY=typesafe
TYPESAFE_API_KEY=<typesafe-key>
ANESU_COMPUTER_TYPESAFE_MODEL=jev-latest
```

The native TypeSafe path does not use invented OCR, raw screenshots, or
model-generated coordinates. CUA lists visible windows, reads one exact window's
bounded accessibility state, Jev chooses one supplied candidate, and the approved
element token is dispatched back to that same window. If CUA exposes no usable
accessibility candidate, Anesu abstains instead of guessing.

Start Anesu from the same shell that owns the disposable display (`DISPLAY` must be
set), then ask:

```text
Use computer to click the visible safe control on the Ubuntu desktop.
```

Before asking for an action, `/computer` shows the configured environment, strategy,
model, display, recent bounded run summaries, and whether the isolated X11
prerequisites are ready. It is a read-only inspection command; it does not start CUA
or send input. Run summaries never expose raw lifecycle payloads, provider bodies, or
screenshot contents.

The TUI shows the bounded native observation and asks for approval before the click. CUA's
agent cursor is enabled for the session, the screenshot is saved only under Anesu's
managed scratch path, and Anesu captures a fresh observation after the click. To retain
bounded immutable copies for inspection, add this opt-in setting to `anesu/.env`:

```text
ANESU_COMPUTER_ARTIFACTS_ENABLED=true
```

The copies are stored under the configured state directory's
`computer-artifacts/<run-id>/` path. `/computer` shows only the managed relative
artifact reference; it never renders absolute paths, raw provider bodies, or screenshot
bytes in the normal run summary.
Repeatable private launchers are available as `pnpm run chat:cua-xvfb` for headless
work and `pnpm run chat:cua-xephyr` for a visible nested X11 window. Add `--fixture`
to either command to open the repository's local disposable Chrome page automatically:

```bash
pnpm run chat:cua-xephyr -- --fixture
```

Those launchers put Chrome and Anesu in one short-lived `dbus-run-session`, which is
needed for Linux CUA/AT-SPI discovery, and the fixture enables Chromium accessibility.
Native Jev additionally needs a window manager in that disposable display. Bare Xvfb
can provide a screenshot but usually exposes no selectable window, so Jev will report
an abstention until the host supplies a window manager and accessibility-capable
application. If `openbox` is already installed, opt into starting it only inside the
disposable display:

```bash
pnpm run chat:cua-xvfb -- --fixture --window-manager openbox
```

The launcher intentionally does not install a system window manager or attach to the
contributor's personal desktop. `fluxbox`, `twm`, `jwm`, and `gnome-shell` are also
accepted; GNOME Shell is heavier but is already present on some Ubuntu systems.

Then ask Anesu to click `Reveal safe result`; the nested window lets you watch the
agent cursor and the page update. For the repository fixture, the fresh observation
also verifies `Computer success: safe result revealed.`; if CUA reports an uncertain
acknowledgement, Anesu uses that observation to verify the result and still does not
retry the click. Native Jev requires the fixture or desktop
application to expose accessibility candidates; traditional mode remains the
explicit screenshot path, but Anesu never switches strategies silently.

Live backend evidence on 2026-09-20: with the stored TypeSafe credential, Jev received
15 bounded accessibility candidates and selected `Reveal safe result` (confidence
`0.74`). CUA dispatched the exact element token in window scope; its result was
`outcome-unknown`, no retry occurred, and the fresh snapshot contained
`Computer success: safe result revealed.` The native runner now treats that fresh
fixture state as verification while preserving the uncertain CUA result in its
bounded output. This validates the real Jev-to-CUA boundary;
the structured interactive TUI approval path has also been exercised with the same
disposable display. The stored NVIDIA route currently returns an upstream HTTP 502
`ResourceExhausted` envelope; Anesu surfaces that status, retries once before approval,
and performs no CUA input after the bounded attempts. Other catalog-confirmed free
routes have returned HTTP 429 or a bounded HTTP 400 with nested provider detail.
Anesu surfaces that detail without retaining the raw provider body. This is a
provider availability/model-compatibility failure, not a CUA action result.

## What to inspect

- The browser is a fresh Anesu-managed profile, not the contributor's personal browser.
- The selected strategy must choose the labelled `Reveal safe result` button. This
  label is an internal fixture assertion, not the intended everyday chat wording.
- Approval must happen before the click.
- The final observation must contain `Computer success: safe result revealed.`
- The result reports the strategy, candidate identity, and TypeSafe confidence/probabilities
  when available.
- Browser artifacts and action records remain under the normal Anesu evidence directory;
  credentials and raw image base64 must not appear there.

For browser text entry, state the exact non-sensitive value in quotes, for example:
`Use computer to type "hello" into the Search terms field.` The model may select the
observed field, but Anesu supplies the quoted value. If the goal has no quoted value,
the run asks for clarification; credential-like or secret-looking text is refused.

## Known limits

This browser playground does not demonstrate native desktop control, operating-system cursor
input, OCR, macOS Accessibility, CoreML segmentation, coordinates, drag, windows,
remote nodes, or arbitrary websites. It does not claim the full planned per-step
observation/action/provider evidence bundle; the current run journal is the bounded
`computer-runs/<run-id>/run.json` plus `events.jsonl` projection, with optional native
artifact copies stored separately. Low-confidence abstention and complete compare
shadow-failure reporting remain tracked in the single
[computer-use dual-path plan](../implementation-plans/anesu/active/anesu-computer-use-dual-paths.md).
