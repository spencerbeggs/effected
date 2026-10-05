---
"@effected/ai-plugin": minor
---

## Documentation

- The `effected-packages` skill gains a reference for `@effected/lsp` (frame codec and boot probe), and its `engine`, `mcp`, `store` and `workspaces` references cover the new surfaces: `ProcessGuard` in `@effected/engine/guard`, `McpHarness.stop` and the draining `close`, `McpProcess.stderrUntil`, `RunBinOptions.stdin`, and `PackedInstall.preflight` / `gate`.
- The `effect-v4-mcp` skill covers the stop/drain semantics of the test harness, the crash guard, stderr waits, and that structured data on a refusal is unreachable.
- The `effect-v4-cli` skill covers the `isCancelled` and `isNotInteractive` failure flags and `env.formatter` for `helpOnUsageError`.
- The `design-patterns` skill carries the packed-install preflight and CI-gate recipe for carrier verification.
- The store references no longer prescribe a first-open warm-up workaround, and the `effect-reviewer` and `effect-developer` agents are updated to match.
