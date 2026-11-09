---
id: "0030"
title: "@effected/npm: NpmRegistry.versions, distTags and publishTimes answer Option, None for an absent package"
kind: breaking
shows: typed
applies:
  "@effected/npm": ">=0.32.0"
detect: ["\\.(versions|distTags|publishTimes)\\(", "layerSeeded|NpmRegistry\\.layerTest"]
changesets: ["npm-option-packuments"]
closes: ["spencerbeggs/effected#1305"]
---

`NpmRegistry.versions`, `distTags` and `publishTimes` answer an `Option`. `None` is a 404: the package is not on that registry, or the target cannot see it. `Some([])` or `Some({})` is a package the registry knows that lists nothing, such as a fully unpublished one. Before, both were an empty collection.

- **A caller that read an empty result as "not found"** switches to `Option.match` or `Effect.fromOption` and drops the length check. A caller that only iterated the list unwraps it with `Option.getOrElse(() => [])` if absence really means nothing to it.
- **A `layerTest` stub** of these members returns `Option.some(...)` or `Option.none()`.
- **A test on `layerSeeded`** that expected `[]` for an unseeded package now gets `None`.

`detect` matches any `.versions(`, `.distTags(` or `.publishTimes(` call, so keep only the hits in files that import `NpmRegistry` from `@effected/npm`. The compiler flags every one of those. A fully unpublished package now reads instead of failing `RegistryReadError` with kind `decode`, so a workaround that caught that error can go. The same release adds `NpmConfig.transport`, `proxyFor` and `tlsFor`, which read the npmrc's proxy and TLS settings that `NpmRegistry` still never applies itself. A repository behind a proxy or an internal CA reads the `NpmRegistry.manifest` adopt entry's transport section before replacing a `pnpm view` shell-out. Read the installed `.d.ts` for the exact shapes.
