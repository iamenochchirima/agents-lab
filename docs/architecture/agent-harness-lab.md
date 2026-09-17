# Agent Harness Lab

## Canonical agent execution model

This is the model Agent Harness Lab will build against. It does not prescribe a
framework or claim every platform implements every box. It defines the work an
agent execution may need to do, the boundaries we must observe, and the places
where platform choices become experimentally meaningful.

```mermaid
flowchart LR
  Input[Channel, CLI, gateway, cron] --> Entry
  subgraph Runtime[Selected platform variant runtime]
  direction LR
  Entry[Agent run entry] --> Session[Session and workspace state]
  Session --> Identity[Agent identity and behavior: SOUL.md and system instructions]
  Session --> Instructions[Workspace instructions and procedures: AGENTS.md and skills]
  Session --> Memory[Memory and conversation context: transcript, retrieval, scenario state]
  Session --> Capabilities[Tool and capability context: tools, permissions, environment]
  Identity --> Context[Assemble model context]
  Instructions --> Context
  Memory --> Context
  Capabilities --> Context
  Context --> Loop[Agent execution loop]
  Loop --> Model[Model request and response]
  Model -->|tool, subagent, or event request| Request[Tool, subagent, or event request]
  Request --> Policy[Policy, permissions, approval]
  Policy --> Action[Execute tool or deliver work]
  Action -->|tool result or external event| Loop
  Loop --> Durable[State, checkpoint, retry, suspend, resume]
  Durable -->|continue| Context
  Model -->|final response| Delivery[Result delivery]
  Loop --> Native[Native telemetry, logs, artifacts]
  Action --> Native
  Durable --> Native
  end
  Native --> Evidence[Lab normalizes evidence and metrics]
  Evidence --> Result[Standardized run record and result]
  Environment[Environment and infrastructure] -. workspace, sandbox, services .-> Action
```

<!-- agentlab:reference-code-map-steps -->

## Normal tool-using turn

```mermaid
sequenceDiagram
  participant Caller as Channel, CLI, gateway, or cron
  participant Lab as Lab run coordinator
  participant Runtime as Selected platform runtime
  participant State as Session and workspace state
  participant Context as Context builder
  participant Model as Model provider
  participant Action as Policy and tool executor
  participant Evidence as Evidence recorder

  Caller->>Lab: Trigger a run
  Lab->>Runtime: Start selected variant with effective configuration
  Runtime->>State: Load or create session and workspace state
  Runtime->>Context: Build model context
  Context->>State: Read SOUL, AGENTS, skills, memory, transcript, tools
  Context-->>Runtime: Context and tool descriptions

  loop Until final response, suspension, or failure
    Runtime->>Model: Request next response
    alt Model requests an action
      Model-->>Runtime: Tool, subagent, or event request
      Runtime->>Action: Validate policy, permission, and approval
      Action->>Action: Execute tool or external action
      Action-->>Runtime: Action result
      Runtime->>State: Persist progress where the variant supports it
      Runtime->>Evidence: Emit native execution events
    else Model returns a final response
      Model-->>Runtime: Final response
    end
  end

  Runtime->>State: Persist final state and artifacts
  Runtime->>Evidence: Emit terminal native events
  Evidence->>Lab: Normalize telemetry, artifacts, and metrics
  Lab->>Evidence: Write standardized run record
  Runtime-->>Caller: Deliver result
```

## Platform mapping contract

Every platform variant will get its own diagram using this same shape. Its map
must answer these questions for every applicable stage:

| Question | Why it matters |
| --- | --- |
| Which module or service owns this stage? | Keeps framework-specific code out of shared layers. |
| What enters and leaves it? | Makes context, state, and side effects inspectable. |
| What is persisted here? | Defines restart and recovery behaviour. |
| What failures can occur here? | Defines meaningful experiments and chaos injection. |
| What telemetry is emitted here? | Lets the Lab compare evidence without erasing native detail. |
| Is the capability absent, partial, or intentionally delegated? | Prevents false equivalence between platforms. |

The platform page will not claim that its internal call graph matches this exact
diagram. It will map each responsibility to that platform's real design. A
Temporal variant may make durability central. Anesu owns its own execution
and recovery choices outside this repository. Its computer environment may affect
context and tool execution without being the execution loop itself.

## What is shared and what is replaceable

| Shared Lab responsibility | Replaceable platform implementation |
| --- | --- |
| Run manifest and standardized evidence | Temporal history, LangGraph trace, SDK trace, custom logs |
| Scenario contract and graders | Agent graph, SDK agent, direct loop, workflow activity |
| Experiment and failure specification | Platform-specific fault hook or infrastructure fault |
| Normalized telemetry adapter | Platform-native observability integration |
| Anesu environment contract | Local workspace process, container sandbox, VM / remote computer |
| Backend deployment profile | Service/worker topology, persistence, networking, secrets, and observability |

This is the boundary we should protect as implementation begins. Shared Lab code
defines experiments and evidence. Platform code owns the mechanics of running
an agent under those conditions.
