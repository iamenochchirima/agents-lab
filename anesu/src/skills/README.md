# Skills

The Skills module discovers reusable, workspace-local instruction packages. A package
is a directory below `skills/` containing a bounded UTF-8 `SKILL.md` with front matter
for `name`, `description`, and optional `version`.

The first slice is intentionally read-only and on demand:

- `SkillRegistry.list()` rescans `skills/**/SKILL.md`, validates metadata, skips
  malformed or oversized packages, and returns bounded summaries with exact IDs.
- `SkillRegistry.read(id)` accepts only an exact ID from the current catalog, rechecks
  the file through the workspace policy, and returns the complete bounded document.
- The model-facing `list_skills` and `read_skill` tools expose the same contract.

Skill prose is workspace-provided procedure, not policy. It cannot grant permissions,
change security settings, override approvals, or execute code. Scripts, dynamic tool
registration, installation, remote sources, semantic activation, and broader context
files are separate future slices.
