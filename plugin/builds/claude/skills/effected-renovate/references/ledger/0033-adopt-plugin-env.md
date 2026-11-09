---
id: "0033"
title: "@effected/plugin/env replaces the savvy builders' env reference for process.env.__PACKAGE_VERSION__"
kind: adopt
shows: none
applies:
  "@effected/plugin": ">=0.4.0"
detect: ["(bundler|rspress-builder)/env"]
changesets: ["plugin-env-action"]
closes: ["spencerbeggs/effected#1299"]
---

Offer this to the user; never apply it unasked. It removes the last reason to keep `@savvy-web/bundler` or `@savvy-web/rspress-builder` installed for its types.

`@effected/plugin/env` is an ambient, types-only declaration of `process.env.__PACKAGE_VERSION__`, the define `effected package build` sets.

- Replace `/// <reference types="@savvy-web/bundler/env"/>`, usually in `types/env.d.ts`, with `/// <reference types="@effected/plugin/env" />`. Check that a `@savvy-web/rspress-builder/env` reference declares nothing else the package reads before you replace it the same way.
- A package that does not set `noPropertyAccessFromIndexSignature` can delete the reference file instead, since the read type-checks through `ProcessEnv`'s index signature.
- The reference resolves through `@effected/plugin` as a root devDependency, so a nested package needs no dependency of its own.
- With the reference, `ProcessEnv` gains a named property, so assigning `process.env` to a type whose properties are all optional can fail `TS2559`, exactly as it did with the savvy reference.

Verify with the package's typecheck.
