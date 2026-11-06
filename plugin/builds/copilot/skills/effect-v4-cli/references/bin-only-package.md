# A bin-only CLI package

Loaded from `effect-v4-cli`. Covers `emitDts = false`, the `exports: "./package.json"` shape, and why `Cannot merge zero API models` is not an extractor bug.

## A bin-only CLI package: `emitDts = false`, `exports` = `./package.json`

A CLI that exports nothing for import — `bin` only — is a legitimate package
shape, and the build pipeline has an opinion about it. With `exports` limited
to `"./package.json"` and no `index.ts`, the default `effected package build`
still runs the declaration pass and then the prod meta (API Extractor)
pass over **zero** entry points, and dies with the opaque
`Cannot merge zero API models`. The switch is `emitDts = false` under
`[package.build]` in the package's `effected.toml` — meant for JS-only
artifacts that never consume declarations (bins, internal tools) — which skips the dts pass and, with nothing to read, the
meta pass, while still emitting JS, the byte-variant targets and the
transformed `package.json`:

~~~toml
# effected.toml of a bin-only package
[package.build]
emitDts = false
~~~

Three consequences follow, and each looks like a gap until you know why:

- **No `_base` suppression, no `tsdoc.json`, no api-extractor model, no
  website page.** There is no `.d.ts` to extract from. The documentation is
  `--help`, the README and the library page of the package the bin fronts.
- **Every type a consumer's config file needs comes from the library
  package**, never from the bin — a bin-only package has no import surface,
  so `defineConfig`-style helpers live in the sibling library.
- **Tooling that enumerates packages by their doc model must exclude it**,
  or it reports the bin as a perpetually missing build. The test is the
  `exports` map: every key is `"./package.json"`.

The trap this replaces: reading `Cannot merge zero API models` as an
extractor bug, or as a sign the bin needs an `index.ts` to satisfy the gate.
See `effect-api-extractor-bases` for how the gate reads for the *other* case.

## A bin that also runs from source

A repository whose root depends on its own carrier through `workspace:*` runs that carrier's bin from source. `node_modules/.bin/<tool>` under a hook, an MCP loader or a bare shell gets no `nodeOptions`, and the run then dies with `ERR_MODULE_NOT_FOUND` naming a `.js` file under a linked package's `src/`. So the bin file registers tsx itself, before anything resolves a sibling's source, with every other import dynamic and `tsx` as a root devDependency:

~~~ts
#!/usr/bin/env node

// Linked source needs tsx, and a pnpm script loads it through nodeOptions. A direct run of the bin does not, so it
// registers tsx here, before anything resolves a sibling's source. A built `.js` bin never takes this branch. tsx is
// the workspace root's alone, and the specifier is computed because rolldown inlines a literal, or a const it can fold,
// into the published package.
if (import.meta.url.endsWith(".ts")) {
  const tsx = ["tsx", "esm", "api"].join("/");
  const { register } = (await import(tsx)) as { readonly register: () => void };
  register();
}

const { main } = await import("@effected/cli/main");
~~~

The last line is the kit's own; import your front end's entry there. A static import would resolve before the branch runs. `.bin/<tool>` then works outside pnpm, and no e2e harness needs an absolute loader.

**Every `.tsx` file in such a repository starts with the pragma:**

~~~tsx
/** @jsxRuntime automatic */
~~~

tsx applies one tsconfig per process, found from the working directory, and only to files that tsconfig includes. Without the pragma, a linked package's JSX run from a root whose tsconfig does not include it compiles to classic `React.createElement`: a TTY run of a live view warns `React is not defined` and loses its output, the run still exits 0, and a captured run stays green. `register()` takes a `tsconfig` option, but one tsconfig cannot serve every linked package, so the bin calls it bare; a root tsconfig whose `include` reaches package sources works from the root and not from inside a package with its own tsconfig. Built output is unaffected. The kit tracks no `.tsx` under `packages/*/src` and `cli-kit`'s views are plain `.ts`, so the kit's own suite does not exercise this.
