import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "../src/features/platforms/ChatMarkdown";

test("agent replies render lists, emphasis, code and tables without executing model HTML", () => {
  const content = 'Tools:\n\n- **Calculator** — use `calculate`\n- Notes\n\n```js\nconst answer = 42;\n```\n\n| Tool | Action |\n| --- | --- |\n| Notes | Read |\n\n<script>alert(1)</script>\n\n[Unsafe](javascript:alert(1))';
  const html = renderToStaticMarkup(createElement(ChatMarkdown, { content }));
  assert.match(html, /<ul>\s*<li><strong>Calculator<\/strong>/);
  assert.match(html, /<code>calculate<\/code>/);
  assert.match(html, /<pre><code class="language-js">const answer = 42;/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /<script>|javascript:/);
});
