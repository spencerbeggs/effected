---
"@effected/git": minor
---

## Breaking Changes

`GitShape` gained members (listed under Features), so a hand-built `Git` double that implements the shape must add them. Build test doubles with `Git.makeTest`, which fills every member you do not override, instead of writing the whole shape by hand.

## Features

### Per-call run options

`Git.withRunOptions(effect, options)` scopes extra settings to every `git` spawn inside `effect`. `GitRunOptions` carries `env` (extra environment variables), `config` (git config entries, passed through `GIT_CONFIG_COUNT` and its key and value variables) and `timeout` (replaces the per-run ceiling). The service's own locale, prompt and askpass pins always win over a per-call `env`.

```ts
Git.withRunOptions(git.revParse(cwd, "HEAD"), {
	env: { GIT_LFS_SKIP_SMUDGE: "1" },
	config: { "advice.detachedHead": "false" },
});
```

### Redacted debug transcript

Every `git` invocation now writes a Debug-level transcript with secrets redacted. The stdout of any `git config` invocation is never logged, only its size.

### Version and new commands

* `GitVersion` and `Git.version` report the installed git version
* New members: `init`, `configAdd`, `fetchRefspecs`, `sparseCheckoutDisable`, `lfsInstall`, `lfsFetch` and `remoteHead`
* `checkout` takes `force` and `branch` options, `clean` takes `nested`, `branchDelete` takes `remote`, and `submoduleUpdate` takes `protocolVersion`
