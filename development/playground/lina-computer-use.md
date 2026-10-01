# Lina computer-use playground

This walkthrough covers the user-facing browser flow and the Ubuntu/X11 native CUA
flow. The browser fixture is also used for deterministic strategy testing; contributors
should not need to mention it during ordinary chat.

## Natural browser smoke test

From the repository root:

```text
pnpm run chat
```

Ask the agent in ordinary language:

```text
Open https://www.iana.org/domains/example and tell me the page heading.
```

Replace the URL with an allowed HTTP(S) page you actually want to read. You do not
need to name the computer tool, provider, fixture, Cua operation, or selector.

Lina routes the request to Cua's isolated browser runtime. Cua prepares the supported
Chrome or Edge process, binds one exact native window and tab, captures a bounded
`semantic_v2` snapshot, and lets Jev choose only from code-built candidates. A fresh
snapshot proves the requested heading or URL; model narration and a tool acknowledgement
do not count as completion. Browser interaction actions such as click, type, press,
scroll, and upload show the normal bounded approval panel before input.

For a harmless local acceptance interaction, use the private launcher instead:

```bash
pnpm run chat:cua-xvfb -- --acceptance --window-manager gnome-shell
```

Then ask:

```text
Open http://127.0.0.1:4173/contact, enter "Lina browser acceptance" in the message field, and submit it.
```

The local service and its origin are part of the disposable acceptance harness. Do not
substitute a personal browser profile or add an origin to the manifest for an ad-hoc test.

## Automatic browser strategy

The development `lina/.env` can enable the computer tool and use the stored TypeSafe
credential. From the repository root:

```text
pnpm run chat
```

Ask the agent:

```text
Open http://127.0.0.1:4173/ and reveal the safe result.
```

With `LINA_COMPUTER_STRATEGY=typesafe`, Lina starts a visible Cua-managed Chromium
profile, asks Jev to choose from the bounded semantic candidates, asks the existing
structured browser approval panel for permission, clicks the selected button once,
and verifies the success marker. Jev abstention is terminal; production never falls
back to screenshot vision or a second browser backend.

The disposable fixture also supports a bounded two-step prompt:

```text
Open http://127.0.0.1:4173/ and open the details on that page, then reveal the safe result.
```

Lina observes again after the approved first click, invalidates the previous target,
and only approves the second click against the new observation. The run completes only
when the fresh page contains the success marker.

The same computer tool can route a native request when the isolated Ubuntu/X11 profile
is enabled, or coordinate both surfaces under one Lina task owner:

```text
Open http://127.0.0.1:4173/, read the page heading, then write it in Text Editor.
```

Mixed work uses separate native and browser Cua sessions and one serialized task history;
neither runtime can use the other's manifest.

Traditional vision and compare mode are retired from production admission. Their
direct runner tests remain only as isolated regression coverage.

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
reports `action_dispatched` with `outcome-unknown` after the approved action and one
fresh follow-up snapshot; it does not retry the action or claim that the user's larger
goal was proven.

For keyboard confirmation, make the key explicit in the request, for example:
`Open https://example.com and press Enter in the Search terms field.` The action space
will expose `press` only for that explicit supported key, and the normal approval panel
appears before `browser_press` runs.

Native HTML select controls are intentionally unavailable in this bounded typed Cua
slice. A request such as `select "South Africa" in Country` is refused before approval;
Lina does not emulate a select with JavaScript or native desktop input.

For a read-only settling delay, make the duration explicit, for example:
`Open https://example.com and wait 250 milliseconds.` The computer action space exposes
one bounded wait candidate, capped at 10 seconds. Jev selects that candidate, Lina
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

The native path uses the installed `@trycua/cua-driver` package in the Lina process;
it does not require a separately running CUA MCP server. It is available only when
you already have a disposable X11 display. The production policy is Jev over the
foreground application's CUA accessibility tree; missing semantic state is a safe
abstention. Configure `lina/.env` as follows:

```text
LINA_COMPUTER_ENABLED=true
LINA_COMPUTER_ENVIRONMENT=ubuntu-x11-cua
LINA_COMPUTER_SURFACE=auto
LINA_COMPUTER_STRATEGY=typesafe
TYPESAFE_API_KEY=<typesafe-key>
LINA_COMPUTER_TYPESAFE_MODEL=jev-latest
LINA_COMPUTER_CUA_DISPLAY_ID=primary
LINA_COMPUTER_CUA_ISOLATED_DISPLAY=true
```

The native TypeSafe path does not use invented OCR, raw screenshots, or
model-generated coordinates. CUA lists visible windows, reads one exact window's
bounded accessibility state, Jev chooses one supplied candidate, and the approved
element token is dispatched back to that same window. If CUA exposes no usable
accessibility candidate, Lina abstains instead of guessing.

Start Lina from the same shell that owns the disposable display (`DISPLAY` must be
set), then ask naturally:

```text
Click the visible safe control on the Ubuntu desktop.
```

Before asking for an action, `/computer` shows the configured environment, strategy,
model, display, recent bounded run summaries, and whether the isolated X11
prerequisites are ready. It is a read-only inspection command; it does not start CUA
or send input. Run summaries never expose raw lifecycle payloads, provider bodies, or
screenshot contents.

The TUI shows the bounded native observation and asks for approval before the click. CUA's
agent cursor is enabled for the session, the screenshot is saved only under Lina's
managed scratch path, and Lina captures a fresh observation after the click. To retain
bounded immutable copies for inspection, add this opt-in setting to `lina/.env`:

```text
LINA_COMPUTER_ARTIFACTS_ENABLED=true
```

The copies are stored under the configured state directory's
`computer-artifacts/<run-id>/` path. `/computer` shows only the managed relative
artifact reference; it never renders absolute paths, raw provider bodies, or screenshot
bytes in the normal run summary.
Repeatable private launchers are available as `pnpm run chat:cua-xvfb` for headless
work and `pnpm run chat:cua-xephyr` for a visible nested X11 window. Add `--fixture`
to either command to open the repository's local disposable Cua browser fixture
automatically. The fixture launcher defaults to `--browser-product auto`, choosing
Chrome and then Edge. Select a product explicitly when fixture evidence must name it:

```bash
pnpm run chat:cua-xephyr -- --fixture --browser-product chrome
pnpm run chat:cua-xephyr -- --fixture --browser-product edge
```

The launcher prints separate Chrome and Edge availability before starting a fixture.
If the requested product is not installed, it exits without opening a browser; an
unavailable Edge installation is not reported as a successful Edge run. `auto` only
selects a product after the host executable and the local Cua manifest-shaped binary
are found. The fixture enables Chromium accessibility.

This flag applies only to `--fixture`, where the launcher starts the browser itself.
For ordinary browser tasks and `--acceptance`, Cua's `browser_prepare` owns isolated
browser selection and attestation; Lina does not pass an executable path or pretend
that the fixture selector controls that Cua-owned choice. Passing an explicit product
without `--fixture` fails closed.

Those launchers put the selected browser and Lina in one short-lived
`dbus-run-session`, which is needed for Linux CUA/AT-SPI discovery. They use a private
cookie-protected X11 display, private `HOME`/XDG state directories, and a disposable
browser profile under the launcher directory. The fixture browser receives only the
display, D-Bus, locale, and private XDG environment; model credentials remain with
Lina. This is a repeatable acceptance harness, not a host-wide sandbox.
Native Jev additionally needs a window manager in that disposable display. Bare Xvfb
can provide a screenshot but usually exposes no exact selectable browser/native window,
so Cua acceptance refuses before launch and Jev will report an abstention until the host
supplies a window manager and accessibility-capable application. On Ubuntu systems with
GNOME Shell available, opt into starting it only inside the disposable display:

```bash
pnpm run chat:cua-xvfb -- --fixture --window-manager gnome-shell
```

The launcher intentionally does not install a system window manager or attach to the
contributor's personal desktop. `fluxbox`, `twm`, `jwm`, and `gnome-shell` are also
accepted; GNOME Shell is heavier but is already present on some Ubuntu systems.

For deterministic browser acceptance, add `--acceptance`. The launcher starts a
short-lived local HTTP service at `http://127.0.0.1:4173`, prints SHA-256 digests for
the native and browser CUA manifests, and reports every installed manifest-listed
Chrome or Edge product before starting Lina:

```bash
pnpm run chat:cua-xvfb -- --acceptance --window-manager gnome-shell
pnpm run chat:cua-xephyr -- --acceptance --fixture --window-manager gnome-shell
```

`--acceptance` must include an explicit window manager so Cua can bind the prepared
browser window exactly. It leaves browser preparation to Cua, so a prompt can open the
service's `/`, `/contact`, or `/files` route through the normal browser task path.
Combining it with `--fixture` opens the deterministic root page in the disposable
browser for a native CUA smoke as well. The service makes no external requests and
is removed with the private launcher state. The current immutable manifest allows
`127.0.0.1:4173`; the launcher never invents a DNS answer for `lina.test`.
The harness rejects any host or port other than `127.0.0.1:4173`; changing that
origin requires a manifest and acceptance-evidence update first. With `--fixture`
without `--acceptance`, the checked-in native page is served as
`http://127.0.0.1:4173/native.html`, so no filesystem URL is sent to Cua.

`--browser-product auto|chrome|edge` selects the product used by the fixture; `auto`
prefers Chrome and otherwise uses Edge. It does not override Cua's isolated browser
preparation. An unavailable requested product is a failed prerequisite, not a mock
pass or a silent substitution. `--help` prints the launcher contract.

The launcher gives the child a private `HOME`, XDG configuration/cache/data/state
directories, runtime directory, Xauthority file, session bus, browser profile, and
Corepack cache copy. Teardown removes that state. This is development isolation, not
an OS filesystem sandbox.

Then ask Lina to click `Reveal safe result`; the nested window lets you watch the
agent cursor and the page update. For the repository fixture, the fresh observation
also verifies `Computer success: safe result revealed.`; if CUA reports an uncertain
acknowledgement, Lina uses that observation to verify the result and still does not
retry the click. Native Jev requires the fixture or desktop application to expose
accessibility candidates; missing semantic state is a safe abstention.

Live backend evidence on 2026-09-20: with the stored TypeSafe credential, Jev received
15 bounded accessibility candidates and selected `Reveal safe result` (confidence
`0.74`). CUA dispatched the exact element token in window scope; its result was
`outcome-unknown`, no retry occurred, and the fresh snapshot contained
`Computer success: safe result revealed.` The native runner now treats that fresh
fixture state as verification while preserving the uncertain CUA result in its
bounded output. This validates the real Jev-to-CUA boundary;
the structured interactive TUI approval path has also been exercised with the same
disposable display. The stored NVIDIA route currently returns an upstream HTTP 502
`ResourceExhausted` envelope; Lina surfaces that status, retries once before approval,
and performs no CUA input after the bounded attempts. Other catalog-confirmed free
routes have returned HTTP 429 or a bounded HTTP 400 with nested provider detail.
Lina surfaces that detail without retaining the raw provider body. This is a
provider availability/model-compatibility failure, not a CUA action result.

## What to inspect

- The browser is a fresh Lina-managed profile, not the contributor's personal browser.
- The selected strategy must choose the labelled `Reveal safe result` button. This
  label is an internal fixture assertion, not the intended everyday chat wording.
- Approval must happen before the click.
- The final observation must contain `Computer success: safe result revealed.`
- The result reports the strategy, candidate identity, step, verifier, and TypeSafe
  confidence/probabilities when available. `/computer` reports the durable terminal
  outcome and event count without exposing raw event payloads.
- Browser artifacts and action records remain under the normal Lina evidence directory;
  credentials and raw image base64 must not appear there.

For browser text entry, state the exact non-sensitive value in quotes, for example:
`Use computer to type "hello" into the Search terms field.` The model may select the
observed field, but Lina supplies the quoted value. If the goal has no quoted value,
the run asks for clarification; credential-like or secret-looking text is refused.

## Known limits

This playground demonstrates the bounded native Ubuntu/X11 and Cua browser slices, not
an unrestricted desktop agent. It does not cover OCR, macOS Accessibility, CoreML
segmentation, arbitrary coordinates, native drag-and-drop, remote nodes, arbitrary
websites, downloads, screenshots, personal browser profiles, or existing-profile
attachment. Downloads remain disabled because the installed public Cua TypeScript SDK
does not expose the trusted host approval evidence required to prove them. Application-
specific verifiers, richer perception, production isolation, and exhaustive
race/load/release hardening remain later work in the active implementation plan.
