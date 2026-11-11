---
id: "0011"
title: "the effected tool pins its kit closure exactly; pin your own tool packages the same way"
kind: adopt
shows: none
applies:
  "@effected/pnpm-plugin-effected": ">=0.26.2"
  "@effected/plugin": ">=0.5.2"
  "@effected/cli": ">=0.31.1"
  "@effected/mcp": ">=0.18.1"
  "@effected/engine": ">=0.17.1"
  "@effected/bundler": ">=0.4.1"
detect: ["\"@effected/[a-z0-9-]+\":[[:space:]]*\"(catalog:effected\"|workspace:\\^|\\^)"]
changesets: ["tool-pins-kit-closure", "effected-exact-catalog"]
closes: ["spencerbeggs/effected#1333"]
---

Offer this to the user; never apply it unasked. It applies only when this repository publishes a tool built on the kit: a package with a `bin`, a CLI or MCP server, or a bundler, test or lint plugin another repository installs.

The catalog plugin now serves `effected:exact`: the `effected` catalog with every operator stripped. The kit's own tool pins every `@effected/*` dependency of its packages to an exact version, so a newer kit patch never reaches an installed tool without a release of the tool, and a kit library inside the tool can no longer take a peer from another release line. The tool may now resolve its own copies of kit packages beside this repository's newer ones. That is intended: do not override them onto the new versions.

Where the search matched, keep only manifests of published tool packages. Skip libraries (packages other code imports keep carets and `effect` as a peer), the root `package.json`, and private workspace packages. For each tool package:

- Write `catalog:effected:exact` on each `@effected/*` dependency, and on `effect` and any `@effect/*` the tool declares. It publishes the exact catalog version and moves with every plugin bump. `catalog:effected` publishes the catalog's caret, so it does not pin.
- Keep every kit peer the tool's dependencies need declared as a regular dependency, exact like the rest, even where no file imports it.
- Add a test that reads the tool's source manifests and fails on any `@effected/*` dependency not written `catalog:effected:exact`, asserting the list is non-empty.

Check the result by packing one tool package (`pnpm pack`) and reading its manifest: every kit dependency must be a plain version. The `design-patterns` skill's carrier-closure reference has the rule, why it holds, and what it leaves unsealed.
