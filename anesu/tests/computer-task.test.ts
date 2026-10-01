import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compileComputerTask, ComputerTaskCompileError, authorizeComputerTaskMutation, computerConversationPermission, computerTaskApprovalRequest, computerTaskValueEvidence, type ComputerTaskGrantState } from "../src/computer/task.js";
import { ComputerRouter } from "../src/computer/router.js";
import { NATIVE_APPLICATION_CATALOG, resolveNativeApplication } from "../src/computer/native-runner.js";

test("the code-owned native catalog and Cua app resources stay in lockstep", async () => {
  const manifest = await readFile(path.join(process.cwd(), "config", "cua-native-capabilities.yaml"), "utf8");
  const manifestPaths = [...manifest.matchAll(/^\s+- executable:\s*([^\s#]+)\s*$/gmu)].map((match) => match[1]);

  assert.deepEqual(
    manifestPaths,
    NATIVE_APPLICATION_CATALOG.map((application) => application.launchPath),
  );
  assert.equal(new Set(manifestPaths).size, manifestPaths.length);
});

test("the native catalog resolves ordinary open requests without turning app names into commands", () => {
  assert.deepEqual(resolveNativeApplication("Open System Settings."), { name: "Settings", launchPath: "/usr/bin/gnome-control-center" });
  assert.equal(resolveNativeApplication("Open the Files app."), undefined);
  assert.equal(resolveNativeApplication("Run a command in the terminal."), undefined);
});

test("computer task compilation preserves source-backed browser values and a stable grant identity", () => {
  const task = compileComputerTask({
    taskId: "task-browser-1",
    goal: 'Open example.com and type "Anesu acceptance" in the message field, then reveal the safe result.',
    surface: "browser",
    allowedOrigins: ["https://example.com"],
    maxActions: 3,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });

  assert.equal(task.taskId, "task-browser-1");
  assert.equal(task.profile.mode, "isolated_new");
  assert.equal(task.inputRoute, "trusted");
  assert.deepEqual(task.allowedOrigins, ["https://example.com"]);
  assert.deepEqual(task.values.text, {
    value: "Anesu acceptance",
    source: { start: 26, end: 44, text: '"Anesu acceptance"' },
  });
  assert.deepEqual(task.values.url, {
    value: "https://example.com/",
    source: { start: 5, end: 16, text: "example.com" },
  });
  assert.deepEqual(task.allowedActions, ["prepare", "navigate", "click", "type"]);
  assert.equal(task.completion.kind, "text-present");
  assert.equal(task.expiresAtMs, 31_000);
  assert.match(task.grantHash, /^[a-f0-9]{64}$/u);
});

test("an explicit public URL outside the base origins compiles to its single canonical origin", () => {
  const goal = "Open HTTPS://WWW.MOZILLA.ORG:443/docs/start?from=chat and tell me the heading.";
  const rawUrl = "HTTPS://WWW.MOZILLA.ORG:443/docs/start?from=chat";
  const task = compileComputerTask({
    taskId: "task-public-browser",
    goal,
    surface: "browser",
    allowedOrigins: ["https://example.com", "http://anesu.test"],
    maxActions: 2,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });

  assert.deepEqual(task.allowedOrigins, ["https://www.mozilla.org"]);
  assert.deepEqual(task.values.url, {
    value: "https://www.mozilla.org/docs/start?from=chat",
    source: { start: goal.indexOf(rawUrl), end: goal.indexOf(rawUrl) + rawUrl.length, text: rawUrl },
  });
  assert.equal(task.completion.kind, "browser-heading");
  assert.deepEqual(task.allowedActions, ["prepare", "navigate"]);
  assert.match(task.grantHash, /^[a-f0-9]{64}$/u);
});

test("a browser follow-up without a URL inherits only the freshly observed current origin", () => {
  const task = compileComputerTask({
    taskId: "task-browser-follow-up",
    goal: "Read the current page and tell me its heading.",
    surface: "browser",
    allowedOrigins: [],
    currentBrowserOrigin: "HTTPS://EXAMPLE.COM:443/path",
    browserAgentMode: true,
    maxActions: 4,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });

  assert.deepEqual(task.allowedOrigins, ["https://example.com"]);
  assert.equal(task.browserOriginPolicy, "public-web");
  assert.equal(task.values.url, undefined);
  const grant: ComputerTaskGrantState = { approved: true, actionCount: 0, taskHashes: [task.grantHash] };
  authorizeComputerTaskMutation(task, grant, { action: "navigate", nowMs: 1_001, origin: "https://example.com" });
  assert.throws(
    () => authorizeComputerTaskMutation(task, grant, { action: "navigate", nowMs: 1_001, origin: "https://other.example" }),
    /outside the approved task origins/u,
  );
});

test("a form email address does not become the browser task URL", () => {
  const task = compileComputerTask({
    taskId: "task-form-email-follow-up",
    goal: "Put ada@example.com in Email on the current form; do not submit.",
    surface: "browser",
    browserAgentMode: true,
    allowedOrigins: [],
    currentBrowserOrigin: "https://kasitek.co.za/early-access",
    maxActions: 4,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });
  assert.equal(task.values.url, undefined);
  assert.deepEqual(task.allowedOrigins, ["https://kasitek.co.za"]);
});

test("a model-directed browser task may start without a URL and grants no initial site origin", () => {
  const task = compileComputerTask({
    taskId: "task-browser-search",
    goal: "Search the web for local astronomy clubs.",
    surface: "browser",
    browserAgentMode: true,
    allowedOrigins: ["https://example.com", "http://localhost:4173"],
    maxActions: 4,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });

  assert.deepEqual(task.allowedOrigins, []);
  assert.equal(task.browserOriginPolicy, "public-web");
  assert.equal(task.values.url, undefined);
  assert.throws(() => compileComputerTask({
    taskId: "task-legacy-browser-without-url",
    goal: "Search the web for local astronomy clubs.",
    surface: "browser",
    allowedOrigins: [],
    maxActions: 4,
    nowMs: 1_000,
    deadlineMs: 30_000,
  }), /HTTP\(S\) URL or an active browser page/u);
});

test("a conversation permission matches the browser envelope, not the prompt or current public site", () => {
  const makeTask = (taskId: string, goal: string, currentBrowserOrigin?: string, maxActions = 4) => compileComputerTask({
    taskId,
    goal,
    surface: "browser",
    browserAgentMode: true,
    allowedOrigins: [],
    ...(currentBrowserOrigin ? { currentBrowserOrigin } : {}),
    maxActions,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });
  const first = computerConversationPermission(computerTaskApprovalRequest(makeTask("browser-1", "Open https://example.com", undefined)));
  const later = computerConversationPermission(computerTaskApprovalRequest(makeTask("browser-2", "Read this page", "https://other.example")));
  const wider = computerConversationPermission(computerTaskApprovalRequest(makeTask("browser-3", "Read this page", "https://other.example", 8)));
  assert.ok(first);
  assert.equal(first.identityHash, later?.identityHash);
  assert.notEqual(first.identityHash, wider?.identityHash);
  assert.match(first.label, /isolated browser on public HTTPS sites/u);
});

test("public-web task grants admit only URL-policy-validated public HTTPS origins", () => {
  const task = compileComputerTask({
    taskId: "task-public-web-transition",
    goal: "Open https://example.com and read the page.",
    surface: "browser",
    browserAgentMode: true,
    allowedOrigins: [],
    maxActions: 3,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });
  const grant: ComputerTaskGrantState = { approved: true, actionCount: 0, taskHashes: [task.grantHash] };

  assert.equal(task.browserOriginPolicy, "public-web");
  authorizeComputerTaskMutation(task, grant, {
    action: "navigate",
    nowMs: 1_001,
    origin: "https://www.mozilla.org",
    validatedPublicOrigin: true,
    consumeAction: true,
  });
  assert.equal(grant.actionCount, 1);
  assert.throws(
    () => authorizeComputerTaskMutation(task, grant, { action: "navigate", nowMs: 1_002, origin: "https://wikipedia.org" }),
    /outside the approved task origins/u,
  );
  assert.throws(
    () => authorizeComputerTaskMutation(task, grant, { action: "navigate", nowMs: 1_002, origin: "http://www.mozilla.org", validatedPublicOrigin: true }),
    /outside the approved task origins/u,
  );
  assert.throws(
    () => authorizeComputerTaskMutation(task, grant, { action: "navigate", nowMs: 1_002, origin: "https://127.0.0.1", validatedPublicOrigin: true }),
    /outside the approved task origins/u,
  );
});

test("HTTP browser follow-ups remain exact-origin scoped", () => {
  const task = compileComputerTask({
    taskId: "task-local-http-follow-up",
    goal: "Read the current page.",
    surface: "browser",
    browserAgentMode: true,
    allowedOrigins: [],
    currentBrowserOrigin: "http://127.0.0.1:4173/fixture",
    maxActions: 2,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });
  const grant: ComputerTaskGrantState = { approved: true, actionCount: 0, taskHashes: [task.grantHash] };

  assert.equal(task.browserOriginPolicy, "exact-origin");
  assert.throws(
    () => authorizeComputerTaskMutation(task, grant, { action: "navigate", nowMs: 1_001, origin: "https://example.com", validatedPublicOrigin: true }),
    /outside the approved task origins/u,
  );
});

test("browser task origins and grants do not leak into the next compilation", () => {
  const baseOrigins = ["https://example.com"];
  const input = { surface: "browser" as const, allowedOrigins: baseOrigins, maxActions: 2, nowMs: 1_000, deadlineMs: 30_000 };
  const first = compileComputerTask({ ...input, taskId: "task-first-site", goal: "Open https://www.mozilla.org/docs and tell me the heading." });
  const second = compileComputerTask({ ...input, taskId: "task-second-site", goal: "Open https://www.wikipedia.org/wiki/Main_Page and tell me the heading." });
  const grant: ComputerTaskGrantState = { approved: true, actionCount: 0, taskHashes: [first.grantHash] };

  assert.deepEqual(baseOrigins, ["https://example.com"]);
  assert.deepEqual(first.allowedOrigins, ["https://www.mozilla.org"]);
  assert.deepEqual(second.allowedOrigins, ["https://www.wikipedia.org"]);
  assert.notEqual(first.grantHash, second.grantHash);
  authorizeComputerTaskMutation(first, grant, { action: "navigate", nowMs: 1_001, origin: "https://www.mozilla.org" });
  assert.throws(() => authorizeComputerTaskMutation(first, grant, { action: "navigate", nowMs: 1_001, origin: "https://www.wikipedia.org" }), /outside the approved task origins/u);
  assert.throws(() => authorizeComputerTaskMutation(second, grant, { action: "navigate", nowMs: 1_001, origin: "https://www.wikipedia.org" }), /not bound to this compiled task/u);
});

test("existing browser-profile intent is explicit, opt-in, and carried into the task grant", () => {
  assert.throws(
    () => compileComputerTask({
      taskId: "task-existing-profile-disabled",
      goal: "Use my already-open browser to open example.com.",
      surface: "browser",
      allowedOrigins: ["https://example.com"],
      maxActions: 2,
      nowMs: 1_000,
      deadlineMs: 30_000,
    }),
    (error: unknown) => error instanceof ComputerTaskCompileError
      && error.code === "unsupported-intent"
      && /existing browser-profile attachment is disabled/iu.test(error.message),
  );

  const task = compileComputerTask({
    taskId: "task-existing-profile-enabled",
    goal: "Use my already-open browser to open example.com.",
    surface: "browser",
    allowedOrigins: ["https://example.com"],
    existingProfileEnabled: true,
    maxActions: 2,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });
  assert.equal(task.profile.mode, "existing_profile");
  assert.equal(task.nativeFallbackRoutes, undefined);
  assert.equal(task.completion.kind, "url-reached");
});

test("a reference to Anesu's current browser stays on its managed isolated profile", () => {
  const task = compileComputerTask({
    taskId: "task-current-managed-browser",
    goal: "From the current browser page, tell me its title.",
    surface: "browser",
    browserAgentMode: true,
    allowedOrigins: [],
    currentBrowserOrigin: "https://peps.python.org",
    maxActions: 2,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });

  assert.equal(task.profile.mode, "isolated_new");
  assert.deepEqual(task.allowedOrigins, ["https://peps.python.org"]);
});

test("compiled task value evidence is bounded and never persists source-backed content", () => {
  const task = compileComputerTask({
    taskId: "task-value-evidence",
    goal: 'Open example.com and type "Anesu acceptance" in the message field, then reveal the safe result.',
    surface: "browser",
    allowedOrigins: ["https://example.com"],
    maxActions: 2,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });

  const evidence = computerTaskValueEvidence(task);
  assert.deepEqual(evidence.map(({ kind }) => kind), ["text", "url"]);
  assert.equal(evidence.every((entry) => /^[a-f0-9]{64}$/u.test(entry.digest)), true);
  assert.equal(evidence.every((entry) => !JSON.stringify(entry).includes("Anesu acceptance")), true);
  assert.equal(evidence.every((entry) => !JSON.stringify(entry).includes("example.com")), true);
  assert.deepEqual(evidence.map(({ sourceStart, sourceEnd }) => [sourceStart, sourceEnd]), [[26, 44], [5, 16]]);
});

test("browser upload tasks preserve the exact source-backed file and require fresh assignment proof", () => {
  const task = compileComputerTask({
    taskId: "task-upload-1",
    goal: 'Open anesu.test/files and upload "workspace/browser-acceptance.txt".',
    surface: "browser",
    allowedOrigins: ["http://anesu.test"],
    maxActions: 2,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });
  assert.deepEqual(task.values.file?.value, "workspace/browser-acceptance.txt");
  assert.equal(task.values.text, undefined);
  assert.equal(task.completion.kind, "browser-file-assigned");
  assert.equal(task.allowedActions.includes("upload"), true);
});

test("browser upload tasks admit an explicitly named workspace path without requiring quotes", () => {
  const task = compileComputerTask({
    taskId: "task-upload-unquoted-1",
    goal: "Open https://example.com/upload and upload workspace/browser-acceptance.txt without submitting the form.",
    surface: "browser",
    allowedOrigins: ["https://example.com"],
    browserAgentMode: true,
    maxActions: 2,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });

  assert.equal(task.values.file?.value, "workspace/browser-acceptance.txt");
  assert.equal(task.values.text, undefined);
  assert.equal(task.allowedActions.includes("upload"), true);
  assert.equal(task.completion.kind, "none");
});

test("a URL containing the word upload does not grant a file upload action", () => {
  const task = compileComputerTask({
    taskId: "task-url-upload-word-1",
    goal: "Open https://example.com/upload and tell me whether the article mentions workspace/browser-acceptance.txt.",
    surface: "browser",
    allowedOrigins: ["https://example.com"],
    browserAgentMode: true,
    maxActions: 2,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });

  assert.equal(task.values.file, undefined);
  assert.equal(task.allowedActions.includes("upload"), false);
});

test("browser submission tasks compile a fresh post-submit verifier", () => {
  const task = compileComputerTask({
    taskId: "task-submit-1",
    goal: 'Open anesu.test/contact, enter "Anesu browser acceptance" in the message field, and submit it.',
    surface: "browser",
    allowedOrigins: ["http://anesu.test"],
    maxActions: 3,
    nowMs: 1_000,
    deadlineMs: 30_000,
  });
  assert.equal(task.completion.kind, "browser-form-submitted");
  assert.equal(task.completion.expected, "Anesu browser acceptance");
  assert.deepEqual(task.allowedActions, ["prepare", "navigate", "click", "type"]);
});

test("public-page field entry is not treated as a form submission when submission is prohibited", () => {
  for (const [index, prohibition] of ["Do not submit", "Don't submit", "Don’t submit"].entries()) {
    const task = compileComputerTask({
      taskId: `task-public-field-entry-${index}`,
      goal: `Open https://www.wikipedia.org, enter "Anesu browser check" in the search box, and tell me the current field value. ${prohibition}.`,
      surface: "browser",
      allowedOrigins: [],
      maxActions: 2,
      nowMs: 1_000,
      deadlineMs: 30_000,
    });

    assert.deepEqual(task.allowedOrigins, ["https://www.wikipedia.org"]);
    assert.deepEqual(task.allowedActions, ["prepare", "navigate", "type"]);
    assert.equal(task.values.text?.value, "Anesu browser check");
    assert.deepEqual(task.completion, { kind: "browser-input-value", expected: "Anesu browser check" });
  }
});

test("native task compilation binds a code-owned application and uses its verifier when available", () => {
  const task = compileComputerTask({
    taskId: "task-native-1",
    goal: 'Open Notes and enter "Meeting notes", then reveal the safe result.',
    surface: "native",
    application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
    allowedOrigins: [],
    maxActions: 2,
    nowMs: 10_000,
    deadlineMs: 20_000,
  });

  assert.deepEqual(task.application, { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" });
  assert.deepEqual(task.allowedActions, ["launch", "click", "type"]);
  assert.deepEqual(task.nativeFallbackRoutes, ["structured", "focused-key-text"]);
  assert.equal(task.completion.kind, "text-present");
});

test("Calculator tasks compile a bounded result verifier instead of an unproven interaction grant", () => {
  const task = compileComputerTask({
    taskId: "task-calculator-unverified",
    goal: "Calculate 2 + 2 in Calculator.",
    surface: "native",
    application: { name: "Calculator", launchPath: "/usr/bin/gnome-calculator" },
    allowedOrigins: [],
    maxActions: 4,
    nowMs: 10_000,
    deadlineMs: 20_000,
  });

  assert.equal(task.completion.kind, "native-calculator-result");
  assert.equal(task.completion.expected, "4");
  assert.deepEqual(task.completion.nativeFacts, { application: "Calculator", expression: "2 + 2", result: "4" });
  assert.deepEqual(task.allowedActions, ["launch", "click", "type"]);
});

test("native task compilation preserves code-owned Calculator launch arguments", () => {
  const task = compileComputerTask({
    taskId: "task-calculator-launch-route",
    goal: "Calculate 2 + 2 in Calculator.",
    surface: "native",
    application: { name: "Calculator", launchPath: "/usr/bin/gnome-calculator", launchArguments: ["--equation", "2 + 2"] },
    allowedOrigins: [],
    maxActions: 1,
    nowMs: 10_000,
    deadlineMs: 20_000,
  });

  assert.deepEqual(task.application?.launchArguments, ["--equation", "2 + 2"]);
  assert.deepEqual(resolveNativeApplication("Calculate 2 + 2 in Calculator."), {
    name: "Calculator",
    launchPath: "/usr/bin/gnome-calculator",
    launchArguments: ["--equation", "2 + 2"],
  });
});

test("native task compilation treats a quoted value in a new document request as typing", () => {
  const task = compileComputerTask({
    taskId: "task-native-document",
    goal: 'Open Notes and create a new document with "Meeting notes" in it.',
    surface: "native",
    application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
    allowedOrigins: [],
    maxActions: 2,
    nowMs: 10_000,
    deadlineMs: 20_000,
  });

  assert.deepEqual(task.allowedActions, ["launch", "click", "type"]);
  assert.equal(task.completion.kind, "native-text-editor-value");
  assert.equal(task.completion.expected, "Meeting notes");
});

test("native calendar compilation normalizes relative date and clock values in the configured timezone", () => {
  const task = compileComputerTask({
    taskId: "task-calendar-relative",
    goal: 'Open Calendar and create an event titled "Anesu acceptance" tomorrow at 10:00.',
    surface: "native",
    application: { name: "Calendar", launchPath: "/usr/bin/gnome-calendar" },
    allowedOrigins: [],
    maxActions: 4,
    nowMs: Date.parse("2026-09-21T10:00:00.000Z"),
    deadlineMs: 30_000,
    timeZone: "Africa/Johannesburg",
  });

  assert.equal(task.timeZone, "Africa/Johannesburg");
  assert.equal(task.values.date?.value, "2026-09-22");
  assert.equal(task.values.date?.source.text, "tomorrow");
  assert.equal(task.values.time?.value, "10:00");
  assert.equal(task.values.time?.source.text, "10:00");
  assert.deepEqual(task.completion.nativeFacts, {
    application: "Calendar",
    text: "Anesu acceptance",
    date: "2026-09-22",
    time: "10:00",
    timeZone: "Africa/Johannesburg",
  });
  assert.deepEqual(task.allowedActions, ["launch", "click", "type"]);
});

test("native alarm approval includes bounded click and type actions for its compiled time value", () => {
  const task = compileComputerTask({
    taskId: "task-clock-alarm",
    goal: "Set an alarm for 7:30 tomorrow in Clocks.",
    surface: "native",
    application: { name: "Clocks", launchPath: "/usr/bin/gnome-clocks" },
    allowedOrigins: [],
    maxActions: 3,
    nowMs: Date.parse("2026-09-23T10:00:00.000Z"),
    deadlineMs: 30_000,
    timeZone: "Africa/Johannesburg",
  });

  assert.equal(task.completion.kind, "native-clock-alarm");
  assert.equal(task.values.time?.value, "07:30");
  assert.deepEqual(task.allowedActions, ["launch", "click", "type"]);
});

test("native calendar compilation preserves a model-normalized single-quoted title", () => {
  const task = compileComputerTask({
    taskId: "calendar-single-quote",
    goal: "Open Calendar and create an event titled 'Anesu acceptance' tomorrow at 10:00.",
    surface: "native",
    application: { name: "Calendar", launchPath: "/usr/bin/gnome-calendar" },
    allowedOrigins: [],
    maxActions: 3,
    nowMs: Date.parse("2026-09-21T12:00:00Z"),
    deadlineMs: 120_000,
  });
  assert.equal(task.values.text?.value, "Anesu acceptance");
  assert.deepEqual(task.allowedActions, ["launch", "click", "type"]);
  assert.equal(task.completion.kind, "native-calendar-event");
  assert.equal(task.completion.nativeFacts?.date, "2026-09-22");
  assert.equal(task.completion.nativeFacts?.time, "10:00");
});

test("task compilation rejects malformed and non-HTTP URLs", () => {
  for (const goal of ["Open ftp://www.mozilla.org and tell me the heading.", "Open ftp://example.com and tell me the heading.", "Open https://www.mozilla.org:abc and tell me the heading.", "Open https://www.mozilla.org:99999 and tell me the heading."]) {
    assert.throws(
      () => compileComputerTask({
        taskId: "task-invalid-url",
        goal,
        surface: "browser",
        allowedOrigins: ["https://example.com"],
        maxActions: 1,
        nowMs: 0,
        deadlineMs: 1_000,
      }),
      (error: unknown) => error instanceof ComputerTaskCompileError && error.code === "origin-not-allowed",
      goal,
    );
  }
});

test("browser research may inspect download pages without requesting a download", () => {
  for (const conjunction of ["or", "and"]) {
    const task = compileComputerTask({
      taskId: "task-release-research",
      goal: `Compare the latest stable Python and Node.js releases using their official release ${conjunction} download pages. Give each version and release date if shown.`,
      surface: "browser",
      browserAgentMode: true,
      allowedOrigins: [],
      maxActions: 8,
      nowMs: 0,
      deadlineMs: 30_000,
    });
    assert.equal(task.completion.kind, "none");
    assert.ok(task.allowedActions.includes("navigate"));
  }
});

test("software names in research prompts do not become browser destinations", () => {
  const task = compileComputerTask({
    taskId: "task-release-comparison",
    goal: "Compare the latest stable Python and Node.js releases using their official pages.",
    surface: "browser",
    browserAgentMode: true,
    allowedOrigins: [],
    maxActions: 8,
    nowMs: 0,
    deadlineMs: 30_000,
  });
  assert.equal(task.values.url, undefined);
  assert.deepEqual(task.allowedOrigins, []);
  const explicit = compileComputerTask({
    taskId: "task-release-source",
    goal: "Compare Node.js releases at https://nodejs.org/en/download/.",
    surface: "browser",
    browserAgentMode: true,
    allowedOrigins: [],
    maxActions: 8,
    nowMs: 0,
    deadlineMs: 30_000,
  });
  assert.equal(explicit.values.url?.value, "https://nodejs.org/en/download/");
});

test("task compilation rejects missing application identity, unsupported downloads, and unverifiable goals", () => {
  assert.throws(
    () => compileComputerTask({
      taskId: "task-app",
      goal: "Open the notes app and type a note.",
      surface: "native",
      allowedOrigins: [],
      maxActions: 1,
      nowMs: 0,
      deadlineMs: 1_000,
    }),
    (error: unknown) => error instanceof ComputerTaskCompileError
      && error.code === "application-required"
      && /current Cua catalog/iu.test(error.message)
      && /arbitrary Files, Terminal, and VS Code launches are not admitted/iu.test(error.message),
  );
  assert.throws(
    () => compileComputerTask({
      taskId: "task-download",
      goal: "Open https://www.mozilla.org and download the report.",
      surface: "browser",
      allowedOrigins: ["https://example.com"],
      maxActions: 1,
      nowMs: 0,
      deadlineMs: 1_000,
    }),
    (error: unknown) => error instanceof ComputerTaskCompileError && error.code === "unsupported-intent",
  );
  const modelDirectedRead = compileComputerTask({
    taskId: "task-no-verifier",
    goal: "Open example.com and tell me what this page is about.",
    surface: "browser",
    browserAgentMode: true,
    allowedOrigins: ["https://example.com"],
    maxActions: 8,
    nowMs: 0,
    deadlineMs: 1_000,
  });
  assert.equal(modelDirectedRead.completion.kind, "none");
  assert.deepEqual(
    modelDirectedRead.allowedActions,
    ["prepare", "navigate", "click", "type", "select", "press", "scroll", "dialog"],
    "The model may choose select, but only a current Cua select ref and installed typed operation can execute it.",
  );
  assert.throws(
    () => compileComputerTask({
      taskId: "task-calendar-no-verifier",
      goal: 'Create a calendar event titled "Team sync".',
      surface: "native",
      application: { name: "Calendar", launchPath: "/usr/bin/gnome-calendar" },
      allowedOrigins: [],
      maxActions: 2,
      nowMs: 0,
      deadlineMs: 1_000,
    }),
    (error: unknown) => error instanceof ComputerTaskCompileError && error.code === "verifier-required",
  );
  assert.throws(
    () => compileComputerTask({
      taskId: "task-remote-submit",
      goal: 'Open https://www.mozilla.org/contact, enter "hello" and submit the form.',
      surface: "browser",
      allowedOrigins: ["https://example.com"],
      maxActions: 2,
      nowMs: 0,
      deadlineMs: 1_000,
    }),
    (error: unknown) => error instanceof ComputerTaskCompileError && error.code === "unsupported-intent",
  );
});

test("native task compilation does not reduce a follow-on click request to app-open verification", () => {
  assert.throws(
    () => compileComputerTask({
      taskId: "task-native-follow-on-click",
      goal: "Open Notes and click the New Document button. Do not type or save anything.",
      surface: "native",
      application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
      allowedOrigins: [],
      maxActions: 2,
      nowMs: 0,
      deadlineMs: 1_000,
    }),
    (error: unknown) => error instanceof ComputerTaskCompileError
      && error.code === "verifier-required"
      && /completion verifier/iu.test(error.message),
  );

  const openOnly = compileComputerTask({
    taskId: "task-native-open-only",
    goal: "Open Notes.",
    surface: "native",
    application: { name: "Notes", launchPath: "/usr/bin/gnome-text-editor" },
    allowedOrigins: [],
    maxActions: 1,
    nowMs: 0,
    deadlineMs: 1_000,
  });
  assert.equal(openOnly.completion.kind, "native-app-open");
});

test("task compilation refuses secret-looking quoted values", () => {
  assert.throws(
    () => compileComputerTask({
      taskId: "task-secret",
      goal: 'Open example.com and type "my password" in the field.',
      surface: "browser",
      allowedOrigins: ["https://example.com"],
      maxActions: 1,
      nowMs: 0,
      deadlineMs: 1_000,
    }),
    (error: unknown) => error instanceof ComputerTaskCompileError && error.code === "sensitive-value",
  );
});

test("computer routing compiles and passes one task grant context before a path starts", async () => {
  let receivedTask: string | undefined;
  const router = new ComputerRouter({
    preferredSurface: "browser",
    strategy: "typesafe",
    typeSafePreflight: async () => ({ requestedModel: "jev-test", resolvedModel: "jev-test" }),
    compileTask: ({ taskId, goal, surface }) => compileComputerTask({
      taskId,
      goal,
      surface,
      allowedOrigins: ["https://example.com"],
      maxActions: 1,
      nowMs: 0,
      deadlineMs: 30_000,
    }),
    browser: {
      availableStrategies: { typesafe: true, traditional: false },
      create: () => ({
        run: async (_callId, _goal, context) => {
          receivedTask = context.taskContext?.task.grantHash;
          assert.equal(context.taskContext?.grant.approved, false);
          return { ok: true, status: "completed", content: "ok", summary: "completed" };
        },
      }),
    },
  });
  const outcome = await router.run("task_router_1", "Open example.com and reveal the safe result.");
  assert.equal(outcome.ok, true);
  assert.match(receivedTask ?? "", /^[a-f0-9]{64}$/u);
});

test("task authorization fails closed before mutation and consumes only bounded input budget", () => {
  const task = compileComputerTask({
    taskId: "task-guard-1",
    goal: 'Open example.com and type "safe text", then reveal the safe result.',
    surface: "browser",
    allowedOrigins: ["https://example.com"],
    maxActions: 1,
    nowMs: 1_000,
    deadlineMs: 10_000,
  });
  const grant: ComputerTaskGrantState = { approved: false, actionCount: 0, taskHashes: [task.grantHash] };

  assert.throws(
    () => authorizeComputerTaskMutation(task, grant, { action: "prepare", nowMs: 1_001 }),
    /has not been approved/u,
  );

  grant.approved = true;
  authorizeComputerTaskMutation(task, grant, { action: "prepare", nowMs: 1_001 });
  authorizeComputerTaskMutation(task, grant, { action: "navigate", nowMs: 1_001, origin: "https://example.com" });
  authorizeComputerTaskMutation(task, grant, { action: "type", nowMs: 1_001, consumeAction: true });
  assert.equal(grant.actionCount, 1);

  assert.throws(
    () => authorizeComputerTaskMutation(task, grant, { action: "type", nowMs: 1_002, consumeAction: true }),
    /action limit/u,
  );
  assert.throws(
    () => authorizeComputerTaskMutation(task, grant, { action: "navigate", nowMs: 1_002, origin: "https://outside.example" }),
    /outside the approved task origins/u,
  );
  assert.throws(
    () => authorizeComputerTaskMutation(task, grant, { action: "click", nowMs: 11_001 }),
    /expired/u,
  );
});
