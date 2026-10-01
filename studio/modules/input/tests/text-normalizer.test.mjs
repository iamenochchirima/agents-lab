import assert from "node:assert/strict";
import test from "node:test";

import { createTextInputNormalizer, InputNormalizationError } from "../dist/index.js";

const source = Object.freeze({
  sourceId: "request-α",
  kind: "user",
  trust: "untrusted",
  receivedAt: "2026-09-25T09:30:00.125+02:00",
  mediaType: "text/plain",
});

test("normalization preserves text and host provenance and gives stable part IDs", () => {
  const normalizer = createTextInputNormalizer();
  const raw = {
    text: "  Keep this text exactly.\n",
    attachments: [
      { attachmentId: "file-1", name: "notes.txt", mediaType: "text/plain", byteLength: 19 },
      { attachmentId: "file-2", name: "diagram.png", mediaType: "image/png", byteLength: 4096 },
    ],
  };

  const first = normalizer.normalize(raw, source);
  const second = normalizer.normalize(raw, source);

  assert.deepEqual(first, second);
  assert.equal(first.task, raw.text);
  assert.deepEqual(first.parts, [
    {
      partId: "input:request-%CE%B1:text",
      kind: "text",
      content: raw.text,
    },
    {
      partId: "input:request-%CE%B1:attachment:file-1",
      kind: "attachment-reference",
      attachment: raw.attachments[0],
    },
    {
      partId: "input:request-%CE%B1:attachment:file-2",
      kind: "attachment-reference",
      attachment: raw.attachments[1],
    },
  ]);
  assert.deepEqual(first.source, source);
  assert.equal(first.source.trust, "untrusted");
  assert.notEqual(first.source, source);
  assert.ok(Object.isFrozen(first) && Object.isFrozen(first.parts) && Object.isFrozen(first.source));
  assert.ok(first.parts.every(Object.isFrozen));
});

test("counts encoded UTF-8 bytes and allows exactly the configured limit", () => {
  const raw = { text: "A🙂" };
  assert.equal(createTextInputNormalizer({ maxTextBytes: 5 }).normalize(raw, source).task, raw.text);
  assert.throws(
    () => createTextInputNormalizer({ maxTextBytes: 4 }).normalize(raw, source),
    (error) => error instanceof InputNormalizationError && error.code === "INPUT_TOO_LARGE",
  );
});

test("enforces attachment count, unique IDs, and reference field validity", () => {
  const attachment = { attachmentId: "same", name: "ref", mediaType: "application/octet-stream", byteLength: 0 };
  const normalizer = createTextInputNormalizer({ maxAttachments: 1 });
  assert.equal(normalizer.normalize({ text: "task", attachments: [attachment] }, source).parts.length, 2);
  assert.throws(
    () => normalizer.normalize({ text: "task", attachments: [attachment, { ...attachment, attachmentId: "other" }] }, source),
    (error) => error instanceof InputNormalizationError && error.code === "INPUT_TOO_LARGE",
  );
  assert.throws(
    () => createTextInputNormalizer().normalize({ text: "task", attachments: [attachment, attachment] }, source),
    (error) => error instanceof InputNormalizationError && error.code === "INVALID_RAW_INPUT",
  );
  const sparseAttachments = Array(1);
  assert.throws(
    () => createTextInputNormalizer().normalize({ text: "task", attachments: sparseAttachments }, source),
    (error) => error instanceof InputNormalizationError && error.code === "INVALID_RAW_INPUT",
  );
  assert.throws(
    () => createTextInputNormalizer().normalize({ text: "task", attachments: [{ ...attachment, byteLength: -1 }] }, source),
    (error) => error instanceof InputNormalizationError && error.code === "INVALID_RAW_INPUT",
  );
});

test("rejects empty, malformed, and unsupported raw input", () => {
  const normalizer = createTextInputNormalizer();
  for (const raw of [null, [], {}, { text: "" }, { text: " \n\t" }, { text: "\ud800" }, { text: "task", extra: true }]) {
    assert.throws(
      () => normalizer.normalize(raw, source),
      (error) => error instanceof InputNormalizationError && error.code === "INVALID_RAW_INPUT",
    );
  }
});

test("validates source metadata and an actual RFC 3339 calendar date and offset", () => {
  const normalizer = createTextInputNormalizer();
  const invalidSources = [
    { ...source, sourceId: " " },
    { ...source, kind: "unknown" },
    { ...source, trust: "verified" },
    { ...source, receivedAt: "2026-02-29T12:00:00Z" },
    { ...source, receivedAt: "2024-02-29T12:00:00" },
    { ...source, receivedAt: "2024-02-29T12:00:00+24:00" },
    { ...source, receivedAt: "2024-13-01T12:00:00Z" },
    { ...source, mediaType: " text/plain" },
    { ...source, extra: "unrecorded" },
  ];
  for (const invalidSource of invalidSources) {
    assert.throws(
      () => normalizer.normalize({ text: "task" }, invalidSource),
      (error) => error instanceof InputNormalizationError && error.code === "INVALID_SOURCE_METADATA",
    );
  }

  assert.equal(
    normalizer.normalize({ text: "task" }, { ...source, receivedAt: "2024-02-29t12:00:00z" }).source.receivedAt,
    "2024-02-29t12:00:00z",
  );
  assert.equal(
    normalizer.normalize({ text: "task" }, { ...source, receivedAt: "2017-01-01T00:59:60+01:00" }).source.receivedAt,
    "2017-01-01T00:59:60+01:00",
  );
  assert.throws(
    () => normalizer.normalize({ text: "task" }, { ...source, receivedAt: "2024-02-29T12:00:60Z" }),
    (error) => error instanceof InputNormalizationError && error.code === "INVALID_SOURCE_METADATA",
  );
});
