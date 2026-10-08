# Memory mechanisms and evaluation for Lina

Research date: 2026-10-08. Status: research and architectural recommendations, no Memory graph implementation or measured Lina results.

This report studies mechanisms that can inform Lina's Memory block. It distinguishes what a source implements or measures from what we recommend. Primary papers and official documentation are the evidence. Mutable documentation was checked on the research date; the paper versions below are fixed. Letta's older guides redirect to explicitly labelled legacy V1 SDK documentation. Its current Agent SDK has a different file/repository model, described separately below.

## The decisions behind a memory block

Memory has at least three separate design dimensions. The content may be a fact, an episode, or a reusable procedure. Its representation may be a profile, text note, source transcript, linked collection, or executable artifact. Its use may be automatic context inclusion, explicit search, or background learning. A vector index answers a retrieval question; it does not decide which facts should become memory or who may access them.

LangGraph's official guide distinguishes semantic facts, episodic experiences and procedural instructions. It separates thread-scoped state/checkpoints from cross-thread JSON stores with namespaces and keys. It also compares a growing profile with a document collection, and foreground writes with background writes. Semantic memory is distinct from semantic search. These are useful vocabulary and implementation choices, rather than a requirement to use LangGraph. [Official memory overview](https://docs.langchain.com/oss/python/concepts/memory).

For Lina, use Memory to manage retained knowledge and its lifecycle. Let State own transactional records and recovery acknowledgements. Let Context own the final bounded model input. History can remain a source of evidence without becoming an automatically trusted user profile. A successful storage write says that data was stored; it does not say that an extracted claim is true.

## Fixed paper versions and inspected official material

| Source | First submission and version studied | Why it matters |
| --- | --- | --- |
| MemGPT | 2023-10-12; v2, 2024-02-12 | Agent-controlled movement between context and external memory |
| Generative Agents | 2023-04-07; v2, 2023-08-06 | Observation retrieval, importance and reflection |
| Voyager | 2023-05-25; v2, 2023-10-19 | Verified task programs as reusable procedural memory |
| LongMemEval | 2024-10-14; v2, 2025-03-04; ICLR 2025 | Index, query, reader decisions and temporal QA |
| LoCoMo | v1, 2024-02-27 | Long conversational histories and causal/temporal questions |
| A-MEM | 2025-02-17; v11, 2025-10-08; NeurIPS 2025 | Atomic notes, generated links and memory evolution |
| MINJA | 2025-03-05 preprint; NeurIPS 2025 proceedings | Query-only poisoning of memories used by later tasks |
| LightMem | 2025-10-21; v4, 2026-02-28; ICLR 2026 | Filtering, batching and offline consolidation |
| MemoryArena | v1, 2026-02-18 | Memory used to perform interdependent later tasks |
| Letta and LangGraph documentation | Mutable pages checked 2026-10-08 | Concrete ownership, storage and access mechanisms |

Dates and publication labels come from the linked primary records in the sections below. The report does not compare current commercial product scores. No benchmark was run locally.

## Mechanisms worth understanding

### Always-present memory and searchable memory

MemGPT uses a hierarchy in which the model can call memory-management functions to move material between limited context and larger external stores. Its control flow allows further internal processing before returning to the user. The paper evaluates document analysis and multi-session conversation. It supports the idea of explicit read/write operations and budgeted memory movement, rather than proving that autonomous memory management is best for every workload. [MemGPT v2](https://arxiv.org/html/2310.08560v2).

Letta's V1 core memory blocks persist across interactions and appear in the prompt without retrieval. Blocks have labels, descriptions and limits; they can be shared and made read-only. Its archival store instead supports agent insertion, semantic search, tag filtering and pagination. Developers have mutation/deletion APIs beyond the agent's default archival tools. These are two access patterns that can coexist. [Memory blocks](https://docs.letta.com/v1-sdk/memory/memory-blocks), [archival memory](https://docs.letta.com/v1-sdk/memory/archival-memory).

The current Letta Agent SDK describes agent-owned memory in a git repository, projected onto a working computer by MemFS. Creation entries become Markdown files. Files under `system/` enter the prompt every turn; other files appear as a tree and are read on demand. The documentation says edits become memory after commit and push. Its "dreaming" uses background subagents to review conversations and update memory, with step-count or compaction-event triggers and reminder or automatic-launch behavior. This is a current documented file-based approach, separate from the legacy block/archive APIs. [Agent SDK memory](https://docs.letta.com/agent-sdk/memory).

Lina inference: a small selected profile can provide predictable access to stable preferences, while a searchable collection handles a growing history. Compare their token cost and omission errors before deciding which fields should always be present. A readable file and a JSON document can express the same logical profile; neither implies a particular retrieval policy or durability guarantee.

### Episodes and derived reflections

Generative Agents stores natural-language observations in a memory stream. Retrieval combines normalized recency, model-assigned importance and embedding relevance, selecting entries that fit context. The implementation generates reflections when accumulated importance crosses a threshold; reflections can participate in later retrieval alongside observations. Its evaluation concerns believable behavior in a simulated town and architecture ablations, not correctness of a production assistant's remembered facts. [Generative Agents v2, sections 4 and 6](https://arxiv.org/html/2304.03442v2).

Lina inference: an observed episode and a generated interpretation should have different record kinds. The interpretation should reference its evidence. Repeated model reflection must not turn a guess into a confirmed fact merely because the same statement now appears in several derived notes. Experience retrieval is useful when a later task resembles an earlier success or failure; an episode need not be reduced to a general rule.

### Reusable procedures

Voyager stores executable programs after an iterative process involving execution feedback, errors and a model success check. The program description supplies an embedding index; later tasks retrieve relevant skills for further code generation. Its experiments concern Minecraft exploration and transfer. This is a concrete example of procedural memory, with a success gate before admission to the library. [Voyager v2, section 2.2](https://arxiv.org/html/2305.16291v2).

Lina inference: learned procedures should be proposed artifacts. Tools and Skills retain authority over installing or executing them. A recalled recipe can inform planning without becoming permission to run arbitrary code. Track the environment, tool versions and observations under which it worked. A procedure that succeeds once can still fail after a tool or environment changes.

### Linked notes and evolving representations

A-MEM constructs notes containing original content, timestamp, generated keywords/tags/context descriptions, embeddings and links. It first finds related historical notes, then uses the model to judge connections and update related representations. Retrieval can access related linked notes as well as embedding matches. The paper studies conversational QA with different models and ablations. Link formation and evolution add model calls and mutable derived information; their benefits are evidence for those evaluated tasks, not proof that every agent needs a knowledge graph. [A-MEM v11, section 3](https://arxiv.org/html/2502.12110v11), [official implementation](https://github.com/agiresearch/A-mem).

Lina inference: preserve original evidence and version generated representations separately. Compare links against the same note collection without links. Use a fixed retrieval budget, since graph expansion can otherwise win by showing the reader more evidence. Links must carry a relation and confidence/source status; similarity alone does not establish causation or agreement.

### Filtering and offline consolidation

LightMem separates lightweight filtering/compression and topic grouping, short-term topic consolidation, and offline long-term updates. Its update analysis discusses erroneous deletion when a model mistakes compatible information for contradiction. The v4 paper distinguishes total lifecycle cost from online inference cost. It supplies a grounded reason to test batching and deferred consolidation, with the risk that newly learned information is unavailable before background work completes. [LightMem v4](https://arxiv.org/html/2510.18866v4).

Lina inference: background writes need explicit pending, committed and failed states. Context must know whether it reads the latest committed view or waits for a required write. Record consolidation cost even when it happens outside the visible turn. A queued update cannot truthfully produce a "remembered" acknowledgement until the chosen write contract is satisfied.

## Evaluation evidence and its limits

### Conversational recall

LongMemEval has 500 questions covering extraction, multi-session reasoning, temporal reasoning, knowledge updates and abstention. Its design analysis varies stored-value granularity, index keys, time-aware query construction and reader strategy. Its released data provides timestamps and evidence labels, plus an oracle-evidence condition. These enable separation of retrieval failure from reader failure. The evaluation script uses a model judge; answer correctness is not equivalent to safe agent action or reliable persistence. [Paper v2](https://arxiv.org/html/2410.10813v2), [official data and evaluation repository](https://github.com/xiaowu0162/LongMemEval).

LoCoMo uses long multi-session conversational histories and evaluates QA, event summarization and multimodal dialogue generation. Its official repository supplies RAG experiments over dialogs, extracted observations and session summaries. The project describes model-generated conversations with human annotation/verification. It is useful for comparing representations while keeping a conversation corpus fixed, but remains a constructed conversational task distribution. [Paper v1](https://arxiv.org/abs/2402.17753v1), [project](https://snap-research.github.io/locomo/), [official repository](https://github.com/snap-research/locomo).

Do not treat one aggregate score as a memory architecture verdict. Report results by question type, the amount of evidence retrieved, reader model, judge version and prompt, and total token/latency cost. Run unknown-information cases: a system that always supplies a plausible answer may improve some answer scores while failing abstention.

### Memory that changes future action

MemoryArena evaluates interdependent multi-session tasks in shopping, travel planning, progressive search and formal reasoning. Earlier actions and feedback must inform later subtasks. This directly studies a weakness of isolated conversational recall benchmarks: recalling a fact does not establish that the agent uses it correctly. The paper's task domains and environments bound its conclusions. The primary paper was inspected; this report does not claim that its full runner was executed or that every published environment can currently be reproduced locally. [MemoryArena v1](https://arxiv.org/html/2602.16313v1).

Lina needs both recall tests and action tests. For example, a later task must select a compatible item using an earlier purchase record, or avoid a previously observed failing tool sequence. Separately test storage/recovery faults, deletion and scope denial; published QA accuracy does not establish these guarantees.

## Poisoning, privacy and deletion

MINJA demonstrates that queries alone can induce malicious records in agents whose later behavior depends on recalled examples. The attack uses bridging steps and gradually removes the conspicuous indication prompt. Its demonstrated agents and attacker setup bound the result; it is sufficient evidence that memory admission deserves a trust boundary. It does not establish a universal attack-success rate or a universal defense. [MINJA preprint](https://arxiv.org/abs/2503.03704), [NeurIPS 2025 paper](https://papers.nips.cc/paper_files/paper/2025/file/42a97bbd9844d2bf68596730af80bcdf-Paper-Conference.pdf).

Recommended Lina requirements, not claims that these papers implement them:

- Authorize read and write namespaces before retrieval or mutation. User-private, workspace-shared and agent-private records need explicit access rules. A namespace name alone is not an authorization mechanism.
- Keep source identity and source event references. Distinguish user assertions, trusted external observations, assistant-generated claims and inferred summaries. Assistant output should not silently become a user assertion.
- Preserve trust status through extraction, retrieval and Context packaging. Recalled content is evidence, not a higher-priority instruction, permission or grant.
- Define sensitive-data admission and redaction rules. Secret values belong in the credential system, not searchable memories. Provenance references must not expose private content to an unauthorized reader.
- Define "forget" across the source record, profile copies, embeddings, summaries, linked notes, caches and queued consolidation. Otherwise a derived memory or delayed job can recreate a supposedly deleted fact.
- Separate logical suppression, physical removal and backup retention. Report what was removed and what remains subject to a retention policy. Avoid an unconditional deletion promise that the backend cannot meet.
- Recheck access and deletion status when using a cached retrieval result. A result that was allowed when cached may be disallowed later.
- Use explicit source lineage for derived records so a correction or deletion can invalidate affected descendants. Keep audit metadata within its own privacy policy; do not retain the forgotten content in an unrestricted audit payload.

Scope leaks and instructions promoted from recalled content are correctness failures. They are not acceptable settings to trade against a higher recall score.

## A practical lifecycle to model

The following is a Lina recommendation assembled from the evidence, not one source's universal architecture.

1. Resolve readable/writable scopes and a stable committed view.
2. Load selected always-present records and prepare a retrieval query with time/entity constraints where justified.
3. Retrieve candidates, then filter, rank and deduplicate within the permitted scope and context budget.
4. Return evidence with source references, record revisions, temporal validity and empty/insufficient/conflicting outcomes. Context chooses the final model-facing packaging.
5. Capture an explicit remember/correct/forget request or propose learned candidates from permitted events.
6. Validate candidates against their sources and memory policy. Reject, defer or request clarification when there is insufficient support.
7. Compare candidates with existing records. Choose add, amend, supersede, merge, delete or no change. Ambiguous contradictions should remain visible rather than being resolved by recency alone.
8. Commit against an expected revision and mutation identity. State handles persistence acknowledgements and retry reconciliation; a background retry cannot overwrite a newer correction unchecked.
9. Update derived indexes and invalidate stale caches. Distinguish stored-but-not-indexed from fully searchable.
10. Run bounded consolidation/expiry/deletion maintenance, preserving source lineage and authority checks.

Temporal validity needs two concepts: when a statement applies in the world, and when the system learned it. "I moved to Cape Town last month" is recorded today but describes an earlier change. A newer statement can also describe an older episode. Keep both timestamps and a supersession relation; historical questions should not automatically use only the latest profile value.

Suggested record fields are `id`, `revision`, `kind`, `scope`, `content`, `sourceRefs`, `assertedBy`, `trust`, `observedAt`, `validFrom`, `validTo`, `supersedes`, `derivedFrom`, `retention`, and lifecycle status. These are contract candidates for subsequent design, not a finalized JSON schema or an instruction to put every field on every kind of record. Retrieval outcomes should distinguish no relevant evidence, denied scope, stale index, unavailable store and unresolved conflict.

## Correctness requirements versus meaningful experiments

| Area | Baseline requirement | Policy variation worth testing |
| --- | --- | --- |
| Scope | Enforce authorized reads/writes and preserve source visibility | Which permitted scopes are searched for a task |
| Admission | Ground candidate claims; retain source/trust; respect consent/retention | Explicit-only writes, automatic extraction, or a hybrid |
| Representation | Keep recoverable evidence for consequential claims | Profile versus atomic notes versus episodes, or layered combinations |
| Retrieval | Filter unauthorized/deleted entries; bounded output | Keyword, dense and hybrid retrieval; query rewriting and reranking |
| Time | Preserve correction and historical semantics | Time-aware query expansion and recency weighting |
| Reflection | Identify inference and preserve evidence lineage | No reflection, triggered reflection, or scheduled consolidation |
| Writes | Revision checks, stable mutation identity, honest acknowledgement | Foreground versus background; batching and debounce thresholds |
| Forgetting | Fulfil declared deletion semantics and stop resurrection | Retention horizons and permitted decay policies |
| Procedures | Do not bypass Tools/Safety authority | Episode examples versus validated recipes versus skills |

Parallel retrieval can reduce latency for independent permitted stores. It does not establish which retrieval policy returns the most useful evidence. Measure backend fan-out, query latency and the merged budget; avoid calling unrestricted cross-scope search a recall optimization.

## Controlled experiments for later implementation

Start with a shared source corpus and a no-memory baseline, a bounded full-history baseline where feasible, and an oracle-evidence reader condition. Freeze the reader model, prompts, model parameters, source ordering, token budget and task set. A baseline that receives a larger context budget is a different comparison.

| Experiment | Change one variable | Main observations |
| --- | --- | --- |
| Representation | Whole exchanges, atomic facts, episodes, or profile | Evidence recall, lost detail, update correctness, storage and indexing cost |
| Query/retrieval | Keyword, dense, hybrid under the same corpus/budget | Recall of required evidence, irrelevant token share, latency |
| Temporal search | Plain query versus time/entity expansion | Historical-answer and current-answer accuracy, wrong-era recall |
| Write timing | Foreground versus delayed consolidation | Read-your-write behavior, turn latency, staleness, total background cost |
| Admission | Explicit-only versus automatic versus hybrid | Useful fact coverage, unsupported writes, user corrections, poisoning cases |
| Derived learning | Raw episodes versus reflection or linked notes | Downstream success, contradictory inference, maintenance cost |
| Procedure reuse | Episodes versus reviewed procedural artifacts | Task completion, tool errors, environment-change failures |

Record source corpus hash, source IDs and timestamps, mutations, rejected candidates, index and embedding versions, selected evidence, scores, revisions, reader inputs and outputs, judge configuration, foreground/background timings and total cost. Keep snapshots isolated between variants. Use held-out development/evaluation splits, and repeated runs for model-driven steps; deterministic Studio animation is not evidence of model accuracy.

Required fault and lifecycle cases include duplicate writes, lost commit acknowledgement, concurrent corrections, a deletion during retrieval, stale index entries, a background writer after deletion, denied child-agent reads, unsupported inferred preferences, changed facts, ambiguous contradictions and store unavailability. These validate the architecture's promises independently of the policy experiments.

## Research limits and next decision

This study is mechanism-focused. It does not select a storage vendor, embedding model or memory framework. It does not assume that a graph store is required or that autonomous rewriting is the default. LongMemEval, LoCoMo and MemoryArena cover different distributions, and none supplies a complete privacy, concurrency or recovery test suite for Lina.

The next design should settle scope/authority, evidence lineage, update/delete semantics, Context handoffs and State acknowledgements first. Then choose a modest baseline representation and read/write policy. Reserve strategy seams for the comparisons above, rather than implementing every published memory system at once.
