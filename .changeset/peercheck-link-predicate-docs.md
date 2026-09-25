---
"@effected/claude-code-plugin": patch
"@effected/copilot-plugin": patch
---

## Other

- The workspaces skill reference now teaches the `link:` consequence of `PeerCheck`'s fail-closed posture: under pnpm every `workspace:` dependency raises `"unresolvedEdge"` (a linked parent's manifest peers are never in the lockfile), so the strict clean predicate is unreachable for a monorepo with internal dependencies, and a gate needing peer assurance pairs the report with `pnpm peers check` there.
