# Probe venues and mechanics

The `SKILL.md` lists the six probe preconditions. This reference holds where a
probe file may live, how to run each kind of probe, and the controls that
prove it can fail.

## Two things called "scratchpad"

The agent harness hands most sessions a private scratch DIRECTORY for temporary
files (an absolute path under `/tmp` or similar, named in the system prompt).
That directory has no `node_modules`, and a probe written there dies with
`ERR_MODULE_NOT_FOUND: Cannot find package 'effect'` — precondition 3's
failure, reached by a route that feels like following the rules. A probe
written to the harness scratch directory fails to resolve `effect`, and the
identical file copied into a package root runs.

Some repositories instead ship a dedicated probe **workspace member**: a
private package with the workspace's packages at `workspace:*` and `effect` at
the catalog's resolution, usually with scripts to run a probe file, a
test-shaped probe and a type check. Where one exists, follow its own docs for
the commands; it is gitignored and disposable, so the placement and
delete-by-absolute-path rules below do not apply there. Every other
precondition (print the resolved version, run the control first, exercise a
non-first member) applies unchanged in either venue. Its type check is the only
proof of a does-this-compile question there: tsx and vitest strip types without
checking.

## The subject decides the venue

| the probe's subject | venue |
| --- | --- |
| `effect` itself, or a **published/built** workspace package | a probe workspace if the repo has one; deep-import the built `dist` entry for the built answer |
| the package's **OWN uncommitted `src/`** | **the package root** — a probe file at `packages/<pkg>/probe.ts` importing `./src/…` relatively |

The second row is the one agents get wrong: a probe workspace sees committed
and uncommitted `src/` alike through the link, but it carries its own config
and tsconfig, so a probe there does not exercise the package's own
`tsconfig.json`, `effected.toml` or test setup. Use the package root when the
answer depends on those; build the package and probe its `dist` when you want
to know the *built artifact* behaves that way.

## Riders on the package-root form

- **A `__probe__/` (or any) subdirectory is wrong twice.** It is precondition 3's
  silent false-pass — the tsconfig `include` is `${configDir}/*.ts` and does not
  match subdirectories, so the file leaves the compilation program and its
  control never fires — and a directory is easier to forget than a file.
- **Delete by absolute path, and `git status --porcelain packages/<pkg>` before
  you report.** The package root is committed ground.
- **Probing a package's OWN engine/internal modules: use `npx tsx` — still from a
  file inside the package.** `npx tsx packages/<pkg>/probe.ts` resolves the
  `.js`-extension TypeScript imports correctly and runs without a test project.
  A probe in `/tmp` dies with `ERR_MODULE_NOT_FOUND` the moment anything in its
  import graph names `effect` bare (the entry's own imports resolve from `/tmp`,
  which has no `node_modules`).
- **Never name a probe `*.test.ts`**: one scratch test file with a load-time
  error fails the package's whole run (`✗ test suite failed to load`, exit 1 —
  see `effect-v4-testing`).

## Running a probe

```bash
cd packages/<pkg>
node -e 'console.log("resolved effect:", require("effect/package.json").version)'
# write packages/<pkg>/probe.ts (NOT a temp dir — see precondition 3), then either:
pnpm exec tsc   # type-level probe
node probe.ts             # behavioural probe; Node runs TS directly
rm -f "$PWD/probe.ts"
```

**Run `tsc` BARE — never pass the probe file as a CLI argument.** Under
TypeScript 7 a found tsconfig plus CLI file args is a hard error
(`TS5112: tsconfig.json is present but will not be loaded if files are
specified on commandline`). The bare form compiles the package's own program,
which includes a root-level probe. If a file argument is genuinely
unavoidable, `--ignoreConfig` proceeds — but it abandons the package's
tsconfig, so the bare form stays canonical.

A type-level control that works — shown as `text` because it exists to fail
the typecheck:

```text
import { Effect } from "effect";
const control = Effect.catchAll; // a name that does not exist; must fail
// probe.ts(2,24): error TS2339: Property 'catchAll' does not exist on type 'typeof Effect'
```

Inside a probe **file**, print the version with an import, not `require` — a
`require` alongside a top-level `await` makes the module format ambiguous and
Node refuses to run it (`ERR_AMBIGUOUS_MODULE_SYNTAX`). The `require` one-liner
above is fine because `-e` has no `await`.

```ts
import pkg from "effect/package.json" with { type: "json" };
console.log("resolved effect:", pkg.version); // must equal the installed (lockfile) effect and the vendored tag
```

## A behavioural control

For a **behavioural** probe, "must fail" is the wrong control — invert it and
prove the probe can *observe the effect at all*. A probe asking "does a defect
roll the transaction back?" reads success as *zero rows*, and zero rows is also
what a broken harness prints; the control that rescues it is a **committing**
transaction that must leave its row behind. Ask what a silently-dead probe
would print, and make the control the thing that distinguishes it.
