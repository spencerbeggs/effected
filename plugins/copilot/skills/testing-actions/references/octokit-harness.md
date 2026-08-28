# The octokit harness, and real IO where the claim is about IO

Load when: writing a test against `@effected/github` that needs the real
request path, or deciding whether a test needs real IO (filesystem, HTTP,
a real subprocess) versus an in-memory double.

## The octokit harness — drive the REAL client, not a double of it

`@effected/github` tests never stub `GitHubClient`. They replace octokit's
documented `fetch` option so the real request path — route interpolation,
retry, classification, Link-header pagination — executes end to end:

```ts
export const harness = (replies: ReadonlyArray<Reply>): Harness => {
  const script = scriptedFetch(replies);
  const base = Layer.mergeAll(
    GitHubClient.layerFromToken({
      token: Redacted.make("ghs_test"),
      fetch: script.fetch,
      retry: RetryPolicy.none,
    }),
    Repo.layer(REPO),
  );
  return { script, base };
};
```

Two facts cost real debugging time before the harness accounted for them:

- **A hand-built `Response` has `url === ""`.** octokit's paginator
  constructs a `URL` from the response's own `url` for any payload
  carrying a total-count field, which throws on an empty string —
  classified `kind: "transport"`, naming neither octokit nor the
  paginator. Define the `url` property explicitly on the fake response.
- **octokit percent-encodes path parameters.** A ref like `heads/main`
  goes out as `heads%2Fmain`. Assert against the harness's decoded
  recorded path, never the raw `url` field.

`GitHubApp` tests generate a real RSA key and sign for real — the JWT
signing path is exercised, not assumed.

## Real IO where the claim is about IO

- **HTTP goes through the real fetch client**, so request construction,
  status mapping and body decoding execute for real, even against a
  scripted `fetch` implementation.
- **`ToolInstaller` runs under the real Node services layer against real
  `tar`** — a stubbed filesystem or a fake spawner cannot prove
  stage-then-swap survives a partial failure, or that `tar` actually
  accepts the assembled arguments. Use the live test variant, not the
  virtual-clock one, for anything touching a real filesystem and a real
  child process.
- **In-memory doubles are strictly MORE permissive than the runner —
  round-trip state claims through the real layer.** A map-backed state
  double happily stores any object; the runner writes a file, so a value
  survives only what JSON serialization preserves. A state field using the
  wrong `Option` encoding once passed every in-memory test and failed on
  the real runner one phase later. The regression harness that catches
  this class: a temp file standing in for the runner's state file, backed
  by the real state layer, saving in one scope and reading back in a fresh
  one — the double proves the logic, only the real layer proves the
  serialization.
- **Faulting one member of a REAL service**: wrap the live service and
  override just the one member via a layer provided AFTER the real
  platform layer in the merge — real IO everywhere except the one observed
  call. First-try shape for "prove this one member was (not) called"
  without giving up the real filesystem underneath it.

## The actions-specific instances of general traps

**A platform services layer provides several services at once, and in a
merge the LAST provider of a duplicated service wins.** An action test
usually needs a real filesystem and a scripted child-process spawner
**simultaneously**, so this collision is the normal case, not an exotic
one — merging the scripted spawner before the platform layer silently
replaces the script with the real spawner. A downstream suite wired
exactly that way once shelled out to a real build command and passed, with
correct output; the only tell was duration — seconds instead of
milliseconds. Put the platform layer first and the scripted double after
it (or provide it separately), and assert the script actually recorded
calls. **Green plus fast is the signal; green alone is not.**

**Mutating `process.env` between reads inside one test file is not a loud
failure — it is a quiet false green.** The environment is seeded once, at
layer construction, so every later read in the process returns the first
case's value. A parameterized suite injected that way can go fully green
while several cases assert against the wrong input and the rejection cases
never see theirs at all. Inject inputs per case instead of mutating the
process environment — the tell, when this happens, is every case passing
while the fixture values differ, which is worth one skeptical read.

**A test double that seeds the same default value production code falls
back to is a false green for a default-on-absence test.** Testing an
absence path needs a genuinely empty environment double, with the seeded
default reserved for the override case — otherwise the assertion passes
whether the default logic exists or not.

**Two latches minimum for a concurrency-leak test.** A single-latch
interleaving test can PASS against a deliberately wrong save/restore
implementation, because save/restore over a shared global is
order-correct whenever two overrides happen to nest cleanly. The
discriminating order forces one fiber to read while the other's override
is still applied and unrestored — that needs two latches, not one.

**Acquire/release a spy on a process global with a scoped
acquire-use-release, never `try`/`finally` inside a generator.** A failing
assertion leaves through the error channel, so the `finally` never runs the
way the shape suggests, and a spy that survives its own test poisons the
control that proves a guard isn't simply refusing everything.

**Read the reporter's unhandled-errors list, not just the pass count.** It
is what catches a detached spawn that reports its own failure correctly
through the typed channel and then, asynchronously, kills the action
through an unlistened error event on the underlying process — a fully
green suite can carry that live defect with nothing in the pass/fail
counts showing it.

**Reachability/structural scans strip line comments before block
comments, and the stripper needs its own discriminating test.** Getting
the order backwards fails in the *safe* direction — a silent false
negative — which is the worst direction for a confinement test, since the
scan exists to catch broadening, not narrowing.

## Running a subset

Subset runs must be root-relative, and parallel agents need coverage
disabled:

```bash
# from the workspace root — <package-dir> is one of these four packages' directory
pnpm vitest run <package-dir> --coverage.enabled=false
```

A project-filtered run from **inside** a package prints a zero-tests-run
line and exits 0 — read the tests-run line, not the exit code. Concurrent
agents collide on a shared coverage-reports directory without the flag.

**Known rough edge, so nobody chases it as a regression:** a config error
propagating into a failed assertion has been observed to report an
unserializable-cause line in the test reporter's rendered output. The
failure is still real and still visible via captured console output even
when the top-line message renders that way — treat that line as "go look
at the console output," not as "the test did not fail." This is reporter
behavior, not a package API contract.
