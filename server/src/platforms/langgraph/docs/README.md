# LangGraph baseline notes

## What is implemented

The baseline is a small `StateGraph` with one model node. The graph is compiled with `SqliteSaver`, invoked with a stable `thread_id`, and consumed through the platform-local FastAPI service. The service streams LangGraph `v2` updates, tasks, and checkpoint parts into a redacted native event log.

The TypeScript side sends and validates JSON only. This is the seam that lets the Lab compare LangGraph with other platforms without pretending their state models are identical.

## Lifecycle

```text
POST /v1/runs
  -> queued service record
  -> running StateGraph
  -> model node and bounded node attempts
  -> SQLite checkpoint events
  -> completed / failed / cancelled / unknown inspection
```

`unknown` means the process stopped or the external model outcome could not be established. It is not a synonym for provider failure. The TypeScript adapter projects this state to the Lab's reconciliation-required terminal evidence.

## Persistence boundary

LangGraph checkpointers provide thread-scoped short-term state. This baseline does not add a LangGraph Store, Postgres, hosted Agent Server, LangSmith Deployment, tools, subgraphs, human approval, or automatic in-flight resume. SQLite is used because it makes checkpoint creation and restart inspection observable locally; it is not presented as the production persistence profile.

## First-party references

- [Application structure](https://docs.langchain.com/oss/python/langgraph/application-structure)
- [Persistence](https://docs.langchain.com/oss/python/langgraph/persistence)
- [Streaming](https://docs.langchain.com/oss/python/langgraph/streaming)
- [Fault tolerance](https://docs.langchain.com/oss/python/langgraph/fault-tolerance)
- [Run a local server](https://docs.langchain.com/oss/python/langgraph/local-server)
- [Functional API](https://docs.langchain.com/oss/python/langgraph/functional-api)
