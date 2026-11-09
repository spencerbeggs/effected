---
id: "0034"
title: "@effected/plugin/tsconfig/action.json replaces @savvy-web/github-action-builder/tsconfig/action.json"
kind: adopt
shows: none
applies:
  "@effected/plugin": ">=0.4.0"
detect: ["github-action-builder/tsconfig"]
changesets: ["plugin-env-action"]
closes: ["spencerbeggs/effected#1294"]
---

Offer this to the user; never apply it unasked. It applies to a GitHub Action repository, one with an `action.yml`.

- Repoint `tsconfig.json`'s `extends` from `@savvy-web/github-action-builder/tsconfig/action.json` to `@effected/plugin/tsconfig/action.json`. It is a drop-in: ESNext modules with bundler resolution, which resolves a CommonJS default import, `noEmit`, and excludes that resolve against the extending project's own `node_modules` and `dist`.
- Then drop `@savvy-web/github-action-builder` as a devDependency if nothing else uses it. `@effected/plugin` must be a root devDependency.
- An action that `effected action init` scaffolded onto `@effected/plugin/tsconfig/ecma.json` can move too, and stops writing a build-info file under `dist/`.

Verify with the action's typecheck, and check that no `.js` file or build-info file appears beside the sources.
