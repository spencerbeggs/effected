---
"@effected/workspaces": minor
---

## Features

### `ImportGraph.reachability`

`@effected/workspaces/testing` gains the import-graph checks a one-file rule cannot express. `ImportGraph.reachability` walks from entry files through relative imports and reports every forbidden specifier a reached file imports, with the chain of files that reaches it. A directory rule approximates reachability, but a refactor that adds a new static path from the root entry into an allowed directory still passes it; the walk follows the real edges. Specifier matching is `forbidImports`' own: exact, subpath, or a trailing `*` prefix. Each file is visited once through its realpath, so a symlink loop terminates and a diamond reports one shortest chain, and a relative import no candidate resolves lands in `unresolved` rather than dropping the graph behind it silently. An entry that resolves to no file fails `EntryNotFoundError`, and an empty entry list fails `NoEntriesError`: the walk never proves nothing silently. `followPackage` is the extension point for walking into workspace packages. Closes #966.

### `ImportGraph.undeclared`

`ImportGraph.undeclared` checks each workspace package's runtime sources against its own manifest: every literal specifier whose package is not in `dependencies` or `peerDependencies` is reported with the package, the file and the specifier. Workspace hoisting resolves such an import at edit time, and only a packed install caught it before, far too slow for the edit loop. A `node:` specifier is always a built-in, and a caller spreads `builtinModules` from `node:module` for the bare spellings, since no built-in list ships here. Relative specifiers, `#` subpath imports and a package's self-reference are never flagged. Type-only imports are erased by the compiler and never flagged; a dynamic `import()` with a literal counts as runtime. `include` globs (default `src/**`, walked from each glob's static prefix) name the runtime sources, so test files importing devDependencies stay out of scope by design.

Both checks are static analysis of literal specifiers, with no dynamic-import guarantee: a computed specifier is invisible to them, and `PackedInstall` remains the proof of what actually resolves at runtime. Both reuse `SourceBoundary`'s lexer, and its scan now shares one source-tree walker with them, so the three cannot drift on symlink loops, `node_modules` or what counts as a source file.
