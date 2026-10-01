import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBrowserActionSpace,
  requestedBrowserQuery,
  requestedBrowserUploadPath,
} from "../src/computer/browser-strategy.js";
import { ComputerRunner, type ComputerBrowser, type ComputerContext } from "../src/computer/runner.js";
import { bindComputerTaskGrant, compileComputerTask } from "../src/computer/task.js";

const documentId = "semantic_snapshot_1";

function declaredSnapshot() {
  return {
    documentId,
    content: "[p1:1] button Drag source\n[p1:2] button Drop target\n[p1:3] input file Upload document",
    references: [
      {
        value: "p1:1",
        documentId,
        role: "button",
        name: "Drag source",
        actions: ["pointer"],
        destinationRef: "p1:2",
      },
      {
        value: "p1:2",
        documentId,
        role: "button",
        name: "Drop target",
        actions: [],
      },
      {
        value: "p1:3",
        documentId,
        role: "input",
        name: "Upload document",
        actions: ["upload"],
      },
    ],
  };
}

test("browser strategy creates only declared pointer and upload candidates", () => {
  const actions = buildBrowserActionSpace(declaredSnapshot());

  assert.deepEqual(
    actions.filter((action) => ["hover", "right_click", "double_click", "drag", "upload"].includes(action.operation)).map((action) => ({
      operation: action.operation,
      ref: action.ref,
      destinationRef: action.destinationRef,
    })),
    [
      { operation: "hover", ref: "p1:1", destinationRef: undefined },
      { operation: "right_click", ref: "p1:1", destinationRef: undefined },
      { operation: "double_click", ref: "p1:1", destinationRef: undefined },
      { operation: "drag", ref: "p1:1", destinationRef: "p1:2" },
      { operation: "upload", ref: "p1:3", destinationRef: undefined },
    ],
  );
});

test("browser strategy does not infer pointer or upload capability from a role", () => {
  const actions = buildBrowserActionSpace({
    documentId,
    content: "[p1:1] button Context menu\n[p1:2] input file Document",
    references: [
      { value: "p1:1", documentId, actions: ["click"] },
      { value: "p1:2", documentId, actions: ["click"] },
    ],
  });

  assert.equal(actions.some((action) => ["hover", "right_click", "double_click", "drag", "upload"].includes(action.operation)), false);
});

test("browser strategy preserves a declared upload when the accessibility outline omits the file type", () => {
  const actions = buildBrowserActionSpace({
    documentId,
    content: "[p1:1] input Acceptance file",
    references: [{ value: "p1:1", documentId, role: "input", name: "Acceptance file", actions: ["upload"] }],
  });

  assert.deepEqual(actions.map((action) => action.operation), ["upload"]);
});

test("browser strategy trusts a declared upload when Chromium projects a generic role", () => {
  const actions = buildBrowserActionSpace({
    documentId,
    content: "[p1:1] generic Acceptance file",
    references: [{ value: "p1:1", documentId, role: "generic", name: "Acceptance file", actions: ["upload"] }],
  });

  assert.deepEqual(actions.map((action) => ({ operation: action.operation, role: action.role })), [{ operation: "upload", role: "generic" }]);
});

test("browser strategy follows Cua's generic pointer capability declaration", () => {
  const actions = buildBrowserActionSpace({
    documentId,
    content: "[p1:1] button Context menu",
    references: [{ value: "p1:1", documentId, role: "button", name: "Context menu", actions: ["right_click"] }],
  });
  assert.equal(actions.some((action) => action.operation === "right_click"), false);
});

test("browser strategy refuses a drag declaration without a current destination ref", () => {
  const actions = buildBrowserActionSpace({
    documentId,
    content: "[p1:1] button Drag source",
    references: [{ value: "p1:1", documentId, role: "button", name: "Drag source", actions: ["drag"] }],
  });

  const drag = actions.find((action) => action.operation === "drag");
  assert.equal(drag, undefined);
});

test("browser upload path comes only from an explicit user value", () => {
  assert.equal(requestedBrowserUploadPath('Upload the file "workspace/report.txt" into the visible field.'), "workspace/report.txt");
  assert.equal(requestedBrowserUploadPath("Upload the file shown by the page."), undefined);
});

test("browser semantic queries find the user-named control without sending quoted input text", () => {
  assert.equal(
    requestedBrowserQuery('Open https://www.wikipedia.org, type "Lina browser check" in the search field, and show me the text in the field.'),
    "search",
  );
  assert.equal(requestedBrowserQuery('Search Wikipedia for "Lina browser check".'), "search");
  assert.equal(requestedBrowserQuery('Click the "Continue" button.'), "Continue");
  assert.equal(requestedBrowserQuery("Open https://example.org and read the page heading."), undefined);
});

test("browser strategy maps a Cua searchbox to a declared text-entry candidate", () => {
  const actions = buildBrowserActionSpace({
    documentId,
    content: "",
    references: [{
      value: "p1:search",
      documentId,
      role: "searchbox",
      type: "search",
      name: "Search Wikipedia",
      actions: ["type"],
    }],
  });

  assert.deepEqual(actions.map(({ operation, role, label }) => ({ operation, role, label })), [
    { operation: "type", role: "input", label: "Search Wikipedia" },
  ]);
});

test("browser strategy does not map a Cua searchbox without a declared type action", () => {
  const actions = buildBrowserActionSpace({
    documentId,
    content: "",
    references: [{ value: "p1:search", documentId, role: "searchbox", name: "Search Wikipedia", actions: ["click"] }],
  });

  assert.deepEqual(actions, []);
});

test("browser strategy offers a native select only when the current Cua ref declares selection", () => {
  const actions = buildBrowserActionSpace({
    documentId,
    content: "[p1:select] combobox Company type\n[p1:custom] combobox Category",
    references: [
      { value: "p1:select", documentId, role: "combobox", name: "Company type", actions: ["click", "select"] },
      { value: "p1:custom", documentId, role: "combobox", name: "Category", actions: ["click"] },
    ],
  });

  assert.deepEqual(actions.map(({ operation, ref }) => ({ operation, ref })), [
    { operation: "select", ref: "p1:select" },
  ]);
});

class PointerAndUploadBrowser implements ComputerBrowser {
  readonly calls: Array<{ readonly name: string; readonly args: Readonly<Record<string, unknown>> }> = [];
  constructor(readonly selectedAction: string) {}

  async execute(name: string, _callId: string, args: Readonly<Record<string, unknown>>, _context: ComputerContext) {
    this.calls.push({ name, args });
    if (name === "browser_snapshot") {
      return {
        ok: true,
        content: JSON.stringify({
          tabId: "tab_fixture",
          documentId,
          title: "Pointer fixture",
          url: "http://127.0.0.1:43127/",
          content: declaredSnapshot().content,
          references: declaredSnapshot().references,
        }),
        summary: "snapshot",
      };
    }
    if (name === "browser_open") {
      return { ok: true, content: JSON.stringify({ url: String(args.url) }), summary: "opened" };
    }
    return { ok: true, content: "{}", summary: name };
  }
}

async function runSelectedAction(selectedAction: string, goal: string): Promise<PointerAndUploadBrowser> {
  const browser = new PointerAndUploadBrowser(selectedAction);
  const operation = selectedAction.split(":", 1)[0];
  const choiceId = {
    hover: "candidate_1",
    right_click: "candidate_2",
    double_click: "candidate_3",
    drag: "candidate_4",
    upload: "candidate_1",
  }[operation] ?? "candidate_1";
  const runner = new ComputerRunner({
    browser,
    strategy: "typesafe",
    typeSafeApiKey: "typesafe-test-secret",
    typeSafeModel: "jev-test",
    maxActions: 1,
    maxOutputBytes: 32_000,
    fetchImpl: async () => new Response(JSON.stringify({
      model: "jev-test",
      answers: { target: { type: "choice", choice: choiceId, confidence: 0.99, probabilities: { [choiceId]: 0.99 } } },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  await runner.run("browser_strategy_test", goal, { approveBrowser: async () => ({ decision: "allow-once" }) });
  return browser;
}

test("computer runner dispatches declared pointer actions with only current refs", async () => {
  for (const [operation, expectedArgs] of [
    ["hover", { ref: "p1:1", action: "hover" }],
    ["right_click", { ref: "p1:1", action: "right_click" }],
    ["double_click", { ref: "p1:1", action: "double_click" }],
    ["drag", { ref: "p1:1", action: "drag", destinationRef: "p1:2" }],
  ] as const) {
    const browser = await runSelectedAction(`${operation}:p1:1:${documentId}`, `Perform a ${operation.replaceAll("_", " ")} on the declared control.`);
    const call = browser.calls.find((candidate) => candidate.name === "browser_pointer");
    assert.deepEqual(call?.args, expectedArgs);
  }
});

test("computer runner dispatches a declared upload with the user-provided path", async () => {
  const browser = await runSelectedAction(`upload:p1:3:${documentId}`, 'Upload the file "workspace/report.txt" into the declared field.');
  const call = browser.calls.find((candidate) => candidate.name === "browser_upload");
  assert.deepEqual(call?.args, { ref: "p1:3", path: "workspace/report.txt" });
});

class QueriedSearchInputBrowser implements ComputerBrowser {
  readonly snapshotQueries: Array<string | undefined> = [];
  readonly typedValues: string[] = [];
  readonly typedRefs: string[] = [];
  private snapshotNumber = 0;
  private latestRef: string | undefined;

  constructor(readonly emptyTargetQuery = false) {}

  async execute(name: string, _callId: string, args: Readonly<Record<string, unknown>>, _context: ComputerContext) {
    if (name === "browser_start" || name === "browser_close") return { ok: true, content: "{}", summary: name };
    if (name === "browser_open") return { ok: true, content: JSON.stringify({ url: String(args.url ?? "") }), summary: "opened" };
    if (name === "browser_snapshot") {
      this.snapshotQueries.push(typeof args.query === "string" ? args.query : undefined);
      this.snapshotNumber += 1;
      const currentDocumentId = `search_doc_${this.snapshotNumber}`;
      const ref = `@e${this.snapshotNumber}`;
      this.latestRef = ref;
      const queryMiss = this.emptyTargetQuery && this.snapshotNumber === 2 && args.query !== undefined;
      const exposesSearch = args.query === undefined || !queryMiss;
      const content = args.query === undefined
        ? `[${ref}] searchbox Search Wikipedia${this.typedValues.at(-1) ? ` value ${this.typedValues.at(-1)}` : ""}\n[@e0] button English`
        : exposesSearch
          ? `[${ref}] searchbox Search Wikipedia${this.typedValues.at(-1) ? ` value ${this.typedValues.at(-1)}` : ""}`
          : "";
      const references = args.query === undefined
        ? [
          { value: ref, documentId: currentDocumentId, role: "searchbox", type: "search", name: "Search Wikipedia", actions: ["type"], currentValue: this.typedValues.at(-1) ?? "" },
          { value: "@e0", documentId: currentDocumentId, role: "button", name: "English", actions: ["click"] },
        ]
        : exposesSearch
          ? [{ value: ref, documentId: currentDocumentId, role: "searchbox", type: "search", name: "Search Wikipedia", actions: ["type"], currentValue: this.typedValues.at(-1) ?? "" }]
          : [];
      return {
        ok: true,
        content: JSON.stringify({
          tabId: "tab_search_fixture",
          documentId: currentDocumentId,
          title: "Wikipedia",
          url: "https://www.wikipedia.org/",
          content,
          references,
        }),
        summary: "snapshot",
      };
    }
    if (name === "browser_type") {
      if (args.ref !== this.latestRef) {
        return { ok: false, content: "stale reference", summary: "The Cua reference was invalidated by a newer snapshot.", errorCode: "stale-reference" };
      }
      this.typedRefs.push(String(args.ref));
      this.typedValues.push(String(args.text ?? ""));
      return { ok: true, content: JSON.stringify({ effect: "confirmed" }), summary: "typed" };
    }
    return { ok: true, content: "{}", summary: name };
  }
}

test("computer runner uses a bounded Cua query to find and freshly verify a named search field", async () => {
  for (const emptyTargetQuery of [false, true]) {
    const browser = new QueriedSearchInputBrowser(emptyTargetQuery);
    const goal = 'Open https://www.wikipedia.org, type "Lina browser check" in the search field, and show me the text in the field.';
    const task = compileComputerTask({
      taskId: `browser_query_${emptyTargetQuery ? "miss" : "match"}`,
      goal,
      surface: "browser",
      allowedOrigins: [],
      maxActions: 3,
      nowMs: Date.now(),
      deadlineMs: 120_000,
    });
    assert.deepEqual(task.allowedActions, ["prepare", "navigate", "type"]);
    const grant = { approved: false, actionCount: 0 };
    bindComputerTaskGrant(task, grant);
    let candidateSummaries: Array<Record<string, unknown>> | undefined;
    const runner = new ComputerRunner({
      browser,
      strategy: "typesafe",
      typeSafeApiKey: "typesafe-test-secret",
      typeSafeModel: "jev-test",
      maxActions: 1,
      maxOutputBytes: 32_000,
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { readonly state?: { readonly structuredElementSummaries?: Array<Record<string, unknown>> } };
        candidateSummaries = request.state?.structuredElementSummaries;
        const choice = "candidate_1";
        return new Response(JSON.stringify({
          model: "jev-test",
          answers: { target: { type: "choice", choice, confidence: 0.99, probabilities: { [choice]: 0.99 } } },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const result = await runner.run(
      "browser_query_test",
      goal,
      {
        taskContext: { task, grant },
        approveComputerTask: async (request) => ({ decision: "allow-task", grantHash: request.grantHash }),
        approveBrowser: async () => ({ decision: "allow-once" }),
      },
    );

    assert.equal(browser.snapshotQueries[0], undefined);
    assert.equal(browser.snapshotQueries[1], "search", `queries=${JSON.stringify(browser.snapshotQueries)} result=${JSON.stringify(result)}`);
    assert.deepEqual(candidateSummaries?.map(({ operation, label }) => ({ operation, label })), [{ operation: "type", label: "Search Wikipedia" }]);
    assert.deepEqual(browser.typedValues, ["Lina browser check"]);
    assert.deepEqual(browser.typedRefs, [emptyTargetQuery ? "@e3" : "@e2"]);
    assert.equal(browser.snapshotQueries.at(-1), undefined);
    assert.equal(result.status, "completed");
    assert.deepEqual(browser.snapshotQueries, emptyTargetQuery
      ? [undefined, "search", undefined, undefined]
      : [undefined, "search", undefined]);
  }
});
