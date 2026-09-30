# Running the suite — zero-collection, cwd, stale dist and probes

Loaded from `effect-v4-testing`. How to read a vitest run without being lied
to, and how to probe without leaving files behind.

**Zero collected tests is never a pass — read BOTH the Tests line and the exit
code.** A filter that matches no test file prints `Tests: 0/0 passed` and exits
**1**: the Tests line is the liar and the exit code is honest. A test file that
throws at load time is reported as `✗ test suite failed to load`, naming the
file and the throw, and exits 1. A passing subset run under `--coverage` exits
0, because the `@vitest-agent/plugin` reporter skips thresholds on partial runs
(`Coverage thresholds skipped: partial run`). Treat any disagreement between
the two signals as the alarm. Read `unhandledErrors` alongside both: a
`ChildProcess` with no `error` listener re-throws asynchronously *after* the
failure was correctly reported, and 15 green tests carried a live defect that
only that field showed.

**Run vitest from the repo root.** From inside `packages/<pkg>`, vitest does
not load the root config: it runs with the package directory as its root, so
the repo's projects, setup files and reporter are all absent. A bare
`vitest run` there still runs that package's files under default settings,
while `vitest run --project @effected/<pkg>` fails at startup with
`No projects matched the filter` (exit 1). From the root, `--project <name>`
selects one project. A positional arg is not a path: it is a **substring
matched against each test file's path**. `ckfiles` selects `@effected/lockfiles`'
tests from the root, which path resolution would not predict. Never
`--passWithNoTests` — it is the one flag that turns a zero-match run green
(exit 0).

An `ERR_LOAD_URL` naming a `vitest.setup.ts` inside a package directory means
the config declares `globalSetup` as a cwd-relative path. Resolve it against
the config file (`fileURLToPath(new URL("vitest.setup.ts", import.meta.url))`).
The setup file it names is not one you were meant to create; creating it forks
the setup permanently.

**The stale-upstream-dist red herring** (a red that lies rather than a green):
in a kit monorepo, a downstream package's tests resolve workspace siblings
through their BUILT dist (the lockfile links `version: link:../npm/dist/dev/pkg`),
so adding an export to an upstream package makes every downstream suite fail
to LOAD with `Cannot read properties of undefined (reading 'ast')` — the new
export exists in source, is `undefined` in the stale artifact, and the schema
built from it dies at module load pointing nowhere near the cause. When you
add an export to an upstream kit package, `pnpm build --filter <upstream>`
before running any downstream suite; that error message at suite load IS the
stale-dist signature.

## A probe writes no file

A temporary probe left under `__test__/` is
collected by the ordinary suite and inflates the `Tests:` count, and that
inflation is indistinguishable from added coverage — which is exactly what a
count-delta review ("+5 new, −1 removed, no assertion changed") depends on.
**Do not fix this with an exclude pattern**: an exclude catches only names
someone predicted and fails silently when it misses. Instead run the probe as
a script that never touches disk, **from inside the package**:

```bash
cd packages/<name> && node --input-type=module -e '<script>'
```

`-e` writes nothing. Running from inside the package is what makes bare
specifiers (`effect`, a workspace sibling) resolve: under pnpm's store layout
the **importer's** location decides resolution, so the same script run from
the repo root fails with `ERR_MODULE_NOT_FOUND`. If a probe genuinely needs a
file, put it in the repo's sanctioned scratch venue (in this monorepo,
`scratchpad/`), never in `__test__/`. The zero-collection warning from
`@vitest-agent/plugin` is a backstop, not the mechanism.
