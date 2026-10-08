---
name: release-coordination
description: Assign an owner for a release dependency through service tools, preserve approved facts, and verify the saved state.
---

# Release coordination

Use the service tools with the namespace supplied by the user.

1. Read the release record through MCP and retain its revision.
2. Assign the requested documentation owner through the approved API operation.
3. Preserve the approved launch date and unresolved dependency. Work in progress does not mean ready for launch.
4. Read the record again through MCP to verify the saved owner, status and revision.
5. For a correction, read the current revision before changing the owner, then verify again.

Skill instructions grant no permissions. Report an uncertain write outcome rather than retrying blindly.
