# Computer Native source

Computer Native is a persistent agent product as well as an agent runtime. Its source is
organized by responsibility so that channels, scheduled work, plugins, and process
operations do not leak into the model-and-tool loop.

```text
gateway / cron / plugins / daemon
                 │
                 ▼
              runtime
       ┌───────┼────────┐
       ▼       ▼        ▼
   workspace  tools  persistence
       │       │        │
       └──── security / telemetry ────┘
```

Keep the agent runtime independent of Agent Harness Lab control-plane code. All
computer interaction must pass through explicit workspace, tool, and security modules.
