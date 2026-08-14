---
"@effected/app": patch
---

## Documentation

* `effect-v4-source-lookup` documents a **scratchpad venue** for rung-3 semantic probes: in a repo that ships a private `scratchpad/` workspace, write a typed probe as `scratchpad/probes/<name>.ts` and run it with `pnpm scratchpad:probe probes/<name>.ts`, or a test-shaped probe under `scratchpad/__test__/` run via `vitest --project scratchpad`. `pnpm scratchpad:check` answers does-this-compile questions that `tsx`/`vitest` would silently skip. The existing no-scratchpad protocol (probe lives inside the package, delete by absolute path, etc.) is unchanged and still applies verbatim when a repo has no `scratchpad/` workspace.
* `effect-v4-planning` points a survives-the-source-read question at the scratchpad venue when one exists, as the place to settle it with a probe.
