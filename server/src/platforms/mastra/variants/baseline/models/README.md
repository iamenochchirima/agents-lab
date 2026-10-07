# models

Owns this variant's provider and model wiring.

## Recoverable connected read feedback

A known failed `fixture_lookup` or `mcp_fixture_lookup` returns its real bounded
error content to the native Mastra continuation. Tool observations and failure
events remain retained. Write failures, unknown outcomes, cancellation and
timeouts preserve their terminal behavior. This policy does not retry the tool;
the next model step decides whether a new permitted read is useful.
