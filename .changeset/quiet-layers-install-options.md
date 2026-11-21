---
"@effected/git": minor
---

## Features

Adds `Git.layerRunOptions(options)`, a `Layer<never>` that installs `GitRunOptions` for every `git` spawn a whole program or test suite makes. It is the layer-level form of `Git.withRunOptions`: `env` and `config` merge key by key over the options already in force and `timeout` is replaced. A `withRunOptions` call inside the program still overrides the layer key by key.

```ts
import { Git } from "@effected/git";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Layer } from "effect";

const Isolated = Git.layerRunOptions({ env: { GIT_CONFIG_GLOBAL: "/dev/null" } });
const AppLayer = Layer.mergeAll(Git.layer, Isolated).pipe(Layer.provideMerge(NodeServices.layer));
```
