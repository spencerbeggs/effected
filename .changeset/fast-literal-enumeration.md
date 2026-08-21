---
"@effected/workspaces": patch
---

## Performance

Workspace pattern enumeration now probes literal package directories with bounded concurrency (`10`) instead of serial `exists` checks, reducing latency in workspaces that declare many literal entries.

- Output ordering, pattern semantics, and public APIs are unchanged; this only reduces time spent on independent filesystem probes.
