import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const WEB_URL = process.env.AGENTLAB_WEB_URL ?? "http://127.0.0.1:5173";
const CHROME_BIN = process.env.AGENTLAB_CHROME_BIN ?? "google-chrome";

test("Platform Chat completes a turn, exposes safe evidence, and preserves platform state", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/temporal/chat");
    await waitForElement(browser.cdp, ".chat-page");
    await waitForText(browser.cdp, "Temporal");
    assert.deepEqual(await browser.cdp.evaluate(`JSON.stringify({
      platform: document.querySelector(".chat-heading .eyebrow")?.textContent?.trim(),
      setupHref: document.querySelector('a[href="/platforms/temporal"]')?.getAttribute("href"),
      controlledRunVisible: Boolean(document.querySelector('textarea[aria-label="Task prompt"]')),
    })`).then(JSON.parse), {
      platform: "Temporal",
      setupHref: "/platforms/temporal",
      controlledRunVisible: false,
    });

    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Calculate 40 + 2.");

    await clickButton(browser.cdp, "Send");
    await click(browser.cdp, 'button[type="submit"]');
    await waitForText(browser.cdp, "The calculator result is 42.");

    const completed = await browser.cdp.evaluate(`JSON.stringify({
      userMessages: document.querySelectorAll(".chat-message-user").length,
      assistantMessages: document.querySelectorAll(".chat-message-assistant").length,
      toolActivity: document.querySelector(".chat-tool-activity")?.textContent?.trim() ?? null,
      context: document.querySelector('[aria-label="Context window"]')?.textContent?.replace(/\\s+/g, " ").trim() ?? null,
      modelDisabled: document.querySelector(".model-picker-trigger")?.hasAttribute("disabled") ?? false,
      noDuplicateVisibleIds: (() => {
        const ids = [...document.querySelectorAll(".chat-message")].map((node) => node.getAttribute("aria-label"));
        return new Set(ids).size === ids.length;
      })(),
    })`).then(JSON.parse);
    assert.equal(fixture.state.createRequests, 1, "a second send must not create another run");
    assert.ok(fixture.state.capabilityRequests >= 1, "Chat must load the server-owned capability profiles");
    assert.match(fixture.state.requests[0]?.sessionId ?? "", /^session-/);
    assert.match(fixture.state.clientTurnIds[0] ?? "", /^chat-turn-[A-Za-z0-9-]+$/);
    assert.equal(completed.userMessages, 1);
    assert.equal(completed.assistantMessages, 1);
    assert.match(completed.toolActivity, /calculator.*Completed/i);
    assert.match(completed.context, /8% used/);
    assert.equal(completed.modelDisabled, true);
    assert.equal(completed.noDuplicateVisibleIds, true);

    await clickSummary(browser.cdp, "Run details");
    await clickSummary(browser.cdp, "Evidence");
    const evidence = await browser.cdp.evaluate(`JSON.stringify([...document.querySelectorAll(".chat-evidence a")].map((link) => ({
      name: link.textContent?.trim(),
      href: link.getAttribute("href"),
      target: link.getAttribute("target"),
    })))` ).then(JSON.parse);
    assert.deepEqual(evidence.map((item) => item.name), ["config.json", "capabilities.json", "events.jsonl", "logs/operations.jsonl", "context.json", "trajectory.json", "metrics.json", "result.json"]);
    assert.ok(evidence.every((item) => item.href?.startsWith(`http://127.0.0.1:4318/api/runs/${fixture.state.runIds[0]}/evidence/`)));
    assert.ok(evidence.every((item) => item.target === "_blank"));

    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Keep this session going.");
    await clickButton(browser.cdp, "Send");
    await waitForExpression(browser.cdp, 'document.querySelectorAll(".chat-message-user").length === 2 && document.querySelectorAll(".chat-message-assistant").length === 2');
    assert.equal(fixture.state.requests[1]?.sessionId, fixture.state.requests[0]?.sessionId, "Temporal follow-up must address the existing session");
    assert.notEqual(fixture.state.clientTurnIds[0], fixture.state.clientTurnIds[1], "each submitted turn must have a distinct idempotency key");
    assert.ok(fixture.state.clientTurnIds.every((id) => /^chat-turn-[A-Za-z0-9-]+$/.test(id)));
    assert.equal(await browser.cdp.evaluate('document.querySelector(".model-picker-trigger")?.hasAttribute("disabled")'), true);

    await clickButton(browser.cdp, "New chat");
    await waitForText(browser.cdp, "Start a conversation");
    assert.equal(await browser.cdp.evaluate("location.search"), "");
    assert.equal(await browser.cdp.evaluate("document.querySelector('.model-picker-trigger')?.hasAttribute('disabled')"), false);

    await browser.cdp.evaluate('document.querySelector("a[href=\\"/platforms/temporal\\"]")?.click()');
    await waitForElement(browser.cdp, 'textarea[aria-label="Task prompt"]');
    assert.equal(await browser.cdp.evaluate("document.querySelector('.runner-heading h1')?.textContent?.trim()"), "Run an agent");
    assert.equal(await browser.cdp.evaluate("document.querySelector('.chat-page') === null"), true);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
    assert.equal(browser.dialogs.length, 0, "Chat must not open native browser dialogs");
  } finally {
    await browser.close();
  }
});

test("Platform Chat displays and submits the selected capability profile", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/temporal/chat");
    await waitForText(browser.cdp, "Temporal");
    await chooseModel(browser.cdp);
    await waitForExpression(browser.cdp, 'document.querySelectorAll(\'select[aria-label="Capability profile"] option\').length === 3');

    const profileOptions = await browser.cdp.evaluate(`JSON.stringify({
      selected: document.querySelector('select[aria-label="Capability profile"]')?.selectedOptions[0]?.textContent?.trim(),
      options: Array.from(document.querySelectorAll('select[aria-label="Capability profile"] option')).map((option) => ({ value: option.value, text: option.textContent?.trim() })),
    })`).then(JSON.parse);
    assert.equal(profileOptions.selected, "Local safe · 1 skill");
    assert.deepEqual(profileOptions.options, [
      { value: "local-safe", text: "Local safe · 1 skill" },
      { value: "local-mcp-safe", text: "Local MCP safe" },
      { value: "local-write-approved", text: "Local write test · 1 skill" },
    ]);

    assert.deepEqual(await browser.cdp.evaluate(`JSON.stringify({
      capabilities: document.querySelector('.capability-picker-summary span')?.textContent?.trim(),
      skills: document.querySelector('.capability-picker-summary small')?.textContent?.trim(),
    })`).then(JSON.parse), {
      capabilities: "Calculator, Local read fixture",
      skills: "Research summary",
    });

    await chooseCapabilityProfile(browser.cdp, "local-safe");
    assert.deepEqual(await browser.cdp.evaluate(`JSON.stringify({
      value: document.querySelector('select[aria-label="Capability profile"]')?.value,
      label: document.querySelector('select[aria-label="Capability profile"]')?.selectedOptions[0]?.textContent?.trim(),
    })`).then(JSON.parse), {
      value: "local-safe",
      label: "Local safe · 1 skill",
    });

    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Use the selected capability profile.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "The calculator result is 42.");
    assert.equal(fixture.state.requests[0]?.capabilities?.profileId, "local-safe");
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Platform Chat exposes the native MCP connection details", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/temporal/chat");
    await waitForText(browser.cdp, "Temporal");
    await chooseModel(browser.cdp);
    await waitForExpression(browser.cdp, 'document.querySelectorAll(\'select[aria-label="Capability profile"] option\').length === 3');
    await chooseCapabilityProfile(browser.cdp, "local-mcp-safe");
    assert.deepEqual(await browser.cdp.evaluate(`JSON.stringify({
      value: document.querySelector('select[aria-label="Capability profile"]')?.value,
      capabilities: document.querySelector('.capability-picker-summary span')?.textContent?.trim(),
    })`).then(JSON.parse), {
      value: "local-mcp-safe",
      capabilities: "Calculator, Local MCP read fixture",
    });

    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Read alpha through MCP.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "MCP fixture returned alpha.");
    assert.equal(fixture.state.requests[0]?.capabilities?.profileId, "local-mcp-safe");

    await clickSummary(browser.cdp, "Run details");
    await clickSummary(browser.cdp, "MCP connection");
    const details = await browser.cdp.evaluate(`document.querySelector('.chat-activity[open]')?.textContent?.replace(/\\s+/g, " ").trim() ?? ""`);
    assert.match(details, /MCP connectioninvocation/);
    assert.match(details, /agentlab-local-mcp/);
    assert.match(details, /fixture\.lookup/);
    assert.match(details, /2025-06-18/);
    assert.match(await browser.cdp.evaluate(`document.querySelector('.chat-tool-activity')?.textContent?.trim() ?? ""`), /fixture\.lookup.*Completed/);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Platform Chat uses an application approval dialog for a write-capable profile", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/temporal/chat");
    await waitForText(browser.cdp, "Temporal");
    await chooseModel(browser.cdp);
    await waitForExpression(browser.cdp, 'document.querySelectorAll(\'select[aria-label="Capability profile"] option\').length === 3');
    await chooseCapabilityProfile(browser.cdp, "local-write-approved");
    await waitForText(browser.cdp, "Allow write access?");
    await waitForText(browser.cdp, "Approval write fixture");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".capability-approval-dialog")?.getAttribute("role")'), "dialog");

    await clickButton(browser.cdp, "Approve");
    await waitForExpression(browser.cdp, 'document.querySelector(\'select[aria-label="Capability profile"]\')?.value === "local-write-approved"');
    assert.equal(await browser.cdp.evaluate('document.querySelector(".capability-approval-dialog") === null'), true);

    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Run with approved write capability.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "The calculator result is 42.");
    const approval = fixture.state.requests[0]?.capabilities?.approvals?.[0];
    assert.equal(fixture.state.requests[0]?.capabilities?.profileId, "local-write-approved");
    assert.equal(approval?.capabilityId, "fixture_write");
    assert.equal(approval?.decision, "approved");
    assert.match(approval?.decisionId ?? "", /^approval_/);
    assert.equal(browser.dialogs.length, 0, "capability approval must use application UI, not a browser dialog");
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Platform Chat reports unavailable, API failure, and cancellation states", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/restate/chat");
    await waitForText(browser.cdp, "Restate");
    await waitForText(browser.cdp, "Restate runtime is unavailable.");
    assert.equal(await browser.cdp.evaluate('document.querySelector(\'textarea[aria-label="Message"]\')?.hasAttribute("disabled")'), true);
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-unavailable")?.textContent?.trim()'), "Unavailable");

    await navigate(browser.cdp, "/platforms/temporal/chat");
    fixture.setMode("api-error");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "This request should fail.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "The fixture rejected this run.");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-message-status-failed")?.textContent?.includes("The fixture rejected this run.")'), true);
    assert.equal(fixture.state.createRequests, 1);
    assert.equal(fixture.state.runReads, 0, "a rejected create request must not start polling");

    fixture.setMode("api-error-once");
    await clickButton(browser.cdp, "New chat");
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Retry this request safely.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "The fixture rejected this run.");
    await browser.cdp.send("Page.reload", { ignoreCache: true });
    await waitForElement(browser.cdp, ".chat-page");
    await waitForText(browser.cdp, "Previous request was interrupted. Retry to continue.");
    assert.equal(fixture.state.createRequests, 2, "refresh must not resubmit the pending turn");
    await clickButton(browser.cdp, "Retry");
    await waitForText(browser.cdp, "The calculator result is 42.");
    assert.equal(fixture.state.createRequests, 3);
    assert.equal(fixture.state.clientTurnIds.at(-1), fixture.state.clientTurnIds.at(-2), "a retry must reuse the same client turn key");

    await clickButton(browser.cdp, "New chat");
    fixture.setMode("cancel");
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Cancel this request.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Stop");
    await clickButton(browser.cdp, "Stop");
    await waitForText(browser.cdp, "Cancelled");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-message-status-cancelled")?.textContent?.includes("Cancelled")'), true);
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-composer textarea")?.hasAttribute("disabled")'), false);
    assert.equal(fixture.state.createRequests, 4);
    assert.equal(new Set(fixture.state.clientTurnIds).size, 3, "New chat must produce a fresh turn id when the next message is submitted");
    assert.ok(fixture.state.clientTurnIds.every((id) => /^chat-turn-[A-Za-z0-9-]+$/.test(id)));
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
    assert.equal(browser.dialogs.length, 0, "Chat must not open native browser dialogs");
  } finally {
    await browser.close();
  }
});

test("Mastra Chat shows native agent evidence and safe Mastra evidence", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/mastra/chat");
    await waitForText(browser.cdp, "Mastra");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Inspect the Mastra runtime.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Mastra fixture completed.");

    await clickSummary(browser.cdp, "Run details");
    await clickSummary(browser.cdp, "Native execution");
    const native = await browser.cdp.evaluate(`document.querySelector('.chat-activity[open]')?.textContent?.replace(/\\s+/g, " ").trim() ?? ""`);
    assert.match(native, /Native executionMastra/);
    assert.match(native, /agent\.generate/);
    assert.match(native, /completed/);
    assert.match(native, /prepared/);

    await clickSummary(browser.cdp, "Evidence");
    assert.equal(await browser.cdp.evaluate(`Array.from(document.querySelectorAll(".chat-evidence a")).some((link) => link.textContent?.trim() === "native/mastra.json")`), true);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Mastra Chat selects the workflow variant and shows native workflow details", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/mastra/chat");
    await waitForText(browser.cdp, "Mastra");
    await clickSummary(browser.cdp, "Run options");
    await chooseVariant(browser.cdp, "workflow");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Inspect the Mastra workflow runtime.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Mastra fixture completed.");

    assert.equal(fixture.state.requests[0]?.variant, "workflow");
    await clickSummary(browser.cdp, "Run details");
    await clickSummary(browser.cdp, "Native execution");
    const native = await browser.cdp.evaluate(`document.querySelector('.chat-activity[open]')?.textContent?.replace(/\\s+/g, " ").trim() ?? ""`);
    assert.match(native, /Native executionMastra/);
    assert.match(native, /Workflowagent/);
    assert.match(native, /completed/);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Mastra workflow Chat resumes an approval without creating a second run", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/mastra/chat");
    await waitForText(browser.cdp, "Mastra");
    await clickSummary(browser.cdp, "Run options");
    await chooseVariant(browser.cdp, "workflow");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "[approval] Publish the prepared post.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Waiting for approval");
    const suspendedRunId = await browser.cdp.evaluate('document.querySelector(".chat-run-meta dd")?.textContent?.trim()');
    assert.ok(suspendedRunId);
    assert.equal(fixture.state.createRequests, 1);

    await clickButton(browser.cdp, "Approve and resume");
    await waitForText(browser.cdp, "Mastra fixture completed.");
    const resumedRunId = await browser.cdp.evaluate('document.querySelector(".chat-run-meta dd")?.textContent?.trim()');
    assert.equal(resumedRunId, suspendedRunId);
    assert.equal(fixture.state.createRequests, 1, "resume must address the existing run");
    assert.equal(fixture.state.resumeRequests, 1);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
    assert.equal(browser.dialogs.length, 0, "approval must use application UI, not a browser dialog");
  } finally {
    await browser.close();
  }
});

test("Compare starts independent platform runs with one comparison identity", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/temporal");
    await waitForText(browser.cdp, "Temporal");
    await chooseModel(browser.cdp);
    await clickButton(browser.cdp, "Compare");
    await waitForText(browser.cdp, "One task, multiple platforms");
    await toggleComparisonPlatform(browser.cdp, "Mastra");
    await waitForExpression(browser.cdp, 'Array.from(document.querySelectorAll(".comparison-platform-picker input")).filter((input) => input.checked).length === 2');
    await setInput(browser.cdp, '.compare-task-field textarea', "Compare the same task.");
    await browser.cdp.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("Run comparison"));
      if (!button) throw new Error("Comparison submit button not found.");
      button.click();
      button.click();
    })()`);
    await waitForExpression(browser.cdp, 'document.querySelectorAll(".comparison-result-completed").length === 2');
    assert.equal(await browser.cdp.evaluate('document.querySelectorAll(".comparison-result-output").length'), 2);

    assert.equal(fixture.state.requests.length, 2);
    assert.equal(new Set(fixture.state.requests.map((request) => request.comparisonId)).size, 1);
    assert.equal(new Set(fixture.state.requests.map((request) => request.sessionId)).size, 2);
    assert.equal(new Set(fixture.state.requests.map((request) => request.clientTurnId)).size, 2);
    assert.match(fixture.state.requests[0]?.comparisonId ?? "", /^comparison-[A-Za-z0-9-]+$/);
    assert.notEqual(fixture.state.runIds[0], fixture.state.runIds[1]);
    const runLinks = await browser.cdp.evaluate('Array.from(document.querySelectorAll(".comparison-result-link")).map((link) => link.getAttribute("href"))');
    assert.equal(runLinks.length, 2);
    assert.equal(runLinks.every((href) => href?.match(/^\/platforms\/(?:temporal|mastra)\/chat\?run=run-/)), true);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Compare displays one capability profile and sends it to each platform run", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/temporal");
    await waitForText(browser.cdp, "Temporal");
    await chooseModel(browser.cdp);
    await clickButton(browser.cdp, "Compare");
    await waitForText(browser.cdp, "One task, multiple platforms");
    await waitForExpression(browser.cdp, 'document.querySelectorAll(\'.compare-modal select[aria-label="Capability profile"] option\').length === 3');

    await chooseCapabilityProfile(browser.cdp, "local-safe", ".compare-modal");
    assert.deepEqual(await browser.cdp.evaluate(`JSON.stringify({
      label: document.querySelector('.compare-modal select[aria-label="Capability profile"]')?.selectedOptions[0]?.textContent?.trim(),
      capabilities: document.querySelector('.compare-modal .capability-picker-summary span')?.textContent?.trim(),
      skills: document.querySelector('.compare-modal .capability-picker-summary small')?.textContent?.trim(),
    })`).then(JSON.parse), {
      label: "Local safe · 1 skill",
      capabilities: "Calculator, Local read fixture",
      skills: "Research summary",
    });
    await toggleComparisonPlatform(browser.cdp, "Mastra");
    await waitForExpression(browser.cdp, 'document.querySelectorAll(".comparison-platform-picker input:checked").length === 2');
    await setInput(browser.cdp, ".compare-task-field textarea", "Compare the selected capability profile.");
    await clickButton(browser.cdp, "Run comparison");
    await waitForExpression(browser.cdp, 'document.querySelectorAll(".comparison-result-completed").length === 2');

    assert.equal(fixture.state.requests.length, 2);
    assert.deepEqual(fixture.state.requests.map((request) => request.capabilities?.profileId), ["local-safe", "local-safe"]);
    assert.equal(new Set(fixture.state.requests.map((request) => request.sessionId)).size, 2);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Compare keeps MCP capability evidence independent for each platform run", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/temporal");
    await waitForText(browser.cdp, "Temporal");
    await chooseModel(browser.cdp);
    await clickButton(browser.cdp, "Compare");
    await waitForText(browser.cdp, "One task, multiple platforms");
    await waitForExpression(browser.cdp, 'document.querySelectorAll(\'.compare-modal select[aria-label="Capability profile"] option\').length === 3');
    await chooseCapabilityProfile(browser.cdp, "local-mcp-safe", ".compare-modal");
    await waitForExpression(browser.cdp, 'document.querySelector(\'.compare-modal select[aria-label="Capability profile"]\')?.value === "local-mcp-safe"');
    await toggleComparisonPlatform(browser.cdp, "Mastra");
    await waitForExpression(browser.cdp, 'document.querySelectorAll(".comparison-platform-picker input:checked").length === 2');
    await setInput(browser.cdp, ".compare-task-field textarea", "Read alpha through the selected MCP capability.");
    await clickButton(browser.cdp, "Run comparison");
    await waitForExpression(browser.cdp, 'document.querySelectorAll(".comparison-result-completed").length === 2');

    assert.equal(fixture.state.requests.length, 2);
    assert.deepEqual(fixture.state.requests.map((request) => request.capabilities?.profileId), ["local-mcp-safe", "local-mcp-safe"]);
    assert.equal(new Set(fixture.state.requests.map((request) => request.sessionId)).size, 2, "MCP comparison members need independent context sessions");
    assert.equal(new Set(fixture.state.runIds).size, 2, "MCP comparison members need independent native runs");
    assert.equal(await browser.cdp.evaluate('document.querySelectorAll(".comparison-result-output").length'), 2);
    assert.equal(await browser.cdp.evaluate('document.querySelectorAll(".comparison-result-link").length'), 2);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Compare keeps a completed member when another platform fails", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/temporal");
    await waitForText(browser.cdp, "Temporal");
    await chooseModel(browser.cdp);
    await clickButton(browser.cdp, "Compare");
    await waitForText(browser.cdp, "One task, multiple platforms");
    await toggleComparisonPlatform(browser.cdp, "Mastra");
    await waitForExpression(browser.cdp, 'Array.from(document.querySelectorAll(".comparison-platform-picker input")).filter((input) => input.checked).length === 2');
    fixture.setFailedPlatforms(["mastra"]);
    await setInput(browser.cdp, ".compare-task-field textarea", "Keep each comparison result independent.");
    await clickButton(browser.cdp, "Run comparison");
    await waitForExpression(browser.cdp, 'document.querySelectorAll(".comparison-result-completed").length === 1 && document.querySelectorAll(".comparison-result-failed").length === 1');

    assert.equal(await browser.cdp.evaluate('document.querySelectorAll(".comparison-result-output").length'), 1);
    assert.equal(fixture.state.requests.length, 2);
    assert.equal(new Set(fixture.state.requests.map((request) => request.comparisonId)).size, 1);
    assert.notEqual(fixture.state.runIds[0], fixture.state.runIds[1]);
    assert.equal(await browser.cdp.evaluate('document.querySelectorAll(".comparison-result-link").length'), 2);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Compare reports an unavailable member without fabricating a run", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/temporal");
    await waitForText(browser.cdp, "Temporal");
    await chooseModel(browser.cdp);
    await clickButton(browser.cdp, "Compare");
    await waitForText(browser.cdp, "One task, multiple platforms");
    await toggleComparisonPlatform(browser.cdp, "Restate");
    await setInput(browser.cdp, ".compare-task-field textarea", "Keep unavailable members honest.");
    await clickButton(browser.cdp, "Run comparison");
    await waitForElement(browser.cdp, ".comparison-results");
    await waitForExpression(browser.cdp, 'document.querySelector(".comparison-results")?.textContent?.includes("unavailable") === true');
    assert.equal(fixture.state.requests.length, 1, "the unavailable member must not be dispatched");
    assert.equal(fixture.state.requests[0]?.platform, "temporal");
    assert.equal(await browser.cdp.evaluate('document.querySelectorAll(".comparison-result-error").length'), 1);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Compare resets rows after close and remains usable at narrow widths", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setRestateAvailable(true);

  try {
    for (const width of [1280, 768, 390]) {
      await browser.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await navigate(browser.cdp, "/platforms/temporal");
      await waitForText(browser.cdp, "Temporal");
      await chooseModel(browser.cdp);
      await clickButton(browser.cdp, "Compare");
      await waitForText(browser.cdp, "One task, multiple platforms");
      const layout = await browser.cdp.evaluate('JSON.stringify({ overflow: document.documentElement.scrollWidth > window.innerWidth, modal: Boolean(document.querySelector(".compare-modal")) })').then(JSON.parse);
      assert.equal(layout.modal, true);
      assert.equal(layout.overflow, false, `comparison modal overflows at ${width}px`);
      await click(browser.cdp, 'button[aria-label="Close comparison"]');
      assert.equal(await browser.cdp.evaluate('document.querySelector(".compare-modal") === null'), true);
      await clickButton(browser.cdp, "Compare");
      await waitForText(browser.cdp, "One task, multiple platforms");
      assert.equal(await browser.cdp.evaluate('document.querySelector(".comparison-results") === null'), true, "closed comparison rows must not reappear");
      await click(browser.cdp, 'button[aria-label="Close comparison"]');
    }
    assert.equal(fixture.state.createRequests, 0);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Restate Chat continues a session across workflow turns and requires a model", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setRestateAvailable(true);

  try {
    await navigate(browser.cdp, "/platforms/restate/chat");
    await waitForText(browser.cdp, "Ready");
    await chooseModel(browser.cdp);
    assert.match(await browser.cdp.evaluate("document.body.innerText"), /Messages continue in this session\./);

    await browser.cdp.evaluate('document.querySelector("[aria-label=\\"Clear selected model\\"]")?.click()');
    assert.equal(await browser.cdp.evaluate('document.querySelector("button[type=submit]")?.hasAttribute("disabled")'), true);
    assert.match(await browser.cdp.evaluate("document.body.innerText"), /Select a model\./);

    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Return a short answer.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Restate fixture completed.");
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Continue this session.");
    await clickButton(browser.cdp, "Send");
    await waitForExpression(browser.cdp, 'document.querySelectorAll(".chat-message-user").length === 2 && document.querySelectorAll(".chat-message-assistant").length === 2');
    assert.equal(fixture.state.requests[1]?.sessionId, fixture.state.requests[0]?.sessionId, "Restate follow-up must address the existing session");
    assert.notEqual(fixture.state.clientTurnIds[0], fixture.state.clientTurnIds[1], "each Restate turn must have a distinct idempotency key");
    assert.notEqual(fixture.state.runIds[0], fixture.state.runIds[1], "each Restate turn must have its own workflow run");
    assert.equal(await browser.cdp.evaluate("document.querySelector('.model-picker-trigger')?.hasAttribute('disabled')"), true);
    assert.equal(fixture.state.createRequests, 2);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Restate Chat exposes recovery-required runs and native execution details", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setRestateAvailable(true);
  fixture.setMode("recovery");

  try {
    await navigate(browser.cdp, "/platforms/restate/chat");
    await waitForText(browser.cdp, "Ready");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Recover this outcome.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Run outcome needs recovery.");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-run-details small")?.textContent?.trim()'), "reconciliation required");

    await clickSummary(browser.cdp, "Native execution");
    const nativeDetails = await browser.cdp.evaluate("document.querySelector('.chat-activity[open]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''");
    assert.match(nativeDetails, /agentlab:run-restate-1/);
    assert.match(nativeDetails, /inv-restate-1/);
    assert.match(nativeDetails, /completed/);

    await browser.cdp.evaluate('document.querySelector("[role=alert] button")?.click()');
    await waitForText(browser.cdp, "Start a conversation");
    assert.equal(await browser.cdp.evaluate("document.querySelector('.chat-run-details') === null"), true);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Restate Chat exposes context pressure and compaction evidence", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setRestateAvailable(true);
  fixture.setMode("compaction");

  try {
    await navigate(browser.cdp, "/platforms/restate/chat");
    await waitForText(browser.cdp, "Ready");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Compact this context safely.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Restate fixture compacted.");

    const context = await browser.cdp.evaluate(`document.querySelector('[aria-label="Context window"]')?.textContent?.replace(/\\s+/g, " ").trim() ?? ""`);
    assert.match(context, /92% used/);
    assert.match(context, /7% left/);
    assert.match(context, /Compaction due/);

    await clickSummary(browser.cdp, "Details");
    const contextDetails = await browser.cdp.evaluate(`document.querySelector(".run-context-details[open]")?.textContent?.replace(/\\s+/g, " ").trim() ?? ""`);
    assert.match(contextDetails, /Compactions1/);

    await clickSummary(browser.cdp, "Run details");
    await clickSummary(browser.cdp, "Run timeline");
    const timeline = await browser.cdp.evaluate(`document.querySelector(".chat-activity[open]")?.textContent?.replace(/\\s+/g, " ").trim() ?? ""`);
    assert.match(timeline, /Context Compaction Started/);
    assert.match(timeline, /Context Compacted/);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("LangGraph Chat continues one checkpointed session and shows native context", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    await navigate(browser.cdp, "/platforms/langgraph/chat");
    await waitForText(browser.cdp, "LangGraph");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Remember the checkpoint marker.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "LangGraph fixture completed.");

    const firstTurn = await browser.cdp.evaluate(`JSON.stringify({
      context: document.querySelector('[aria-label="Context window"]')?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
      native: document.querySelector('.chat-activity summary')?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
      session: document.querySelector('.chat-run-meta')?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
      toolActivity: document.querySelector('.chat-tool-activity')?.textContent?.trim() ?? null,
    })`).then(JSON.parse);
    assert.match(firstTurn.context, /8% used/);
    assert.match(firstTurn.native, /Native executionLangGraph/);
    assert.match(firstTurn.session, /Session/);
    assert.match(firstTurn.toolActivity, /calculator.*Completed/i);

    await clickSummary(browser.cdp, "Native execution");
    const nativeDetails = await browser.cdp.evaluate(`document.querySelector('.chat-activity[open]')?.textContent?.replace(/\\s+/g, " ").trim() ?? ""`);
    assert.match(nativeDetails, /langgraph:baseline:session-/);
    assert.match(nativeDetails, /baseline/);

    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Continue from the checkpoint.");
    await clickButton(browser.cdp, "Send");
    await waitForExpression(browser.cdp, 'document.querySelectorAll(".chat-message-user").length === 2 && document.querySelectorAll(".chat-message-assistant").length === 2');
    assert.equal(fixture.state.requests[1]?.sessionId, fixture.state.requests[0]?.sessionId, "LangGraph follow-up must address the existing session");
    assert.notEqual(fixture.state.clientTurnIds[0], fixture.state.clientTurnIds[1], "each LangGraph turn must have a distinct idempotency key");
    assert.notEqual(fixture.state.runIds[0], fixture.state.runIds[1], "each LangGraph turn must have its own Lab run");
    assert.equal(await browser.cdp.evaluate("document.querySelector('.model-picker-trigger')?.hasAttribute('disabled')"), true);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("LangGraph Chat reuses the admitted run after a browser refresh", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setMode("refresh");

  try {
    await navigate(browser.cdp, "/platforms/langgraph/chat");
    await waitForText(browser.cdp, "LangGraph");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Continue after a LangGraph refresh.");
    await clickButton(browser.cdp, "Send");
    await waitForExpression(browser.cdp, 'new URLSearchParams(location.search).has("run")');
    const loaded = waitForCdpEvent(browser.cdp, "Page.loadEventFired");
    await browser.cdp.send("Page.reload", { ignoreCache: true });
    await loaded;
    await waitForText(browser.cdp, "LangGraph fixture completed.");
    assert.equal(fixture.state.createRequests, 1, "refresh must not create a second LangGraph run");
    assert.equal(await browser.cdp.evaluate('document.querySelectorAll(".chat-message-user").length'), 1);
    assert.equal(await browser.cdp.evaluate('document.querySelectorAll(".chat-message-assistant").length'), 1);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("LangGraph Chat reports cancellation without claiming a result", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setMode("cancel");

  try {
    await navigate(browser.cdp, "/platforms/langgraph/chat");
    await waitForText(browser.cdp, "LangGraph");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Cancel this LangGraph turn.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Stop");
    await clickButton(browser.cdp, "Stop");
    await waitForText(browser.cdp, "Cancelled");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-message-assistant")?.textContent?.includes("LangGraph fixture completed.") ?? false'), false);
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-message-status-cancelled") !== null'), true);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("LangGraph Chat exposes recovery-required outcomes and native execution details", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setMode("recovery");

  try {
    await navigate(browser.cdp, "/platforms/langgraph/chat");
    await waitForText(browser.cdp, "LangGraph");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Recover this LangGraph outcome.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Run outcome needs recovery.");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-run-details summary small")?.textContent?.trim()'), "reconciliation required");

    await clickSummary(browser.cdp, "Native execution");
    const nativeDetails = await browser.cdp.evaluate("document.querySelector('.chat-activity[open]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''");
    assert.match(nativeDetails, /langgraph:baseline:session-/);
    assert.match(nativeDetails, /baseline/);

    await browser.cdp.evaluate('document.querySelector("[role=alert] button")?.click()');
    await waitForText(browser.cdp, "Start a conversation");
    assert.equal(await browser.cdp.evaluate("document.querySelector('.chat-run-details') === null"), true);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("LangGraph Chat renders retry, compaction, and failed outcomes", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    fixture.setMode("retrying");
    await navigate(browser.cdp, "/platforms/langgraph/chat");
    await waitForText(browser.cdp, "LangGraph");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Retry this LangGraph model request safely.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Retrying model request");
    await waitForText(browser.cdp, "LangGraph fixture completed.");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-run-retrying") === null'), true);

    await clickButton(browser.cdp, "New chat");
    fixture.setMode("compaction");
    await waitForText(browser.cdp, "Start a conversation");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Compact this LangGraph context safely.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "LangGraph fixture compacted.");
    const context = await browser.cdp.evaluate('document.querySelector("[aria-label=\\"Context window\\"]")?.textContent?.replace(/\\s+/g, " ").trim() ?? ""');
    assert.match(context, /92% used/);
    assert.match(context, /7% left/);
    assert.match(context, /Compaction due/);
    await clickSummary(browser.cdp, "Details");
    assert.match(await browser.cdp.evaluate('document.querySelector(".run-context-details[open]")?.textContent?.replace(/\\s+/g, " ").trim() ?? ""'), /Compactions1/);

    await clickButton(browser.cdp, "New chat");
    fixture.setMode("failed");
    await waitForText(browser.cdp, "Start a conversation");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Fail this LangGraph model request.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "LangGraph fixture failed before provider dispatch.");
    const failure = await browser.cdp.evaluate(`JSON.stringify({
      failedMessage: document.querySelector(".chat-message-status-failed")?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
      completedAssistantMessages: document.querySelectorAll(".chat-message-assistant.chat-message-status-completed").length,
      status: document.querySelector(".chat-run-details summary small")?.textContent?.trim() ?? "",
    })`).then(JSON.parse);
    assert.match(failure.failedMessage, /LangGraph fixture failed before provider dispatch/);
    assert.equal(failure.completedAssistantMessages, 0);
    assert.equal(failure.status, "failed");
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("LangGraph Chat reports unavailable health and stale state honestly", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);

  try {
    fixture.setLangGraphAvailable(false);
    await navigate(browser.cdp, "/platforms/langgraph/chat");
    await waitForText(browser.cdp, "LangGraph runtime is unavailable.");
    assert.equal(await browser.cdp.evaluate('document.querySelector("textarea[aria-label=\\"Message\\"]")?.hasAttribute("disabled")'), true);
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-unavailable")?.textContent?.trim()'), "Unavailable");

    fixture.setLangGraphAvailable(true);
    fixture.setMode("stale");
    await navigate(browser.cdp, "/platforms/langgraph/chat");
    await waitForText(browser.cdp, "LangGraph");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Show the last known LangGraph state.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "The platform is temporarily unavailable; showing the last known state.");
    await waitForText(browser.cdp, "LangGraph fixture completed.");

    const stale = await browser.cdp.evaluate(`JSON.stringify({
      projection: document.querySelector(".chat-run-details")?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
      assistantMessages: document.querySelectorAll(".chat-message-assistant").length,
      output: document.querySelector(".chat-message-assistant p")?.textContent?.trim() ?? null,
    })`).then(JSON.parse);
    assert.match(stale.projection, /Stale/);
    assert.equal(stale.assistantMessages, 1);
    assert.equal(stale.output, "LangGraph fixture completed.");
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Restate Chat shows a bounded retry without mislabeling the run", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setRestateAvailable(true);
  fixture.setMode("retrying");

  try {
    await navigate(browser.cdp, "/platforms/restate/chat");
    await waitForText(browser.cdp, "Ready");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Retry this model request safely.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Retrying model request");
    assert.match(await browser.cdp.evaluate('document.querySelector(".chat-run-details summary small")?.textContent?.trim() ?? ""'), /retrying/i);
    await waitForText(browser.cdp, "Restate fixture completed.");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-run-retrying") === null'), true);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Restate Chat reuses the admitted run after a browser refresh", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setRestateAvailable(true);
  fixture.setMode("refresh");

  try {
    await navigate(browser.cdp, "/platforms/restate/chat");
    await waitForText(browser.cdp, "Ready");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Continue after refresh.");
    await clickButton(browser.cdp, "Send");
    await waitForExpression(browser.cdp, 'new URLSearchParams(location.search).has("run")');
    const loaded = waitForCdpEvent(browser.cdp, "Page.loadEventFired");
    await browser.cdp.send("Page.reload", { ignoreCache: true });
    await loaded;
    await waitForText(browser.cdp, "Restate fixture completed.");
    assert.equal(fixture.state.createRequests, 1, "refresh must not create a second Restate run");
    assert.equal(await browser.cdp.evaluate('document.querySelectorAll(".chat-message-user").length'), 1);
    assert.equal(await browser.cdp.evaluate('document.querySelectorAll(".chat-message-assistant").length'), 1);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Restate Chat reports cancellation without claiming a model result", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setRestateAvailable(true);
  fixture.setMode("cancel");

  try {
    await navigate(browser.cdp, "/platforms/restate/chat");
    await waitForText(browser.cdp, "Ready");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Cancel this Restate turn.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "Stop");
    await clickButton(browser.cdp, "Stop");
    await waitForText(browser.cdp, "Cancelled");
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-message-assistant")?.textContent?.includes("Restate fixture completed.") ?? false'), false);
    assert.equal(await browser.cdp.evaluate('document.querySelector(".chat-message-status-cancelled") !== null'), true);
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Platform Chat preserves a stale projection without fabricating a result", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setMode("stale");

  try {
    await navigate(browser.cdp, "/platforms/temporal/chat");
    await chooseModel(browser.cdp);
    await setInput(browser.cdp, 'textarea[aria-label="Message"]', "Show the last known state.");
    await clickButton(browser.cdp, "Send");
    await waitForText(browser.cdp, "The platform is temporarily unavailable; showing the last known state.");
    await waitForText(browser.cdp, "The calculator result is 42.");

    const stale = await browser.cdp.evaluate(`JSON.stringify({
      projection: document.querySelector(".chat-run-details")?.textContent?.replace(/\\s+/g, " ").trim() ?? "",
      assistantMessages: document.querySelectorAll(".chat-message-assistant").length,
      output: document.querySelector(".chat-message-assistant p")?.textContent?.trim() ?? null,
    })`).then(JSON.parse);
    assert.match(stale.projection, /Stale/);
    assert.equal(stale.assistantMessages, 1);
    assert.equal(stale.output, "The calculator result is 42.");
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

test("Platform Chat opens for every registered platform", async () => {
  const browser = await openBrowser();
  await installFixture(browser.cdp);

  try {
    const platforms = [
      ["lina", "Lina"],
      ["temporal", "Temporal"],
      ["restate", "Restate"],
      ["langgraph", "LangGraph"],
      ["mastra", "Mastra"],
      ["vercel-workflows", "Vercel Workflow / AI SDK"],
      ["inngest", "Inngest"],
      ["trigger-dev", "Trigger.dev"],
      ["dbos", "DBOS"],
      ["hatchet", "Hatchet"],
      ["aws-step-functions", "AWS Step Functions"],
    ];

    for (const [platformId, platformName] of platforms) {
      await navigate(browser.cdp, `/platforms/${platformId}/chat`);
      await waitForElement(browser.cdp, ".chat-page");
      const route = await browser.cdp.evaluate(`JSON.stringify({
        name: document.querySelector(".chat-heading .eyebrow")?.textContent?.trim(),
        setupHref: document.querySelector(".chat-heading a")?.getAttribute("href"),
      })`).then(JSON.parse);
      assert.equal(route.name, platformName);
      assert.equal(route.setupHref, `/platforms/${platformId}`);
    }

    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
    assert.equal(browser.dialogs.length, 0, "Chat must not open native browser dialogs");
  } finally {
    await browser.close();
  }
});

test("Platform Chat remains usable at desktop, tablet, and narrow widths", async () => {
  const browser = await openBrowser();
  const fixture = await installFixture(browser.cdp);
  fixture.setRestateAvailable(true);

  try {
    for (const width of [1280, 768, 390]) {
      await browser.cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await navigate(browser.cdp, "/platforms/restate/chat");
      await waitForText(browser.cdp, "Ready");
      const layout = await browser.cdp.evaluate(`JSON.stringify({
        width: window.innerWidth,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        composer: Boolean(document.querySelector('textarea[aria-label="Message"]')),
        model: Boolean(document.querySelector(".model-picker-trigger")),
        heading: document.querySelector(".chat-heading h1")?.textContent?.trim() ?? null,
      })`).then(JSON.parse);
      assert.equal(layout.width, width);
      assert.equal(layout.overflow, false, `horizontal overflow at ${width}px`);
      assert.equal(layout.composer, true);
      assert.equal(layout.model, true);
      assert.equal(layout.heading, "Chat");
    }
    assert.equal(browser.errors.length, 0, `browser console errors: ${browser.errors.join(" | ")}`);
  } finally {
    await browser.close();
  }
});

async function installFixture(cdp) {
  const state = {
    capabilityRequests: 0,
    createRequests: 0,
    runReads: 0,
    runReadsById: new Map(),
    runIds: [],
    requests: [],
    clientTurnIds: [],
    runRequests: new Map(),
    mode: "complete",
    apiErrorOncePending: false,
    cancelled: false,
    restateAvailable: false,
    langGraphAvailable: true,
    failedPlatforms: new Set(),
    resumedRunIds: new Set(),
    resumeRequests: 0,
  };

  cdp.on("Fetch.requestPaused", (event) => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith("/api/")) {
      void cdp.send("Fetch.continueRequest", { requestId: event.requestId }).catch(() => undefined);
      return;
    }
    void respond(event).catch(() => undefined);
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*127.0.0.1:4318/api/*", requestStage: "Request" }] });

  async function respond(event) {
    const url = new URL(event.request.url);
    if (event.request.method === "OPTIONS") {
      await fulfill(cdp, event.requestId, { status: 204, body: "" });
      return;
    }

    if (url.pathname === "/api/models") {
      await fulfill(cdp, event.requestId, { status: 200, body: {
        provider: "openrouter",
        defaultModel: "cohere/north-mini-code:free",
        models: [modelOption()],
      } });
      return;
    }

    if (url.pathname === "/api/capabilities" && event.request.method === "GET") {
      state.capabilityRequests += 1;
      await fulfill(cdp, event.requestId, { status: 200, body: { profiles: capabilityProfiles() } });
      return;
    }

    const healthMatch = url.pathname.match(/^\/api\/platforms\/([^/]+)\/health$/);
    if (healthMatch) {
      const platform = decodeURIComponent(healthMatch[1]);
      const unavailable = (platform === "restate" && !state.restateAvailable)
        || (platform === "langgraph" && !state.langGraphAvailable);
      await fulfill(cdp, event.requestId, { status: 200, body: {
        platform,
        variant: "baseline",
        reachable: !unavailable,
        message: unavailable
          ? platform === "restate" ? "Restate runtime is unavailable." : "LangGraph runtime is unavailable."
          : `${platform} fixture is ready.`,
      } });
      return;
    }

    if (url.pathname === "/api/runs" && event.request.method === "POST") {
      state.createRequests += 1;
      const request = JSON.parse(event.request.postData ?? "{}");
      state.requests.push(request);
      state.clientTurnIds.push(request.clientTurnId);
      if (state.mode === "api-error" || state.mode === "api-error-once" && state.apiErrorOncePending) {
        state.apiErrorOncePending = false;
        await fulfill(cdp, event.requestId, { status: 503, body: { error: { code: "FIXTURE_REJECTED", message: "The fixture rejected this run." } } });
        return;
      }
      state.cancelled = false;
      const runId = `run-${request.platform}-${state.createRequests}`;
      state.runIds.push(runId);
      state.runRequests.set(runId, request);
      await fulfill(cdp, event.requestId, { status: 202, body: makeRun(request, state.mode === "cancel" ? "running" : "queued", runId, state.mode) });
      return;
    }

    const runMatch = url.pathname.match(/^\/api\/runs\/(run-(?:chat|temporal|restate|langgraph|mastra)-\d+)$/);
    if (runMatch && event.request.method === "GET") {
      const runId = runMatch[1];
      const request = state.runRequests.get(runId);
      if (!request) {
        await fulfill(cdp, event.requestId, { status: 404, body: { error: { code: "NOT_FOUND", message: "Fixture run not found." } } });
        return;
      }
      state.runReads += 1;
      const runReads = (state.runReadsById.get(runId) ?? 0) + 1;
      state.runReadsById.set(runId, runReads);
      const status = fixtureStatus(request, state.mode, runReads, state.cancelled, state.failedPlatforms, state.resumedRunIds, runId);
      await fulfill(cdp, event.requestId, { status: 200, body: makeRun(request, status, runId, state.mode) });
      return;
    }

    const eventsMatch = url.pathname.match(/^\/api\/runs\/(run-(?:chat|temporal|restate|langgraph|mastra)-\d+)\/events$/);
    if (eventsMatch && event.request.method === "GET") {
      const runId = eventsMatch[1];
      const request = state.runRequests.get(runId);
      if (!request) {
        await fulfill(cdp, event.requestId, { status: 404, body: { error: { code: "NOT_FOUND", message: "Fixture run not found." } } });
        return;
      }
      const runReads = state.runReadsById.get(runId) ?? 0;
      const run = makeRun(request, fixtureStatus(request, state.mode, runReads, state.cancelled, state.failedPlatforms, state.resumedRunIds, runId), runId, state.mode);
      await fulfill(cdp, event.requestId, { status: 200, body: { runId: run.runId, events: run.events, nextSequence: run.events.at(-1)?.recordedSequence ?? 0, hasMore: false, done: run.result !== null } });
      return;
    }

    const resumeMatch = url.pathname.match(/^\/api\/runs\/(run-(?:mastra)-\d+)\/resume$/);
    if (resumeMatch && event.request.method === "POST") {
      const runId = resumeMatch[1];
      const request = state.runRequests.get(runId);
      if (!request || request.variant !== "workflow") {
        await fulfill(cdp, event.requestId, { status: 409, body: { error: { code: "NOT_RESUMABLE", message: "Fixture run is not resumable." } } });
        return;
      }
      state.resumeRequests += 1;
      state.resumedRunIds.add(runId);
      await fulfill(cdp, event.requestId, { status: 200, body: makeRun(request, "completed", runId, state.mode, state.resumedRunIds) });
      return;
    }

    const cancelMatch = url.pathname.match(/^\/api\/runs\/(run-(?:temporal|restate|langgraph|mastra)-\d+)\/cancel$/);
    if (cancelMatch && event.request.method === "POST") {
      const runId = cancelMatch[1];
      const request = state.runRequests.get(runId);
      state.cancelled = true;
      await fulfill(cdp, event.requestId, { status: 200, body: makeRun(request ?? { platform: "temporal", task: { kind: "prompt", prompt: "fixture" }, model: modelOption() }, "cancelled", runId) });
      return;
    }

    await fulfill(cdp, event.requestId, { status: 404, body: { error: { code: "NOT_FOUND", message: "Fixture route not found." } } });
  }

  return {
    state,
    setMode: (mode) => { state.mode = mode; state.apiErrorOncePending = mode === "api-error-once"; },
    setRestateAvailable: (available) => { state.restateAvailable = available; },
    setLangGraphAvailable: (available) => { state.langGraphAvailable = available; },
    setFailedPlatforms: (platforms) => { state.failedPlatforms = new Set(platforms); },
  };
}

function fixtureStatus(request, mode, runReads, cancelled, failedPlatforms = new Set(), resumedRunIds = new Set(), runId = "") {
  if (request.platform === "mastra" && request.variant === "workflow" && request.task?.prompt?.trimStart().startsWith("[approval]") && !resumedRunIds.has(runId)) return "suspended";
  if (mode === "recovery") return "reconciliation_required";
  if (failedPlatforms.has(request.platform)) return runReads <= 1 ? "running" : "failed";
  if (mode === "failed") return runReads <= 1 ? "running" : "failed";
  if (mode === "cancel") return cancelled ? "cancelled" : "running";
  if ((request.platform === "restate" || request.platform === "langgraph") && (mode === "retrying" || mode === "refresh")) {
    return runReads <= 2 ? "running" : "completed";
  }
  return runReads > 1 ? "completed" : "running";
}

function makeRun(request, status, runIdOverride, mode = "complete", resumedRunIds = new Set()) {
  const platform = request.platform ?? "temporal";
  const runId = runIdOverride ?? `run-${platform}-1`;
  const langGraph = platform === "langgraph";
  const mastra = platform === "mastra";
  const mcp = request.capabilities?.profileId === "local-mcp-safe";
  const compaction = (platform === "restate" || platform === "langgraph") && mode === "compaction";
  const retrying = (platform === "restate" || platform === "langgraph") && mode === "retrying";
  const approvalWorkflow = mastra && request.variant === "workflow";
  const events = mcp
    ? [
      event(runId, 1, "AgentStarted", platform),
      event(runId, 2, "ModelCallStarted", platform),
      event(runId, 3, "ToolCallRequested", platform, { toolName: "mcp_fixture_lookup" }),
      event(runId, 4, "ToolExecutionStarted", platform, { toolName: "mcp_fixture_lookup" }),
      event(runId, 5, "ToolExecutionCompleted", platform, {
        toolName: "mcp_fixture_lookup",
        connection: {
          requestId: `${runId}:mcp:lookup`,
          status: "completed",
          attemptCount: 1,
          providerRequestIds: [`mcp-http:${runId}:mcp:lookup`],
          errorCode: null,
          mcp: {
            endpointRef: "local-fixture-mcp",
            serverName: "agentlab-local-mcp",
            protocolVersion: "2025-06-18",
            toolName: "fixture.lookup",
            toolVersion: "1.0.0",
            phase: "invocation",
          },
        },
      }),
      event(runId, 6, "AgentCompleted", platform),
    ]
    : approvalWorkflow
    ? status === "suspended"
      ? [event(runId, 1, "AgentStarted", platform), event(runId, 2, "WorkflowStarted", platform), event(runId, 3, "WorkflowSuspended", platform, { approved: false })]
      : [event(runId, 1, "AgentStarted", platform), event(runId, 2, "WorkflowStarted", platform), ...(resumedRunIds.has(runId) ? [event(runId, 3, "WorkflowResumed", platform, { approved: true })] : []), event(runId, 4, "WorkflowCompleted", platform), event(runId, 5, "RunCompleted", platform)]
    : platform === "restate"
    ? status === "reconciliation_required"
      ? [event(runId, 1, "RunSubmissionOutcomeUnknown", platform), event(runId, 2, "RunReconciliationRequired", platform)]
      : compaction
        ? [event(runId, 1, "AgentStarted", platform), event(runId, 2, "ContextCompactionStarted", platform), event(runId, 3, "ContextCompacted", platform), event(runId, 4, "AgentCompleted", platform)]
        : retrying
          ? [event(runId, 1, "AgentStarted", platform), event(runId, 2, "ModelRetryScheduled", platform, { reason: "pre_dispatch" })]
        : [event(runId, 1, "AgentStarted", platform), event(runId, 2, "AgentCompleted", platform)]
    : langGraph
    ? status === "reconciliation_required"
      ? [event(runId, 1, "GraphRunStarted", platform), event(runId, 2, "RunReconciliationRequired", platform)]
      : status === "failed"
        ? [event(runId, 1, "GraphRunStarted", platform), event(runId, 2, "GraphNodeStarted", platform, { node: "model" }), event(runId, 3, "GraphNodeFailed", platform, { node: "model" })]
        : compaction
          ? [event(runId, 1, "GraphRunStarted", platform), event(runId, 2, "ContextCompactionStarted", platform), event(runId, 3, "ContextCompacted", platform), event(runId, 4, "GraphRunCompleted", platform)]
          : retrying
            ? [event(runId, 1, "GraphRunStarted", platform), event(runId, 2, "ModelRetryScheduled", platform, { reason: "pre_dispatch" })]
      : mastra
        ? [
          event(runId, 1, "AgentStarted", platform),
          event(runId, 2, "ModelRequested", platform),
          event(runId, 3, "ContextPrepared", platform, { compacted: false }),
          event(runId, 4, "AgentCompleted", platform),
        ]
      : [
        event(runId, 1, "GraphRunStarted", platform),
        event(runId, 2, "GraphNodeStarted", platform, { node: "model" }),
        event(runId, 3, "ToolCallRequested", platform, { toolName: "calculator" }),
        event(runId, 4, "ToolExecutionStarted", platform, { toolName: "calculator" }),
        event(runId, 5, "ToolExecutionCompleted", platform, { toolName: "calculator" }),
        event(runId, 6, "GraphNodeCompleted", platform, { node: "model" }),
        event(runId, 7, "GraphRunCompleted", platform),
      ]
    : [
        event(runId, 1, "AgentStarted", platform),
        event(runId, 2, "ModelCallStarted", platform),
        event(runId, 3, "ToolCallRequested", platform, { toolName: "calculator" }),
        event(runId, 4, "ToolExecutionStarted", platform, { toolName: "calculator" }),
        event(runId, 5, "ToolExecutionCompleted", platform, { toolName: "calculator" }),
        event(runId, 6, "AgentCompleted", platform),
      ];
  const isSessionPlatform = platform === "temporal" || platform === "restate" || langGraph || mastra;
  const sessionId = request.sessionId ?? "session-chat";
  const terminal = status === "completed" || status === "failed" || status === "cancelled" || status === "reconciliation_required";
  const result = terminal ? {
    runId,
    status,
    finishedAt: "2026-09-16T12:00:00.000Z",
    output: status === "completed"
      ? mcp ? "MCP fixture returned alpha."
        : platform === "temporal" ? "The calculator result is 42."
        : platform === "langgraph" ? compaction ? "LangGraph fixture compacted." : "LangGraph fixture completed."
          : platform === "mastra" ? "Mastra fixture completed."
            : compaction ? "Restate fixture compacted." : "Restate fixture completed."
        : null,
    error: status === "reconciliation_required" ? {
      code: platform === "langgraph" ? "LANGGRAPH_OUTCOME_UNKNOWN" : "RESTATE_SUBMISSION_OUTCOME_UNKNOWN",
      message: platform === "langgraph" ? "LangGraph did not establish the outcome of the native execution." : "Restate did not confirm whether the workflow submission was accepted.",
      failureKind: "outcome_unknown",
      retryable: true,
    } : status === "failed" && platform === "langgraph" ? {
      code: "LANGGRAPH_MODEL_FAILED",
      message: "LangGraph fixture failed before provider dispatch.",
      failureKind: "provider",
      retryable: false,
    } : null,
    attemptCount: 1,
    usage: { inputTokens: 8000, outputTokens: 100, totalTokens: 8100 },
  } : null;
  return {
    runId,
    status,
    manifest: {
      platform,
      variant: request.variant ?? "baseline",
      comparisonId: request.comparisonId,
      task: { prompt: request.task?.prompt ?? "fixture" },
      model: {
        provider: "openrouter",
        model: request.model?.model ?? "cohere/north-mini-code:free",
        contextWindowTokens: 100_000,
      },
      ...(isSessionPlatform ? { context: { sessionId, turnId: request.clientTurnId ?? "turn-chat", clientTurnId: request.clientTurnId, snapshotId: `snapshot-${runId}` } } : {}),
    },
    events,
    executionReference: { platform, variant: request.variant ?? "baseline", executionId: runId, native: platform === "restate"
      ? { workflowKey: `agentlab:${runId}`, invocationId: "inv-restate-1", nativeStatus: "completed", retryCount: 1, lastModifiedAt: "2026-09-16T12:00:00.000Z" }
      : langGraph
        ? { serviceOrigin: "http://127.0.0.1:8090", executionId: `langgraph:${runId}`, labRunId: runId, eventSource: "langgraph-service", threadId: `langgraph:baseline:${sessionId}`, graph: "baseline", protocolVersion: 1 }
        : mastra
          ? { schemaVersion: 2, evidenceSchema: "mastra.native.v2", mastraVersion: "1.66.0", operation: request.variant === "workflow" ? "workflow.run" : "agent.generate", workflowId: request.variant === "workflow" ? "agent" : undefined, processScoped: request.variant !== "workflow", storage: request.variant === "workflow" ? "libsql-file" : "none", localSingleProcess: request.variant === "workflow" ? true : undefined, nativeStatus: status === "suspended" ? "suspended" : status === "completed" ? "completed" : "running", modelProvider: "openrouter", model: request.model?.model ?? "cohere/north-mini-code:free", eventCount: events.length, modelStepCount: 1, modelRequestCount: 1, toolCallCount: 0, toolAttemptCount: 0, contextPrepared: true }
        : { fixture: true } },
    result,
    trajectory: terminal && (platform === "temporal" || langGraph) ? { schemaVersion: 1, runId, phases: [] } : null,
    metrics: terminal && (platform === "temporal" || langGraph) ? { schemaVersion: 1, runId, durationMs: 0, eventCount: events.length } : null,
    context: isSessionPlatform ? {
      scope: "session",
      sessionId,
      sessionRevision: compaction ? 2 : 1,
      compactionRevision: compaction ? 1 : 0,
      budget: {
        contextWindowTokens: 100_000,
        inputTokens: compaction ? 92_000 : 8_000,
        reservedOutputTokens: 1_000,
        safetyMarginTokens: 500,
        remainingTokens: compaction ? 6_500 : 90_500,
        remainingPercent: compaction ? 6.5 : 90.5,
        quality: "estimated",
        tokenizerBasis: "fixture",
        pressure: compaction ? "compaction_due" : "normal",
      },
      updatedAt: "2026-09-16T12:00:00.000Z",
    } : null,
    projection: mode === "stale"
      ? { state: "stale", observedAt: "2026-09-16T12:00:00.000Z", reason: "The platform is temporarily unavailable; showing the last known state." }
      : { state: "current", observedAt: "2026-09-16T12:00:00.000Z", reason: null },
  };
}

function event(runId, sequence, kind, source, payload = {}) {
  return {
    eventId: `${runId}:${sequence}`,
    recordedSequence: sequence,
    source: `${source}-fixture`,
    sourceSequence: sequence,
    kind,
    runId,
    occurredAt: `2026-09-16T12:00:0${sequence}.000Z`,
    payload,
  };
}

function modelOption() {
  return {
    id: "cohere/north-mini-code:free",
    name: "North Mini Code",
    description: null,
    contextLength: 100_000,
    inputModalities: ["text"],
    outputModalities: ["text"],
    promptPriceUsdPerMillion: 0,
    completionPriceUsdPerMillion: 0,
    isFree: true,
    supportsTools: true,
  };
}

function capabilityProfiles() {
  return [
    {
      id: "local-safe",
      version: "1.0.0",
      displayName: "Local safe",
      description: "Pure tools and read-only local fixture access.",
      skills: [{ id: "research-summary", version: "1.0.0", name: "Research summary", description: "Keeps research summaries concise and evidence-aware.", digest: "sha256:fixture-research-summary" }],
      capabilities: [
        { id: "calculator", version: "1.0.0", kind: "tool", displayName: "Calculator", description: "Bounded deterministic arithmetic.", risk: "pure", operations: ["calculate"] },
        { id: "fixture_lookup", version: "1.0.0", kind: "connection", displayName: "Local read fixture", description: "Read-only provider-shaped local data.", risk: "read", operations: ["lookup"] },
      ],
    },
    {
      id: "local-mcp-safe",
      version: "1.0.0",
      displayName: "Local MCP safe",
      description: "Pure tools and a read-only local MCP fixture.",
      skills: [],
      capabilities: [
        { id: "calculator", version: "1.0.0", kind: "tool", displayName: "Calculator", description: "Bounded deterministic arithmetic.", risk: "pure", operations: ["calculate"] },
        { id: "mcp_fixture_lookup", version: "1.0.0", kind: "connection", displayName: "Local MCP read fixture", description: "Read one value through the local Streamable HTTP MCP server.", risk: "read", operations: ["lookup"] },
      ],
    },
    {
      id: "local-write-approved",
      version: "1.0.0",
      displayName: "Local write test",
      description: "Local write fixture; requires an explicit approval decision.",
      skills: [{ id: "research-summary", version: "1.0.0", name: "Research summary", description: "Keeps research summaries concise and evidence-aware.", digest: "sha256:fixture-research-summary" }],
      capabilities: [
        { id: "calculator", version: "1.0.0", kind: "tool", displayName: "Calculator", description: "Bounded deterministic arithmetic.", risk: "pure", operations: ["calculate"] },
        { id: "fixture_lookup", version: "1.0.0", kind: "connection", displayName: "Local read fixture", description: "Read-only provider-shaped local data.", risk: "read", operations: ["lookup"] },
        { id: "fixture_write", version: "1.0.0", kind: "connection", displayName: "Approval write fixture", description: "A deterministic write used to verify approval and unknown-outcome handling.", risk: "write", operations: ["write"] },
      ],
    },
  ];
}

async function openBrowser() {
  const profileDirectory = await mkdtemp(join(tmpdir(), "agentlab-platform-chat-browser-"));
  const debugPort = await unusedPort();
  const chrome = spawn(CHROME_BIN, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDirectory}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });
  const target = await waitForPageTarget(debugPort);
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  const errors = [];
  const dialogs = [];
  cdp.on("Runtime.consoleAPICalled", (params) => {
    if (params.type === "error") errors.push(params.args?.map((argument) => argument.value ?? argument.description ?? "").join(" ") ?? "console error");
  });
  cdp.on("Page.javascriptDialogOpening", (params) => dialogs.push(params.message));
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.setLifecycleEventsEnabled", { enabled: true });

  return {
    cdp,
    errors,
    dialogs,
    async close() {
      await cdp.close();
      chrome.kill("SIGTERM");
      await waitForExit(chrome);
      await rm(profileDirectory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    },
  };
}

async function navigate(cdp, path) {
  await cdp.send("Page.navigate", { url: `${WEB_URL}${path}` });
  await waitForElement(cdp, "#root");
}

async function chooseModel(cdp) {
  await waitForElement(cdp, ".model-picker-trigger");
  await click(cdp, ".model-picker-trigger");
  await waitForText(cdp, "Select a model");
  await clickModel(cdp, "cohere/north-mini-code:free");
}

async function chooseVariant(cdp, variant) {
  await cdp.evaluate(`(() => {
    const select = Array.from(document.querySelectorAll("select"))
      .find((candidate) => candidate.closest("label")?.querySelector("span")?.textContent?.trim() === "Variant");
    if (!select) throw new Error("Variant select not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (!setter) throw new Error("Select value setter not found");
    setter.call(select, ${JSON.stringify(variant)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
}

async function chooseCapabilityProfile(cdp, profileId, scope = "") {
  const selector = `${scope} select[aria-label="Capability profile"]`;
  await cdp.evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    if (!select) throw new Error("Capability profile select not found");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (!setter) throw new Error("Select value setter not found");
    setter.call(select, ${JSON.stringify(profileId)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
}

async function toggleComparisonPlatform(cdp, platformName) {
  const target = JSON.stringify(platformName);
  const clicked = await cdp.evaluate(
    "(() => {" +
      "const label = Array.from(document.querySelectorAll('.comparison-platform-picker label')).find((candidate) => candidate.textContent?.replace(/\\\\s+/g, ' ').trim().startsWith(" + target + "));" +
      "const input = label?.querySelector('input[type=checkbox]');" +
      "if (!input) return false;" +
      "input.click();" +
      "return true;" +
    "})()",
  );
  if (!clicked) throw new Error("Comparison platform not found: " + platformName);
}

async function clickModel(cdp, modelId) {
  await cdp.evaluate(`(() => {
    const option = Array.from(document.querySelectorAll('[role="option"]'))
      .find((candidate) => candidate.querySelector("code")?.textContent?.trim() === ${JSON.stringify(modelId)});
    if (!option) throw new Error("Model option not found: " + ${JSON.stringify(modelId)});
    option.click();
  })()`);
}

async function click(cdp, selector) {
  await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
}

async function clickButton(cdp, label) {
  await cdp.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.trim() === ${JSON.stringify(label)} && !candidate.disabled);
    if (!button) throw new Error("Enabled button not found: " + ${JSON.stringify(label)});
    button.click();
  })()`);
}

async function clickSummary(cdp, text) {
  await cdp.evaluate(`(() => {
    const summary = Array.from(document.querySelectorAll("summary"))
      .find((candidate) => candidate.textContent?.trim().startsWith(${JSON.stringify(text)}));
    if (!summary) throw new Error("Summary not found: " + ${JSON.stringify(text)});
    summary.click();
  })()`);
}

async function setInput(cdp, selector, value) {
  await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error("Input not found: " + ${JSON.stringify(selector)});
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("Input value setter not found");
    setter.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
}

async function waitForElement(cdp, selector, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for element ${selector}`);
}

async function waitForText(cdp, expected, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = String(await cdp.evaluate("document.body?.innerText ?? \"\""));
    if (body.includes(expected)) return;
    await delay(50);
  }
  const currentPage = await cdp.evaluate("JSON.stringify({ href: location.href, body: document.body?.innerText ?? '' })");
  throw new Error(`Browser did not render expected text: ${expected}. Current page: ${String(currentPage).replace(/\\s+/g, " ").slice(0, 900)}`);
}

async function waitForExpression(cdp, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate(expression)) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

function waitForCdpEvent(cdp, method, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for CDP event ${method}`)), timeoutMs);
    cdp.on(method, (params) => {
      clearTimeout(timer);
      resolve(params);
    });
  });
}

async function fulfill(cdp, requestId, response) {
  const isEmpty = response.body === "";
  const body = isEmpty ? "" : Buffer.from(JSON.stringify(response.body)).toString("base64");
  await cdp.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: response.status,
    responseHeaders: [
      { name: "content-type", value: isEmpty ? "text/plain" : "application/json" },
      { name: "access-control-allow-origin", value: "*" },
      { name: "access-control-allow-headers", value: "content-type" },
      { name: "access-control-allow-methods", value: "GET,POST,OPTIONS" },
    ],
    body,
  });
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForPageTarget(debugPort) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page");
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
    await delay(50);
  }
  throw new Error("Chrome did not expose a CDP page target.");
}

async function waitForExit(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => child.once("exit", resolve));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => this.receive(JSON.parse(String(event.data))));
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, reject, resolve });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  evaluate(expression) {
    return this.send("Runtime.evaluate", { expression, returnByValue: true })
      .then((response) => response.result?.value ?? null);
  }

  close() {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    this.socket.close();
    return new Promise((resolve) => this.socket.addEventListener("close", resolve, { once: true }));
  }

  receive(message) {
    if (message.id !== undefined) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result ?? {});
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) listener(message.params ?? {});
  }
}
