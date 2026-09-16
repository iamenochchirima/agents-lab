# Browser checks

These tests drive the built application surface in a real Chromium process through
Chrome DevTools Protocol. They are separate from the web TypeScript checks and do not
require a browser automation dependency.

With the local web app running at `http://127.0.0.1:5173`, run:

```bash
node --test apps/web/tests/browser/model-picker.browser.test.mjs
```

The test intercepts only `/api/models` and returns local catalog fixtures. It does not
call OpenRouter. It verifies the visible loading state, keyboard selection, empty and
error states, and that a slower response cannot overwrite a newer search result.
