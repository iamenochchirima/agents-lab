import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { restoreRemovedReviewFocus, StableReviewFocus } from "../src/features/platforms/StableReviewFocus";

function fixture(activeOutside = false, pageFocused = true) {
  const calls: unknown[] = [];
  const body = {};
  const document = { body, activeElement: activeOutside ? {} : body, hasFocus: () => pageFocused };
  const root = { ownerDocument: document, focus: (options: unknown) => calls.push(options) } as unknown as HTMLElement;
  return { root, calls };
}

test("removed review controls request local focus with preventScroll", () => {
  const { root, calls } = fixture();
  restoreRemovedReviewFocus(root, { isConnected: false } as Element);
  assert.deepEqual(calls, [{ preventScroll: true }]);
  assert.match(renderToStaticMarkup(createElement(StableReviewFocus, { "aria-label": "Action review" })), /tabindex="-1"/);
});

test("polling never steals focus from another control, a hidden page or a retained button", () => {
  for (const [outside, focused, connected] of [[true, true, false], [false, false, false], [false, true, true]]) {
    const { root, calls } = fixture(outside, focused);
    restoreRemovedReviewFocus(root, { isConnected: connected } as Element);
    assert.deepEqual(calls, []);
  }
  const { root, calls } = fixture();
  restoreRemovedReviewFocus(root, null);
  assert.deepEqual(calls, []);
});
