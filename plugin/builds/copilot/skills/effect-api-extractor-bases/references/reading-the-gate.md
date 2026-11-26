# Reading the gate without fooling yourself

`issues.json` is a **false-green oracle**. Four rules:

1. **Build through Turbo.** `pnpm build --filter <pkg>` from the workspace root
   runs `types:check` first and caches. A direct `effected package build` in the
   package directory is allowed but skips that gate and the cache, so a type
   error the typecheck would have caught surfaces as an API Extractor failure
   instead.

2. **A crashed build can leave every bucket empty** — byte-shaped exactly like
   a perfectly clean gate. **Read `buildOk` first**: `false` (with `failure`
   saying why) or a missing stamp means the buckets are not evidence. An
   unexpected `suppressed` count is a second tell: counting only
   `source: "api-extractor"` entries (tsdown advisory noise such as
   `TSGO_EXPERIMENTAL` lands there too), a package with class factories has at
   least one `_base` entry per factory. Never conclude "clean"
   from empty buckets alone; `building-a-package`'s reading-issues reference
   has the full read order.

3. **An incremental build can hide warnings.** A stale `dist/.tsbuildinfo.lib`
   feeds API Extractor an old `.d.ts`, so a warning present in a cold build is
   absent from the incremental one. Read the gate from a cold build (`rm -rf`
   the package's `dist` first) whenever the answer matters.

4. **Concurrent agents corrupt each other's gates.** `dist/` has no lock:
   two sessions building the same package (or one running `rm -rf dist &&
   build` while another reads) produce torn artifacts that read as rule 2's
   clean-shaped truncation — what looks like a nondeterministic bundler flake
   is usually contention. Treat any `issues.json` read as suspect unless it
   immediately follows YOUR serial, cold, exit-0 build of that package. And
   **never `pkill -f` a shared build-tool pattern** such as
   `pkill -f "effected package build"`: it kills other sessions' legitimate
   builds. Kill your own child process by PID or not at all.

`dist/` is gitignored and shared. It carries no commit, no cleanliness, and no
exit-code provenance, so it is only evidence when *your* build exited 0 against
a clean tree with nothing else building. If you mutate source to prove a fix is
load-bearing, **rebuild afterward** — otherwise you leave an artifact that
describes a tree no commit ever contained.

## `issues.json` lines point at the `.d.ts`

Its `file` names the source, but its `line` indexes the **generated `.d.ts`**.
Locate a `tsdoc-*` or `ae-unresolved-link` defect textually, not by jumping to
that line number — the position routinely lands on a class declaration thirty
lines from the offending comment.

## Dollar-alias names are correct output

Core's dollar-alias export names surface verbatim in built declarations — a
`Schema.Array` field emits as `Schema.$Array<…>`, `Schema.Record` as
`Schema.$Record<…>`. That is correct output; do not "fix" it, and do not read
it as a wrong import in the source.
