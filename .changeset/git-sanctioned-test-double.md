---
"@effected/git": minor
---

## Features

### `Git.makeTest` and `Git.layerTest`

Testing anything git-backed previously meant constructing all 26 methods of the service by hand, so a test that scripted two of them carried 24 lines of stubs that existed only to satisfy the interface — and every one of them broke whenever the service gained a method.

The sanctioned double supplies overrides per method:

```ts
const layer = Git.layerTest({
  show: () => Effect.succeed("file contents"),
  lsTree: () => Effect.succeed([]),
});
```

Anything not overridden dies with a named message identifying the method, so a test still proves that nothing else was touched. The TSDoc records what the double deliberately does not model — stderr classification, the option-injection guard, and the spawn environment all stay with the real layer.
