---
"@effected/env": minor
---

## Features

`TerminalEnv.layer` now reads core's `Stdio.stderrIsTerminal` by default instead of mirroring stdout. The `stderrIsTerminal` option stays as an override. Consumers that relied on the stdout mirror see stderr's own terminal state.

## Dependencies

| Dependency | Type           | Action  | From  | To     |
| :--------- | :------------- | :------ | :---- | :----- |
| effect     | peerDependency | updated | 4.0.2 | ^4.0.3 |
