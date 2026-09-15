import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidDbosConfigError,
  loadDbosConfig,
  safeDatabaseProfile,
  safeManifestConfiguration,
} from "../../../src/platforms/dbos/config.js";

test("DBOS config keeps credentials out of the safe database profile", () => {
  const config = loadDbosConfig({
    AGENTLAB_DBOS_SYSTEM_DATABASE_URL: "postgresql://alice:secret@db.example:5433/lab",
    AGENTLAB_DBOS_SYSTEM_DATABASE_SCHEMA: "agentlab_dbos",
  });

  assert.deepEqual(safeDatabaseProfile(config), {
    host: "db.example",
    port: 5433,
    database: "lab",
    schema: "agentlab_dbos",
  });
  assert.equal(JSON.stringify(safeManifestConfiguration(config)).includes("secret"), false);
  assert.equal(JSON.stringify(safeManifestConfiguration(config)).includes("alice"), false);
});

test("DBOS config rejects non-PostgreSQL system databases", () => {
  assert.throws(
    () => loadDbosConfig({ AGENTLAB_DBOS_SYSTEM_DATABASE_URL: "sqlite:///tmp/db" }),
    (error: unknown) => error instanceof InvalidDbosConfigError,
  );
});

test("DBOS config validates the service port", () => {
  assert.throws(
    () => loadDbosConfig({ AGENTLAB_DBOS_PORT: "70000" }),
    /AGENTLAB_DBOS_PORT must be between 1 and 65535/,
  );
});
