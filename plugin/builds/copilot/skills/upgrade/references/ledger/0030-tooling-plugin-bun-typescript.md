---
id: "0030"
title: "@effected/plugin: under bun, declare typescript beside the carrier"
kind: tooling
shows: none
applies:
  "@effected/plugin": ">=0.6.12"
detect: ["bun\\.lock|bunfig"]
closes: ["#1442"]
changesets: ["fix-bun-packed-install-plugin"]
---

bun hoists the `typescript@6` that `@microsoft/api-extractor` depends on and does not install the carrier's 7.x `typescript` peer, so the `effected` bins fail to start with `ERR_MODULE_NOT_FOUND` for `typescript/ast`. In a bun project, add `typescript` (the carrier's peer range, a 7.x release) to the project's own dependencies beside `@effected/plugin`. npm and pnpm projects need nothing.
