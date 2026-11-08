---
id: "0037"
title: "The effected-built export condition links built output to a plain-Node workspace consumer such as rspress build"
kind: adopt
shows: none
applies:
  "@effected/plugin": ">=0.4.0"
  "@effected/bundler": ">=0.2.0"
detect: ["@savvy-web/rspress-builder|linkDirectory|dist/dev"]
changesets: ["bundle-sidecar-renames"]
---

Offer this to the user; never apply it unasked. It fits a workspace whose framework CLI loads a workspace sibling in plain Node, `rspress build` importing a workspace plugin being the known case. Workspace links resolve to `src/`, which tsx and vitest load and plain Node does not.

1. **In every sibling on the chain**, add the built file as the first condition of each export, followed by the source:

   ```json
   "exports": {
     ".": { "effected-built": "./dist/prod/npm/pkg/index.js", "default": "./src/index.ts" }
   }
   ```

   Every library the built plugin imports needs it too, since each built file imports its siblings by name. Vitest, tsx and TypeScript do not match the condition and keep resolving source.
2. **Run the consumer with the condition**, as `"build": "NODE_OPTIONS=--conditions=effected-built rspress build"`. That also replaces the root's `--import=tsx` for the script. Give its turbo task `dependsOn: ["^build"]` so the siblings build first.
3. **Add the condition to the site bundler's own list.** `--conditions` reaches only Node's resolver. For rspress, prepend it in `builderConfig.tools.rspack`:

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

The build strips the condition from the published manifest. It must be the first key and a literal path under `./dist/prod/`, followed by an `import` or `default` source condition, or the build fails `ConfigValidationError`. A path that is not the emitted file warns `exports-built-condition-unmatched` in `issues.json` and names the path to write. Publish from `dist/prod`, never from source.

Verify by running the consumer's build with the condition after `turbo run build`, and reading `issues.json` for the warning.
