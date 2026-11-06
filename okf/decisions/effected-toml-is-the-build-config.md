---
type: Decision
title: effected.toml is the only build config, and code enters through two data keys
description: "Build config lives in effected.toml, at the workspace root, the package, or both with precedence; plugins names rolldown plugin modules and manifest.drop replaces the sidecars' transform, so no savvy.build.ts remains and the 41 kit packages with nothing to say need no file at all."
status: draft
tags:
  - architecture
  - dx
sources:
  - id: spec
    resource: ../../docs/superpowers/specs/2026-11-06-bundler-research.md
    title: "The bundler research report and the owner's rulings"
  - id: plan
    resource: ../../docs/superpowers/plans/2026-11-06-bundler-branch.md
    title: "Decisions this plan takes, item 5"
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T20:18:23Z
integrity:
  generated:
    body: b92b601889abdefb
---

# effected.toml is the only build config, and code enters through two data keys

## Context

Each of the kit's 47 packages carried a `savvy.build.ts`, and they used almost none of its option surface: `meta.localPaths` in 45, the `_base` suppression in 42, `dtsExternals` in five, `plugins` in one. Outside the kit, `vitest-agent` adds `bundledPackages`, `exe`, a sidecar `transform` and `meta: false`, and `silk-release-action` uses action entries and a few build options. A data-only config covered 46 of the 47 kit packages. The remaining one was `pnpm-plugin-effected`, whose `PnpmConfigPlugin` held the catalog literal at its call site.[^spec]

## Decision

**`effected.toml` is the only config file.** It is read with [`@effected/config-file`](../modules/config-file.md) over [`@effected/toml`](../modules/toml.md).

**Both root and package configs exist, with precedence.** The owner ruled this discovery order:[^spec]

1. `<root>/.config/effected.toml`
2. `<root>/effected.toml`
3. `<pkg>/.config/effected.toml`
4. `<pkg>/effected.toml`
5. `<pkg>/lib/configs/effected.toml`

**Code enters through two data keys, and nowhere else:**[^plan]

```toml
[package.build]
plugins = ["./lib/build/x.ts"]

[package.build.manifest]
drop = ["dependencies"]
```

- `plugins` names modules whose default export is a rolldown plugin. They are loaded with `jiti`, as the schemastore config is.
- `manifest.drop` replaces the sidecars' `transform` callback.

**Most packages need no file.** `localPaths` is dropped because the website is frozen, and `{ messageId: "ae-forgotten-export", pattern: "_base" }` becomes the bundler's default suppression, so the 41 packages that set only those two things have nothing to declare.

## Alternatives rejected

- **Keeping a `savvy.build.ts` per package.** Forty-seven programs to express at most a handful of settings, and a config that can only be read by executing it.
- **A TypeScript config with a free-form `transform` callback.** It covers the sidecar case by admitting arbitrary code into every config, when one data key states what the sidecars actually do.
- **Root only, or package only.** Root only cannot state a per-package fact such as `dtsExternals` without a per-package table; package only repeats what a whole workspace shares. The owner ruled for both.

## Related

- [`@effected/bundler`](../modules/bundler.md) owns the `EffectedConfig` schema, the discovery and the plugin loading.
- [The schema commands](../interfaces/schema-commands.md) set the `jiti` loading precedent.

[^spec]: `docs/superpowers/specs/2026-11-06-bundler-research.md`, sections 2, 5, 9 and 12.
[^plan]: `docs/superpowers/plans/2026-11-06-bundler-branch.md`, the section "Decisions this plan takes".
