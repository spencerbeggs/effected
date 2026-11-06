# exe-only fixture

The shape of vitest-agent's `packages/sidecar-darwin-arm64` (per-platform `os` and `cpu`, a `bin`, no library entries) with its own name and a one-line entry, hand-written on 2026-11-06 for `__test__/e2e/exe-only.e2e.test.ts`.

It declares `darwin` and `arm64`, so the test skips on any other host. The dependency exists to be dropped by `[package.build.manifest]`; it is never installed.
