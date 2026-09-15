# Hatchet baseline playground

This is a hands-on walkthrough for inspecting one real Hatchet run. It is not a
test, scenario, benchmark, or production entry point.

1. Start the pinned stack in [`server/src/platforms/hatchet/deployment`](../../../server/src/platforms/hatchet/deployment/README.md).
2. Create a local worker token and export `HATCHET_CLIENT_TOKEN`.
3. Start the separate worker from [`server/src/platforms/hatchet/docs/local-development.md`](../../../server/src/platforms/hatchet/docs/local-development.md).
4. Run the opt-in integration test:

   ```sh
   cd server
   AGENTLAB_RUN_HATCHET_INTEGRATION=1 npx tsx --test integration-tests/hatchet-baseline.test.ts
   ```

5. Inspect the generated `lab/runs/<run-id>/` directory. Compare:

   - `config.json`: the immutable Lab manifest;
   - `events.jsonl`: normalized task and Hatchet lifecycle events;
   - `result.json`, `trajectory.json`, `metrics.json`: comparable records;
   - `native/hatchet.json`: Hatchet IDs, worker, attempts, retries, and status.

The useful question is which state is owned by Hatchet and which state is a Lab
projection. Stop the worker or API after admission and inspect again to observe
the difference between a known platform run and an unresolved outcome.
