import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createJsonlObservability, ObservabilityError } from "../dist/index.js";

const RUN_ID = "run-observability-test";
const signal = () => new AbortController().signal;

function makeObserved(sequence, payload = { text: `event ${sequence}` }, moduleDetail) {
  return {
    event: {
      eventId: `event-${sequence}`,
      sequence,
      runId: RUN_ID,
      occurredAt: "2026-09-25T12:00:00.000Z",
      source: { id: "test-module", version: "1.0.0" },
      kind: "test.observed",
      payload,
    },
    ...(moduleDetail === undefined ? {} : { moduleDetail }),
  };
}

async function withRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), "studio-observability-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createRecorder(root, config = {}, runId = RUN_ID) {
  return createJsonlObservability(config, { rootDirectory: root, scope: { runId } });
}

function eventFile(root, runId = RUN_ID) {
  return join(root, `run-${encodeURIComponent(runId)}`, "events.jsonl");
}

test("buffers ordered events and flushes normalized and module-specific evidence", async () => {
  await withRoot(async (root) => {
    const recorder = createRecorder(root, { flushEveryEvents: 3 });
    const detail = { module: { id: "memory-facts", version: "2.1.0" }, schemaVersion: "1", detail: { recalled: ["fact-1"] } };
    assert.deepEqual(await recorder.append(makeObserved(0, { text: "one" }, detail), signal()), {
      status: "accepted", eventId: "event-0", sequence: 0, persistence: "buffered",
    });
    assert.deepEqual(await recorder.append(makeObserved(1), signal()), {
      status: "accepted", eventId: "event-1", sequence: 1, persistence: "buffered",
    });
    assert.deepEqual(await recorder.flush({ runId: RUN_ID }, signal()), {
      status: "durable", durableThroughSequence: 1, pendingEvents: 0,
    });
    const lines = (await readFile(eventFile(root), "utf8")).trimEnd().split("\n").map(JSON.parse);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].event.payload.text, "one");
    assert.deepEqual(lines[0].moduleDetail, detail);
    assert.equal(lines[1].event.sequence, 1);
  });
});

test("automatically flushes at the configured event threshold", async () => {
  await withRoot(async (root) => {
    const recorder = createRecorder(root, { flushEveryEvents: 1 });
    assert.deepEqual(await recorder.append(makeObserved(0), signal()), {
      status: "accepted", eventId: "event-0", sequence: 0, persistence: "durable",
    });
    assert.equal((await readFile(eventFile(root), "utf8")).split("\n").filter(Boolean).length, 1);
  });
});

test("deduplicates exact retries and rejects identity conflicts and older sequences", async () => {
  await withRoot(async (root) => {
    const recorder = createRecorder(root, { flushEveryEvents: 5 });
    const first = makeObserved(0);
    assert.equal((await recorder.append(first, signal())).status, "accepted");
    assert.deepEqual(await recorder.append(first, signal()), {
      status: "duplicate", eventId: "event-0", sequence: 0, persistence: "buffered",
    });
    assert.equal((await recorder.append(makeObserved(0, { text: "conflict" }), signal())).reason, "conflicting-duplicate");
    assert.equal((await recorder.append({ ...makeObserved(0), event: { ...makeObserved(0).event, eventId: "other-id" } }, signal())).reason, "conflicting-duplicate");
    assert.equal((await recorder.append(makeObserved(2), signal())).status, "accepted");
    assert.equal((await recorder.append(makeObserved(1), signal())).reason, "out-of-order");
  });
});

test("rejects malformed, oversized, and over-capacity records without persisting them", async () => {
  await withRoot(async (root) => {
    const recorder = createRecorder(root, {
      maxBufferedEvents: 2,
      maxBufferedBytes: 2_000,
      flushEveryEvents: 2,
      maxEventBytes: 1_000,
      maxModuleDetailBytes: 0,
      maxTrackedEvents: 2,
    });
    assert.equal((await recorder.append({ event: { ...makeObserved(0).event, runId: "another-run" } }, signal())).reason, "invalid");
    assert.equal((await recorder.append({ event: { ...makeObserved(0).event, occurredAt: "2026-02-30T12:00:00Z" } }, signal())).reason, "invalid");
    assert.equal((await recorder.append({ event: { ...makeObserved(0).event, occurredAt: `2026-09-25T12:00:00.${"1".repeat(10_000)}Z` } }, signal())).reason, "invalid");
    assert.equal((await recorder.append(makeObserved(0, { text: "x".repeat(1_200) }), signal())).reason, "invalid");
    let tooDeep = "leaf";
    for (let depth = 0; depth < 70; depth += 1) tooDeep = [tooDeep];
    assert.equal((await recorder.append(makeObserved(0, tooDeep), signal())).reason, "invalid");
    assert.equal((await recorder.append(makeObserved(0), signal())).status, "accepted");
    assert.equal((await recorder.append(makeObserved(1), signal())).status, "accepted");
    assert.equal((await recorder.append(makeObserved(2), signal())).reason, "capacity");
    assert.deepEqual(await recorder.flush({ runId: RUN_ID }, signal()), {
      status: "durable", durableThroughSequence: 1, pendingEvents: 0,
    });
  });
});

test("enforces the buffered-byte limit before storage", async () => {
  await withRoot(async (root) => {
    const first = makeObserved(0);
    const lineBytes = Buffer.byteLength(JSON.stringify(first));
    const recorder = createRecorder(root, {
      maxBufferedEvents: 2,
      maxBufferedBytes: lineBytes + 1,
      flushEveryEvents: 2,
      maxEventBytes: lineBytes,
      maxModuleDetailBytes: 0,
      maxTrackedEvents: 2,
    });
    assert.equal((await recorder.append(first, signal())).status, "accepted");
    assert.equal((await recorder.append(makeObserved(1), signal())).reason, "capacity");
    assert.deepEqual(await recorder.flush({ runId: RUN_ID }, signal()), {
      status: "durable", durableThroughSequence: 0, pendingEvents: 0,
    });
  });
});

test("enforces the total stored-byte limit across flushes", async () => {
  await withRoot(async (root) => {
    const first = makeObserved(0);
    const lineBytes = Buffer.byteLength(JSON.stringify(first));
    const recorder = createRecorder(root, {
      maxBufferedEvents: 2,
      maxBufferedBytes: lineBytes + 1,
      flushEveryEvents: 1,
      maxEventBytes: lineBytes,
      maxModuleDetailBytes: 0,
      maxTrackedEvents: 2,
      maxStoredBytes: lineBytes + 1,
    });
    assert.equal((await recorder.append(first, signal())).persistence, "durable");
    assert.equal((await recorder.append(makeObserved(1), signal())).reason, "capacity");
  });
});

test("rejects a flush for another run and handles pre-cancelled operations", async () => {
  await withRoot(async (root) => {
    const recorder = createRecorder(root, { flushEveryEvents: 5 });
    assert.equal((await recorder.flush({ runId: "different-run" }, signal())).failure.code, "OBSERVABILITY_RUN_MISMATCH");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(recorder.append(makeObserved(0), controller.signal), ObservabilityError);
    assert.deepEqual(await recorder.flush({ runId: RUN_ID }, controller.signal), {
      status: "durable", durableThroughSequence: null, pendingEvents: 0,
    });
    assert.equal((await recorder.append(makeObserved(0), signal())).persistence, "buffered");
    assert.equal((await recorder.flush({ runId: RUN_ID }, controller.signal)).status, "partial");
  });
});

test("reopens durable events, recognizes retries, and truncates an incomplete trailing line", async () => {
  await withRoot(async (root) => {
    const first = createRecorder(root, { flushEveryEvents: 1 });
    await first.append(makeObserved(0), signal());
    const path = eventFile(root);
    await writeFile(path, `${await readFile(path, "utf8")}{\"event\":`, "utf8");

    const reopened = createRecorder(root, { flushEveryEvents: 5 });
    assert.deepEqual(await reopened.append(makeObserved(0), signal()), {
      status: "duplicate", eventId: "event-0", sequence: 0, persistence: "durable",
    });
    assert.equal((await readFile(path, "utf8")).trimEnd().split("\n").length, 1);
    assert.deepEqual(await reopened.append(makeObserved(1), signal()), {
      status: "accepted", eventId: "event-1", sequence: 1, persistence: "buffered",
    });
  });
});

test("reconciles a write that reached storage before its acknowledgement was lost", async () => {
  await withRoot(async (root) => {
    const recorder = createRecorder(root, { flushEveryEvents: 2 });
    await recorder.append(makeObserved(0), signal());

    const probeHandle = await (await import("node:fs/promises")).open(eventFile(root), "a");
    const handlePrototype = Object.getPrototypeOf(probeHandle);
    await probeHandle.close();
    const originalSync = handlePrototype.sync;
    let failAfterSync = true;
    handlePrototype.sync = async function (...args) {
      const result = await originalSync.apply(this, args);
      if (failAfterSync) {
        failAfterSync = false;
        throw new Error("injected lost acknowledgement after file sync");
      }
      return result;
    };
    try {
      assert.deepEqual(await recorder.append(makeObserved(1), signal()), {
        status: "uncertain", eventId: "event-1", sequence: 1, persistence: "unknown",
      });
    } finally {
      handlePrototype.sync = originalSync;
    }

    assert.deepEqual(await recorder.flush({ runId: RUN_ID }, signal()), {
      status: "durable", durableThroughSequence: 1, pendingEvents: 0,
    });
    const records = (await readFile(eventFile(root), "utf8")).trimEnd().split("\n");
    assert.equal(records.length, 2);
    assert.deepEqual(records.map((line) => JSON.parse(line).event.sequence), [0, 1]);
  });
});

test("recovers a failed append after removing the obstructing event path", async () => {
  await withRoot(async (root) => {
    const recorder = createRecorder(root, { flushEveryEvents: 5 });
    await recorder.append(makeObserved(0), signal());
    const path = eventFile(root);
    await mkdir(path);
    assert.equal((await recorder.flush({ runId: RUN_ID }, signal())).status, "unknown");
    await rm(path, { recursive: true });
    assert.deepEqual(await recorder.flush({ runId: RUN_ID }, signal()), {
      status: "durable", durableThroughSequence: 0, pendingEvents: 0,
    });
    assert.equal((await readFile(path, "utf8")).trimEnd().split("\n").length, 1);
  });
});

test("cancellation during reconciliation prevents the next write from starting", async () => {
  await withRoot(async (root) => {
    const recorder = createRecorder(root, { flushEveryEvents: 5 });
    await recorder.append(makeObserved(0), signal());
    const path = eventFile(root);
    await mkdir(path);
    assert.equal((await recorder.flush({ runId: RUN_ID }, signal())).status, "unknown");
    await rm(path, { recursive: true });
    await writeFile(path, "", "utf8");

    const probe = await open(path, "r");
    const prototype = Object.getPrototypeOf(probe);
    await probe.close();
    const originalReadFile = prototype.readFile;
    let signalReadStarted;
    const readStarted = new Promise((resolve) => { signalReadStarted = resolve; });
    let releaseRead;
    const readGate = new Promise((resolve) => { releaseRead = resolve; });
    prototype.readFile = async function (...args) {
      signalReadStarted();
      await readGate;
      return originalReadFile.apply(this, args);
    };

    const controller = new AbortController();
    try {
      const pendingFlush = recorder.flush({ runId: RUN_ID }, controller.signal);
      await readStarted;
      controller.abort();
      releaseRead();
      const receipt = await pendingFlush;
      assert.equal(receipt.status, "partial");
      assert.equal(receipt.pendingEvents, 1);
      assert.equal(await readFile(path, "utf8"), "");
    } finally {
      prototype.readFile = originalReadFile;
    }

    assert.equal((await recorder.flush({ runId: RUN_ID }, signal())).status, "durable");
    assert.equal((await readFile(path, "utf8")).trimEnd().split("\n").length, 1);
  });
});

test("rejects a run identifier that could exceed the path limit", async () => {
  await withRoot(async (root) => {
    assert.throws(() => createRecorder(root, {}, "x".repeat(300)), ObservabilityError);
  });
});

test("rejects symlinked run directories and event files", async () => {
  await withRoot(async (root) => {
    const outside = join(root, "outside");
    await mkdir(outside);
    const escapedRun = join(root, `run-${encodeURIComponent(RUN_ID)}`);
    await symlink(outside, escapedRun, "dir");
    await assert.rejects(createRecorder(root).append(makeObserved(0), signal()), ObservabilityError);
    assert.deepEqual(await (await import("node:fs/promises")).readdir(outside), []);
    await rm(escapedRun);

    await mkdir(escapedRun);
    const target = join(outside, "should-not-be-written.jsonl");
    await writeFile(target, "keep this file unchanged\n", "utf8");
    await symlink(target, eventFile(root));
    await assert.rejects(createRecorder(root).append(makeObserved(0), signal()), ObservabilityError);
    assert.equal(await readFile(target, "utf8"), "keep this file unchanged\n");
  });
});

test("rejects blank complete lines instead of silently dropping evidence", async () => {
  await withRoot(async (root) => {
    const recorder = createRecorder(root, { flushEveryEvents: 1 });
    await recorder.append(makeObserved(0), signal());
    await writeFile(eventFile(root), `${await readFile(eventFile(root), "utf8")}\n`, "utf8");
    await assert.rejects(createRecorder(root).append(makeObserved(1), signal()), ObservabilityError);
  });
});
