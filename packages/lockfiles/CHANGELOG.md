# @effected/lockfiles

## 0.1.8

### Bug Fixes

* ### Internal @effected edges float patches instead of pinning exact versions

  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Dependencies

| Dependency    | Type       | Action  | From  | To    |
| ------------- | ---------- | ------- | ----- | ----- |
| @effected/npm | dependency | updated | 0.2.2 | 0.2.3 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.1.7

### Dependencies

| Dependency      | Type       | Action  | From  | To    |
| --------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc | dependency | updated | 0.4.0 | 0.5.0 |

## 0.1.6

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/npm    | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/semver | dependency | updated | 0.1.1 | 0.2.0 |
| @effected/yaml   | dependency | updated | 0.4.0 | 0.5.0 |

## 0.1.5

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc  | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/npm    | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/semver | dependency | updated | 0.1.0 | 0.1.1 |
| @effected/yaml   | dependency | updated | 0.3.1 | 0.4.0 |

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.4

### Dependencies

| Dependency      | Type       | Action  | From  | To    |
| --------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/yaml  | dependency | updated | 0.3.0 | 0.3.1 |

## 0.1.3

### Dependencies

| Dependency     | Type       | Action  | From  | To    |
| -------------- | ---------- | ------- | ----- | ----- |
| @effected/yaml | dependency | updated | 0.2.0 | 0.3.0 |

## 0.1.2

### Dependencies

| Dependency      | Type       | Action  | From  | To    |
| --------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/yaml  | dependency | updated | 0.1.0 | 0.2.0 |

## 0.1.1

### Dependencies

| Dependency    | Type       | Action  | From  | To    |
| ------------- | ---------- | ------- | ----- | ----- |
| @effected/npm | dependency | updated | 0.1.0 | 0.2.0 |

## 0.1.0

### Features

* Lockfile parsing for Effect v4: bun (`bun.lock`), npm (`package-lock.json` v2/v3), pnpm (`pnpm-lock.yaml`) and yarn Berry (`yarn.lock`) all normalized into one `Lockfile` schema model, plus pure integrity checking of that model against workspace manifests. Four formats, one model. Every entrypoint takes content as a string — no IO — and malformed input always exits through a typed error channel, never as a defect. No external runtime dependencies.

  ### One model over four formats

  `Lockfile.parse` is the only fallible boundary; everything else is total. pnpm workspace packages come back keyed by importer path, so `withImporterNames` is a pure second stage that rewrites them once the consumer has read the manifests. `LockfileIntegrity.compare` checks the model against manifests with no error channel at all.

  ```ts
  import { Lockfile, LockfileIntegrity, WorkspaceManifest } from "@effected/lockfiles";
  import { Effect } from "effect";

  declare const content: string; // lockfile text, read by the caller

  const program = Effect.gen(function* () {
    const lockfile = yield* Lockfile.parse(content, { format: "pnpm" });

    const named = lockfile.withImporterNames(new Map([["packages/core", "@acme/core"]]));
    const versions = named.packagesNamed("typescript").map((p) => p.version);

    const report = LockfileIntegrity.compare(named, [
      WorkspaceManifest.make({ name: "@acme/core", dependencies: { lodash: "^4.17.0" } }),
    ]);

    return { versions, workspaces: named.workspacePackages.length, valid: report.valid };
  });

  Effect.runPromise(program).then(console.log);
  ```

  `LockfileFormat` carries `filenameFor` / `fromFilename` so a consumer that detected a package manager never hard-codes a filename.

  ### Typed failures, no silent wrong answers

  `Lockfile.parse` fails two ways: `LockfileParseError` (invalid content, with `stage` distinguishing a syntax failure from a shape failure) and `LockfileFramingError` (the text parsed but no single lockfile document could be located). The framing error exists because `pnpm-lock.yaml` is a YAML *stream* — pnpm 11 writes a config-dependencies preamble ahead of the lockfile, and the lockfile is deterministically the last document. A stream carrying no lockfile document fails typed rather than degrading into an empty `Lockfile`; yarn multi-document content fails with `"unexpectedDocuments"` rather than being silently truncated. Yarn support is Berry only, and classic v1 fails typed instead of mis-normalizing. [#81][#81]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/jsonc  | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/npm    | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/semver | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/yaml   | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
