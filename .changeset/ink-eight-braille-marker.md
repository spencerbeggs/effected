---
"@effected/cli": minor
---

## Breaking Changes

`@effected/cli` now targets Ink 8. The `ink` peer is `^8.0.0`, and the `react` and `@types/react` peers are `^19.3.0`. A consumer on Ink 7, or on React older than 19.3, must upgrade both before updating.

## Bug Fixes

- Under GitHub Actions, text the CLI prints (plain, ANSI and markdown renders, failure reports, and an Ink screen's `DocView` output) now carries the new `CommandNeutralizer` marker, U+2800, in place of the zero-width space. The runner skips zero-width characters, so the old marker did not stop workflow-command injection. See the `@effected/github-commands` release for the security detail. Neutralized text is one blank column wider per marker.
- `useTerminalSize` no longer relies on Ink's stdout typing exposing `columns` and `rows`; it reads them from the TTY stream and falls back for non-TTY streams.

## Maintenance

- The `CliUiTest` harness and its terminal model are adapted to Ink 8.
- The `drainPerformance` option is now a no-op under Ink 8 and is kept only for API stability.
