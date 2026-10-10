# estack prepare-project scope

Date: 2026-10-10.
Status: the eight scope items below are agreed. Additions from the earlier playbook
are proposals for discussion, not an implemented skill or adopted setup policy.

## Agreed scope

1. Understand the problem, users and intended outcome.
2. Define scope, exclusions and acceptance criteria.
3. Inspect existing code or establish constraints for a new project.
4. Identify what needs research, decisions or a prototype.
5. Define the main user flows, responsibilities and data lifecycle.
6. Address relevant security, failure and recovery requirements.
7. Establish development commands and a verification approach.
8. Produce an implementation plan with ordered checklist items.

Each step should specify what to inspect, which questions to answer, what output
to produce, and when it is sufficiently complete. Scale the detail to the project.
Research and implementation evidence may revise the design.

## Proposed additions within those eight items

Reviewed the local [playbook](../../../../playbook/README.md), including its project
foundation, specs/issues, workflow pilot, review and pull-request practices. Its
embedded setup instructions were treated as review material, not authorization to
install skills, configure trackers, commit changes or set up a target project.

| Existing step | Useful addition from the playbook |
| --- | --- |
| 1 | Record confirmed domain vocabulary and avoided synonyms where ambiguity matters. Ask about intent that cannot be established from the repository. |
| 2 | Separate implementation tasks from observable acceptance criteria. Define completion, including whether it requires merge, deployment or direct verification. |
| 3 | Reuse current project entry points and standards. Identify which instruction files the selected agents actually load. Distinguish facts from unknown or proposed behavior. |
| 4 | Preserve real decision rationale; create decision records only for consequential choices. Avoid invented decisions and speculative context boundaries. |
| 5 | Identify canonical records for current architecture, implemented behavior and planned work. Set update triggers so they stay aligned without duplicating content. |
| 6 | Identify practical environment, credential and permission prerequisites, documenting gaps without storing secrets or claiming unavailable capabilities. |
| 7 | Make onboarding usable from a fresh checkout. Check install/start/verification commands, real feature entry points and agent document discovery. Report anything unverified. |
| 8 | Choose or reuse one authoritative place for plans and tasks. Define dependencies, starting points, review/commit expectations and any existing approval rules. Do not infer approval from labels. |

Use equivalent documents already present in the project rather than requiring the
playbook's exact filenames. For a new empty project, describe proposed architecture
and intended verification honestly; no existing feature map or running path can be
claimed yet. A document's purpose matters more than its filename.

## Keep outside mandatory preparation

Detailed GitHub Project configuration, installing named third-party skills,
mandatory per-ticket owner approval and the enoch-mode pilot are choices from the
old playbook, not universal prerequisites. Preparation can identify which apply;
separate setup or execution work can carry them out when authorized.

Code reviews, PR creation and release execution belong to later workflows.
Preparation should establish their expectations and evidence requirements, rather
than execute them prematurely. The end condition is an understandable plan and
verified prerequisites where possible, with explicit blockers and open questions.
