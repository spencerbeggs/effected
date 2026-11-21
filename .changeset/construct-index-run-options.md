---
"@effected/ai-plugins": patch
---

## Documentation

* The `effected-packages` construct index lists `ConfigDependencyHooksSubprocessOptions` and says `GitRunOptions` installs through `Git.layerRunOptions` as well as `Git.withRunOptions`
* `effect-v4-testing`'s false-greens reference puts a test's environment in through `vi.stubEnv`, undone by `vi.unstubAllEnvs()` in `afterEach`, instead of a hand-written `process.env` save and restore
