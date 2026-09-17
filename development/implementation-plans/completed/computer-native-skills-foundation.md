# Computer Native Skills foundation

**Created:** 2026-09-17T02:30:00+02:00
**Last updated:** 2026-09-17T02:50:47+02:00
**Completed:** 2026-09-17T02:50:47+02:00
**Status:** Completed
**Owner:** Computer Native standalone product

## Purpose

Add the first usable Skills module to Computer Native. A skill is a local, reusable
instruction package, not executable plugin code and not an approval grant. The model
must be able to discover the skills available in the current workspace and load one by
exact identity when it needs the procedure.

This is a first implementation slice. It covers discovery, metadata, bounded on-demand
loading, model-tool integration, and TUI visibility. It does not attempt the complete
skill marketplace, authoring workflow, background curator, or plugin runtime.

## Reference alignment

The local Hermes and OpenClaw code maps and checkouts inform this slice:

- Hermes keeps a lightweight skill index and loads the full `SKILL.md` only when a
  skill is invoked. Supporting files are resolved relative to the skill directory.
- OpenClaw treats skills as session resources and exposes list/read access through a
  controlled runtime object rather than mixing skill loading with plugin execution.
- Computer Native keeps the same separation. The Skills module owns discovery and
  loading; the tool registry exposes read-only access; the runtime still owns model
  turns and all existing approval and security policy.

## First-iteration scope

- [x] Discover `skills/**/SKILL.md` below the configured workspace root with bounded
      depth and entry counts.
- [x] Validate a small front matter contract: `name`, `description`, and optional
      `version`; reject malformed or duplicate skill identities.
- [x] Expose `list_skills` and `read_skill` as read-only model tools. `read_skill` loads
      the complete bounded root file by an identity returned from `list_skills`.
- [x] Mark loaded skill text as workspace-provided procedure that cannot grant tool
      permission, change policy, or override approval requirements.
- [x] Show the discovered catalog through `/skills` and the normal tool list without
      inventing skills when the workspace has none.
- [x] Keep the module workspace-scoped and rescan on request so a new skill is visible
      without restarting the process.
- [x] Add focused contract, tool-loop, TUI, and documentation coverage.

## Delivered

Implemented in the standalone Computer Native runtime:

- `SkillRegistry` discovers valid workspace `SKILL.md` packages, rejects malformed,
  oversized, and symlinked entries, and rescans for every list/read request.
- `list_skills` and `read_skill` are read-only model tools. Exact IDs are revalidated
  against the current catalog and returned content is bounded by the workspace and
  tool-output limits.
- The initial model instruction names the skills contract and explicitly treats skill
  prose as untrusted procedure. Skills cannot execute code, grant permissions, or
  bypass existing approvals.
- `/skills` renders the real catalog and `toolNames` advertises the implemented tools.
- Focused tests cover valid/invalid packages, size limits, symlink exclusion, exact ID
  validation, tool dispatch, the shared model turn loop, and TUI rendering.

## Explicitly out of scope

- Executing scripts, loading JavaScript/Python modules, or registering tools from a skill.
- Automatic skill activation, semantic matching, model-generated skill installation, or
  remote skill downloads.
- Skill authoring, patch/review workflows, usage analytics, archival, bundles, or
  external skill directories.
- Workspace `AGENTS.md`, `SOUL.md`, or full context-file precedence. Those belong to a
  separate context-resource slice; this module only handles `SKILL.md` packages.
- Plugin manifests, executable extensions, or plugin permissions.

## Interface and safety rules

The Skills module presents one small interface:

- `list()` returns bounded summaries with an exact skill ID, display name, description,
  version when present, and workspace-relative package path.
- `read(id)` rechecks the discovered path through the workspace read policy and returns
  bounded UTF-8 instruction text plus its summary metadata.

The module never returns an absolute path, follows a skill symlink, reads outside the
workspace, or treats skill prose as an authorization source. A malformed package is
skipped from the catalog and reported only through a bounded diagnostic count. A
missing or changed package fails closed on read.

## Focused validation

- `pnpm run build` — passed.
- `node --test --test-concurrency=1 dist/tests/skills.test.js` — 6 tests passed.
- `node --test --test-concurrency=1 dist/tests/skills.test.js dist/tests/approval-tui.test.js`
  — 18 tests passed.
- `pnpm test` — the full Computer Native suite completed with no reported failures.
- `pnpm run chat --message /skills` — passed against the default deterministic provider;
  the empty workspace catalog was reported honestly.

The focused tests cover valid and invalid front matter, bounded content, symlink
exclusion, exact-ID traversal and missing-skill failures, tool dispatch, the shared
model turn loop, and TUI rendering. Duplicate IDs are prevented by the workspace-
relative package identity; broader race, load, and cross-platform checks remain in the
production-readiness gap register.

## Completion gate

This plan is complete for the first Skills foundation slice. Later hardening remains
tracked in the production-readiness gap register and is not silently claimed by this
slice.
