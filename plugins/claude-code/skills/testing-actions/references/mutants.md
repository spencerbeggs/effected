# Discriminating mutants for this domain

Load when: writing or reviewing a test that claims to guard one of these
behaviors, and wanting the specific mutation that must turn it red. General
mutate-the-edges discipline (baseline, mutate, watch red, revert, confirm
against the baseline not an empty diff) is `effect-v4-testing`'s; these are
the domain instances, each written as a scenario a passing suite must
actually catch.

- **The `ConfigProvider`-stub false green.** A suite that injects its own
  `ConfigProvider` to stub an action's inputs — without touching
  `process.env` — replaces exactly the seam a bare `Config` read breaks in
  production. This is not hypothetical: a real action's input read
  compiled clean and passed a suite keyed by the plain input name, because
  the test's provider and the production read agreed with each other and
  never had to agree with the runner. Under the runner the key is
  mangled (dashes intact, spaces to underscores); the bare read found
  nothing; a default swallowed the absence; a dry-run input meant to guard
  a mutation ran the mutation for real. At least one test per action must
  exercise input injection with the **runner-mangled** key — never the
  input's plain name, never a hand-underscored guess — because that's the
  only case where the test's key and the production mangling have to
  actually agree.
- **The pid guard.** Mutate a detached-process reap's pid-validation
  rejection away, and the "without signalling anything" assertions must go
  red — a test that only checks the effect failed would pass against an
  implementation that signals the whole process group and *then* reports
  an error. The discriminating assertion is on the spy showing zero calls,
  not on the failure alone.
- **The envelope magic.** Mutate the blob envelope's magic-byte prefix, or
  its comparison at decode time, and both the round-trip test and the
  legacy-detection test must go red.
- **The `INPUT_` mangling.** Mutate the input-variable derivation to also
  uppercase dashes, and an assertion pinning a mixed-case, dash-containing
  input name must go red — the regression this catches is a consumer
  reading the wrong spelling from the environment and shipping it.
- **The `withEnv` scoping.** Mutate a save/restore-over-shared-global
  implementation to drop its scoping discipline, and the two-latch test
  must go red; a single-latch version of the same test would stay green
  against the same mutation, which is exactly why one latch isn't enough.
- **The hex-vs-binary digest.** Feed a file-hashing routine a per-file
  digest as hex text instead of raw binary, and a pinned literal digest
  must go red against the wrong-way digest — the literal is pinned rather
  than recomputed specifically so a copied mistake in the test itself
  can't reproduce the same bug and pass anyway.
- **The tool-cache stage-then-swap.** Break the stage-then-rename sequence
  so a failure leaves a partial directory behind, and the "leaves no
  staging directory behind after a failure" assertion must go red — a
  presence check that treats any hit as a complete install is exactly the
  defect this guards against.
- **The `R`-widening type-level mutant.** Narrow a layer option's type
  parameter that's supposed to admit extra requirements back down to
  `never`. This one must fail **compilation**, not an assertion — the
  right shape for a regression whose original defect was a type constraint
  a consumer once worked around with a hand-written comment instead of a
  real fix.
