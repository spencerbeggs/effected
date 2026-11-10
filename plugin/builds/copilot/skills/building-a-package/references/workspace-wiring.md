# Wiring a workspace for the kit build

A workspace on the kit has no dev build. Workspace links resolve through `exports` to `src/`, which TypeScript, tsx and vitest load directly, so no sibling has to be built before a typecheck or a test. Only the release, plain-Node consumers and tests that read built output need `dist/prod`.

## Install the tool

`@effected/plugin` is a root devDependency through `catalog:effected`. It brings `effected` and `effected-mcp`, and peers `typescript` at `7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`. In a monorepo it belongs at the root, not in each package. The tsconfig presets ship with it: a package extends `@effected/plugin/tsconfig/ecma.json`.

## Scripts and turbo tasks

```jsonc
// package.json of each built package
"scripts": {
  "build": "effected package build",
  "types:check": "tsc --noEmit"
}
```

```jsonc
// turbo.json
"tasks": {
  "build": { "dependsOn": ["types:check"], "outputs": ["dist/**"] },
  "types:check": { "dependsOn": ["^types:check"] }
}
```

- **One `build` script per package**, no target flag, no `prepare`.
- **`types:check` depends on `^types:check`**, not on a build, because links resolve to source.
- **Add `^build` to `dependsOn` only where a task needs a sibling's built output:** a package whose `bundledPackages` names a sibling (in that package's own `turbo.json`), a plain-Node consumer using `effected-built`, or a package that keeps its own differently named build task, such as an example standing in for another bundler, so an edit to the library it links invalidates its cache. In a package `turbo.json` that `extends: ["//"]`, an array replaces the root's, so a bare `["^build"]` drops the `types:check` gate; write `"dependsOn": ["$TURBO_EXTENDS$", "^build"]`, with the marker first, or list `"types:check"` beside it.
- Add `.cache` to `.gitignore`: every build appends to `.cache/effected/*.jsonl` at the workspace root.

## Running the bins: `nodeOptions` and self-registering bins

A repository that installs `@effected/plugin` from the registry runs a built bin and needs nothing here. The rest applies to a repository that runs a bin from source, typically its own carrier through `workspace:*`.

- **A pnpm script gets tsx from `nodeOptions`.** In `pnpm-workspace.yaml`, `nodeOptions: --import=tsx` (with `tsx` a root devDependency) makes every process a pnpm script starts load tsx, so a source bin and source links run.
- **That setting is repo-global.** A tool that loads its own bundles can break under it, `rspress build` being the known case. The escape is `NODE_OPTIONS=` at the front of that one script, which replaces the inherited value.
- **An install must not inherit it.** pnpm writes `nodeOptions` into `NODE_OPTIONS` for every process a script or `pnpm exec` starts, turbo tasks under them included. A `pnpm install` started from one, such as a `reinstall` script, passes it to the Node process that loads the pnpmfiles, and with no `node_modules` that process dies on `Cannot find package 'tsx'` before any pnpmfile runs. Start such an install with `NODE_OPTIONS=`. An install from a plain shell is unaffected.
- **A source bin registers tsx itself.** `node_modules/.bin/<tool>` run from a hook, an MCP loader or a bare shell gets no `nodeOptions`, and dies with `ERR_MODULE_NOT_FOUND` on a `.js` under a sibling's `src/`. The bin file guards a computed tsx import on `import.meta.url.endsWith(".ts")` and loads everything else dynamically after it; `effect-v4-cli`'s bin-only-package reference has the exact file.
- **Every `.tsx` file starts with `/** @jsxRuntime automatic */`** in such a repository. tsx applies one tsconfig per process, found from the working directory, so a linked package's JSX can compile to classic `React.createElement`, and a TTY run of a live view fails `React is not defined` while a captured run stays green.
- A root `build` script uses `--filter=!docs` (or the site's name) when a website package has a `build` task of its own.

## Testing built output

- **A test that reads built output points at `dist/prod/<group>/pkg`.** There is no `dist/dev` tree.
- **Build before the suite, in the test global setup**, by running `turbo run build --filter <pkg>` there, so turbo's cache keeps it cheap and an edit always rebuilds. Do not rely on a CI step that once ran a build at install time: that was `prepare`, and it is gone, and turbo silently skips a task a package no longer declares, so a stale `dist/` can keep tests passing against an old build.
- **A test that spawns a built bin inside the workspace passes tsx itself.** The built bin's own registration branch is dead, but its siblings still resolve to source through the workspace links:

  ```ts
  import { spawnSync } from "node:child_process";
  import { createRequire } from "node:module";
  import { pathToFileURL } from "node:url";

  const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
  const run = spawnSync(process.execPath, ["--import", TSX, "dist/prod/npm/pkg/bin/tool.js", "--version"], {
    encoding: "utf8",
  });
  ```

  An installed consumer needs nothing of the kind.

## The `effected-built` condition: plain-Node consumers

A workspace consumer that loads a sibling in plain Node, such as a framework CLI (`rspress build`) importing a workspace plugin that imports workspace libraries, cannot load `src/`. Point it at the built JS under the `effected-built` export condition.

1. **In every sibling on the chain,** add the built file as the first condition of each export, then the source:

   ```json
   "exports": {
     ".": { "effected-built": "./dist/prod/npm/pkg/index.js", "default": "./src/index.ts" }
   }
   ```

   Each built file imports its siblings by name, so every library the built plugin reaches needs it too. Vitest, tsx and TypeScript do not match the condition and keep resolving source.
2. **Run the consumer with the condition**, after its siblings build: `"build": "NODE_OPTIONS=--conditions=effected-built rspress build"`, with `dependsOn: ["^build"]` on its turbo task. The `NODE_OPTIONS=` also drops the root's `--import=tsx` for that script.
3. **Add the condition to the consumer's own bundler.** `--conditions` reaches Node's resolver and no bundler's. For rspress, prepend it to rspack's list:

   ```ts
   builderConfig: {
     tools: {
       rspack: (config) => {
         config.resolve ??= {};
         config.resolve.conditionNames = ["effected-built", ...(config.resolve.conditionNames ?? ["..."])];
         return config;
       },
     },
   },
   ```

The build checks the condition and strips it before reading the exports, so the published manifest and `pkg/` are unchanged. It must be the first key of a subpath's condition object, a literal path under `./dist/prod/`, followed by an `import` or `default` condition naming the source; it may not nest or sit in a root-level condition object. Each violation fails `ConfigValidationError`. A target that is not the file a group emitted for that export warns `exports-built-condition-unmatched` in `issues.json`, naming the path to write.
