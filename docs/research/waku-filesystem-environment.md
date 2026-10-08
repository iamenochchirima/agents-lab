# Waku filesystem and execution environment

Research date: 2026-10-08. Scope: source inspection, not a live coding run.
The local checkout of [Waku Agent](https://github.com/ShenSeanChen/waku-agent)
was pinned to commit `763d3e79f34a2deca805e815b3b230188579e16b`.
The matching upstream `experimental.py` and `workspace.py` were also retrieved
to verify that the inspected files belong to that revision.

## Observed implementation

Waku's normal tool registry does not expose a generic filesystem tool suite.
Its experimental `delegate_task` tool hires **Pi**, a separate local coding
agent whose tools include read, bash, edit, and write. Experimental registration
is opt-in; Waku's own `run_command` remains a coming-soon stub. This is a
delegated coding agent, not filesystem access implemented inside Waku's normal
model loop. See [registry construction](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/__init__.py#L14-L55)
and [the delegation boundary](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/experimental.py#L1-L28).

There are two actual working-directory modes:

| Mode | Directory and lifecycle |
| --- | --- |
| Existing project | `delegate_task(cwd=...)` uses the supplied existing directory in place. Waku checks that it exists, then launches Pi there. It does not clone it or restrict writes to an `artifacts/` folder. |
| Scratch work | Omitting `cwd` creates a persistent dated directory under `WAKU_WORKSPACE`, defaulting to `./waku_workspace`, resolved relative to Waku's process directory. Each delegation receives a new dated folder containing its files, manifest, and logs. |

These modes are implemented in [directory selection](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/experimental.py#L194-L234)
and [workspace creation](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/workspace.py#L37-L59).
The scratch folder belongs to a delegation, not a conversation session; Pi is
launched with `--no-session`. Reusing a project directory means subsequent
delegations see the files already there.

Pi runs as a local subprocess with the selected `cwd`. Waku passes no container,
VM, OS filesystem sandbox, or per-file approval protocol in this launcher.
The phrase “scratch sandbox” in the argument description therefore describes a
working folder, not demonstrated OS isolation. The inherited process environment
is copied, with optional names removed through `WAKU_DELEGATE_ENV_DENY`.
That denylist defaults to empty. See [subprocess execution](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/experimental.py#L101-L111),
[fallback execution](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/experimental.py#L249-L259),
and [environment policy](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/_env.py).
This finding concerns Waku's launcher; separately installed Pi extensions may
change the child's behavior.

Successful scratch delegations can automatically execute a generated Python
entry point using the host Python interpreter, in that same directory. Auto-run
is enabled by default, has a 30-second default timeout, and can be disabled with
`WAKU_DELEGATE_AUTORUN=0`. Existing-project delegations skip this extra auto-run.
Waku saves a manifest, execution log, transcript, and available raw Pi events,
and returns execution output to its model loop. See [auto-run implementation](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/workspace.py#L39-L114)
and [delegation completion](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/experimental.py#L261-L294).

Work products are separate from agent state. The workspace module explicitly
keeps code deliverables outside `.waku`; state normally lives in `~/.waku`,
subject to `WAKU_HOME` and a legacy local-state migration rule. See [workspace
ownership](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/workspace.py#L1-L23)
and [home resolution](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/config.py#L64-L85).

For delegated coding, Waku passes its own `.pi/extensions/*.ts` and
`.agents/skills/` paths to Pi explicitly. Waku also has a separate procedural
skill loader for its own memory/context, scanning bundled and installed
`SKILL.md` files and loading matching instructions. These are two different
context paths. See [Pi resource flags](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/tools/experimental.py#L66-L83)
and [Waku skill loader](https://github.com/ShenSeanChen/waku-agent/blob/763d3e79f34a2deca805e815b3b230188579e16b/waku/memory/procedural/loader.py).

## Implications for this laboratory

The current Lab cloned fixture workspace is useful as an evaluation control,
but should not define every agent's filesystem environment. A stronger boundary
would bind file tools and command execution to one explicit environment with a
working directory, environment identity, lifetime, and declared permissions.
Project directories, persistent scratch workspaces, and reproducible fixture
workspaces can then be separate modes. A local directory must be labeled as
local access; container isolation would be a separate implemented mode.

This is a recommendation, not behavior already implemented. We should retain
each platform's native model/tool loop rather than make all four platforms
delegate their reasoning to Pi: otherwise the experiment would measure Pi's
coding loop across orchestration wrappers. Waku's useful lesson here is the
explicit project-or-scratch environment and shared location for file operations
and command execution. Delegation remains an independently selectable capability.

## Verification and limits

Inspection covered Waku's tool registration, delegate launcher, workspace
manager, environment filter, state-home resolver, and procedural skill loader.
No model call, file mutation in Waku, dependency installation, or coding task was
run. Installed Pi behavior and extensions were not exercised. The inspected
revision establishes the launcher behavior described here; it does not establish
security isolation or reliable recovery of delegated operating-system processes.
