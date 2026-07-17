# Predecessor (`*-effect`) → `@effected` bridge

Some repos already depend on the **v3-era predecessor packages** the kit
superseded — `xdg-effect`, `config-file-effect`, `workspaces-effect`. Adopting
the kit from those is **not** net-new wiring: it is a package rename **plus real
API breaks**. The Effect v3→v4 rename map (`effect-v4-construct-map`) does not
cover these — that map is for `effect` itself, not for the old kit → new kit. Use
the tables below so a repo already on the predecessors doesn't reverse-engineer
each break from the new reference docs.

Package renames:

| predecessor | successor |
| --- | --- |
| `xdg-effect` | `@effected/xdg` |
| `config-file-effect` | `@effected/config-file` |
| `workspaces-effect` | `@effected/workspaces` |

The **new-side** APIs below are verified against the current kit source; the
old-side shapes are the predecessor's, per the migration reports that surfaced
this bridge. Verify any old-side call against the version you actually have
installed before trusting it.

## `config-file-effect` → `@effected/config-file`

| predecessor shape | `@effected/config-file` |
| --- | --- |
| `ConfigFile.Live({ tag, ... })` | a `ConfigFile.Service<Self, A>()(id)` class **plus** `ConfigFile.layer(Tag, { ... })` — the service identity and the layer are separate steps |
| bare `WorkspaceRoot` / `GitRoot` / `UpwardWalk` resolvers | `ConfigResolver.workspaceRoot` / `.gitRoot` / `.upwardWalk` statics (the object also carries `explicitPath` / `staticDir` / `systemEtc`) |
| an implicit resolver order | compose resolvers explicitly with `MergeStrategy.firstMatch()` |

```ts
// new-side skeleton
import { ConfigFile, ConfigResolver, MergeStrategy } from "@effected/config-file";

class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}

const AppConfigLive = ConfigFile.layer(AppConfig, {
  // filename, schema, codec, ...
  strategy: MergeStrategy.firstMatch(),
  // resolvers: [ConfigResolver.workspaceRoot({ ... }), ConfigResolver.gitRoot({ ... }), ...]
});
```

`ConfigFile.Service<Self, A>()(id)` and `ConfigFile.layer` are the two halves the
old single `ConfigFile.Live({ tag })` call collapsed together — bind the class
once, then build the layer from it.

## `xdg-effect` → `@effected/xdg`

| predecessor shape | `@effected/xdg` |
| --- | --- |
| an `AppDirsConfig` config **class** | removed — `AppDirs.layer({ namespace, ... })` takes the namespace as an option |

```ts
import { AppDirs } from "@effected/xdg";

const AppDirsLive = AppDirs.layer({ namespace: "myapp" });
// R = Xdg | FileSystem | Path
```

There is no separate config class to construct and provide; the namespace is a
plain option on `AppDirs.layer`, and everything downstream (e.g. `AppConfig`)
reads the namespace from the ambient `AppDirs` service rather than a config
value, so the two can't drift.

## `workspaces-effect` → `@effected/workspaces`

Beyond the rename, note the sync escape hatch is now free-standing consts taking
a consumer-supplied `SyncFileSystem`/`SyncPath` (no namespace object, nothing
defaulted to Node) — see [workspaces.md](./workspaces.md). The async
`WorkspaceRoot` / `WorkspaceDiscovery` services are the default surface.

## When this bridge is enough — and when it isn't

A terse rename table plus the three break tables above covers the mechanical
adoption. What it deliberately doesn't cover: the predecessor packages that had
**no** successor in the kit (they were dropped or folded elsewhere), and any
old-side signature detail — pin those against the installed predecessor version,
not memory. If a break you hit isn't in a table here, add it.
