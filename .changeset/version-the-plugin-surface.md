---
"@effected/app": patch
---

## Documentation

Version the plugin for two rounds of guidance changes that shipped without a bump.

The `effected-packages` routing map now lists `PeerCheck` as a capability the kit owns, so an agent asking whether a workspace's peer graph is satisfied is routed to it rather than reimplementing the check or shelling out to a package manager. It also records the narrowed `@effected/lockfiles` input domain in lockfile-format terms, and carries the consumer traps into routing rather than leaving them in reference material: an empty `unsatisfied` is not a clean report, both `unverified` reasons mean fail closed, and presence of the `peerDependencyRules` key is the assertion rather than its contents.

The `effect-v4-testing` skill gained the verification disciplines that mutation work depends on, and one correction. It previously said an empty mutation run indicts the tooling rather than the mutant; that ordering produced a real misdiagnosis, where a `grep` returning nothing was read as a broken tool when the cause was two NUL bytes in a source file making it binary to `grep` and `rg`. Suspicion now scopes to the input before the tool, and that trap is named.
