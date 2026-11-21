---
"@effected/ai-plugins": patch
---

## Documentation

* Upgrade-ledger entry 0037: `@effected/github`'s `ActionsOidcClaims` requires `refProtected`, `refType`, `baseRef` and `headRef`, so hand-built claims and wire payloads must supply them
* The `effected-packages` `@effected/github` reference teaches gating a privileged action on `refProtected` rather than on the ref's name

* The `effected-packages` construct index lists `ConfigDependencyHooksSubprocessOptions` and says `GitRunOptions` installs through `Git.layerRunOptions` as well as `Git.withRunOptions`
* `effect-v4-testing`'s false-greens reference puts a test's environment in through `vi.stubEnv`, undone by `vi.unstubAllEnvs()` in `afterEach`, instead of a hand-written `process.env` save and restore
