# Proving a suite can fail — the mutation discipline

Loaded from `effect-v4-testing`. The rule in one line: **a test that cannot
fail is worse than no test**, and the only thing that tells you which is which
is a mutant.

## A test that cannot fail is worse than no test — mutate the edges

A green suite proves nothing about the properties no test can observe. Over
one migration (`@effected/walker`), **eight** distinct mutants each survived a
fully green suite — no short-circuit, dropped first match, last-instead-of-first
directory, wrong iteration order, dropped error absorption, dropped `stopAt`,
whole-chain probe instead of anchored root. Every one had the same shape: **the
tests exercised the middle of a range and never its edges.** Two of the eight
were real behavioral bugs waiting to be introduced, and two of the holes
predated the migration — 120 inherited tests passed unmodified while unable to
catch a regression in either property.

For any test walking an ordered collection, check:

- Does a winning case land on the **first** element? The **last**? A **middle**
  one? (An implementation that probes everything and picks the first hit passes
  every suite whose only order-observing test wins on the last candidate.)
- Is there a case with **more than one** of every dimension the code iterates —
  e.g. several directories × several candidates per directory? Interleaving
  bugs are invisible until both dimensions are plural.
- Is every **failure path** in a fixture actually exercised, or does every
  fixture succeed?
- Is the property pinned through the **public seam the consumer calls**, or
  only through the primitive it delegates to? A property proven on `firstMatch`
  says nothing about `findUpward` unless a test crosses that seam.
- For an option like `stopAt`, does any test place the target **beyond** it, so
  the option must actually do something to pass?

The discipline, before committing a test you believe pins a property:

1. **Capture a baseline** — `git status --porcelain > /tmp/mutation-baseline`.
2. **Break the implementation** in the way the property forbids, **with the
   editor**. Never `git checkout` / `git restore` / `git stash`: other people's
   uncommitted work lives in this tree, and those commands destroy it.
3. Watch **that exact test** go red — and check *why* it went red (see below).
4. **Revert the mutation**, again with the editor.
5. Confirm the status now **matches the baseline**.

Step 5 is a comparison, **not** a check for an empty tree. Legitimate
uncommitted work is normal and expected; a clean-tree assertion would fail for
anyone who has any, and would tempt them to "clean" it. What you are proving is
that you left the tree exactly as you found it:

```bash
git status --porcelain > /tmp/mutation-baseline   # before
# … mutate, run, revert …
diff <(git status --porcelain) /tmp/mutation-baseline && echo "tree restored"
```

Suite strength is not predictable by grepping `__test__/` — a mutation in one
module may be caught by tests that never name it, because a shared test layer
routes through it. Only the mutant tells you.

### Sweeping many mutants: assert the on-disk state on EVERY run

A scripted sweep — apply mutant, run, revert, repeat — has one failure mode the
single-mutant loop does not: a **stale restore**. If one revert lands
imperfectly, every subsequent run measures a file that is neither the original
nor the intended mutant, and the results are nonsense that looks like data. It
happened in the github-actions sweep, and the sweep was correctly **re-run**
rather than reported.

So each iteration asserts what is actually on disk before it trusts its own
result: read the target file back and confirm it contains the mutation (before
the run) and matches the baseline (after the revert). `git status --porcelain`
compared against the captured baseline is the outer check; the per-file read is
the inner one, and the inner one is what catches a revert that restored the
wrong bytes.

### The rule with no input that could falsify it

The commonest defect a sweep finds is **not** a missing test. It is a rule that
was written deliberately, is covered by tests that pass, and that **no fixture
can make fire alone**. One branch produced five instances of it in a session.

> **A passing test is evidence about the path it takes, not about the rule it
> appears to test.**

The question to ask when you write a rule is therefore not *"is there a test for
this?"* but **"what input would make this rule fire alone, and does it exist?"**
If you cannot name that input, the rule is decoration regardless of suite
colour. The input you need is one that is **wrong in exactly one way**.

The five shapes it wears, all the same defect:

| Shape | Why nothing could falsify the rule |
| --- | --- |
| **Sibling clauses mask it** | Identity settled by three `hasOwn` conjuncts; every impostor fixture was caught by one of the other two, so the third could be deleted freely. |
| **Every near-miss misses twice** | A `format` clause where every candidate fixture *also* omitted a second required field — so the fixture failed for the other reason. |
| **One of two code paths** | Compose-then-verify ran on two paths; only one had a composition that matched nothing, so dropping verification on the other path changed no test. Fixed by adding one edge (`phantom: 9.9.9`) that misses on that path. |
| **A depth never reached** | A walk-up loop where no fixture required an intermediate ancestor — the loop's whole point was untested. |
| **Two rules, one assertion** | One test asserting both rules goes red for either and proves neither. The fix is to **split the assertion**. |

The detection methods follow from the shapes:

- **Mutate per clause.** Delete each conjunct of a predicate independently. A
  clause a sibling always shadows is one nothing can falsify.
- **Mutate per path.** **Two code paths implementing one rule are two things to
  pin, not one.** A test covering *a* path through a rule does not pin the rule;
  break the rule separately on each path.
- **Enumerate the ways the rule can be REACHED**, not only the ways an input can
  be wrong. Per-clause mutation catches rows 1–2; per-path mutation catches
  row 3.
- **One assertion, one rule.** If a single assertion would go red for two
  independent reasons, split it before you trust either.

The common failure underneath all of it: believing a rule is pinned because
something red goes green when you break it — **without checking *which*
something**, and whether it fails for the rule you meant.

### Before acting on "nothing found", run a control that FIRES

**An absence result and a broken query are indistinguishable at the call site.**
A surviving mutant, a grep returning zero, a `str.replace` that matched nothing
and a projection that dropped the field all produce the same shape as a true
negative. Verification and review work is disproportionately made of absence
claims — "no stale references remain", "no test regressed", "the mutant
survived", "the field is not in the artifact" — and each is worthless without a
control.

> Before acting on "nothing found", run the same query against something you
> know is present. A query that cannot find the thing that *is* there cannot be
> trusted to report the thing that is not.

Three sharp riders:

- **The control's expected answer must be NON-ZERO.** A control that returns
  zero when zero is correct looks exactly like success on a broken query.
- **The control must vary ONLY the thing under test** — and that means running
  it against a **known-good input**, not the input that surprised you. A control
  run on the suspect input cannot separate "the tool is broken" from "this input
  is special", so it will happily confirm whichever you already believe. This is
  the rider that gets skipped, and it is the one that fails: a `grep -c ""`
  returning nothing was once read as proof that `grep` was broken, when it had
  been run against the single pathological file that caused the original
  mystery. The tool was fine.
- **Distinguish a wrong pattern from a wrong tool before you switch tools.** A
  wrong pattern is corrected by re-reading the file format. A tool genuinely not
  matching invalidates every negative it produced, however the query was
  written — but that verdict needs a known-good control behind it, because
  "switch to `rg`/`sed`/`node`" is a permanent tax to hand the next reader on a
  misdiagnosis.

The pathological input worth knowing by name: **a single NUL (`U+0000`) byte
makes a file binary to `grep` and `rg`, which then skip its contents.** Measured
on two files differing only by that byte, `grep` prints **nothing and exits 1** —
byte-identical to a real no-match — while `rg` reports `binary file matches`.
`grep -a` / `rg --text` search it correctly. A NUL lands in a source file
legitimately (a delimiter inside a template string), so suspect the **file**
before the environment.

**Empty output means the experiment did not distinguish your hypotheses.** A run
that printed nothing is not a result; it is a failed experiment, and it is
consistent with the mutant surviving, the filter being too narrow, the reporter
being wrong, the invocation selecting no test, and the input being
unsearchable — all at once. So **scope the suspicion to the INPUT before the
tool**: the file, the fixture, the filter, the invocation are all cheaper to be
wrong about than the toolchain, and indicting the toolchain first is what
manufactures a permanent workaround for a problem that does not exist. What
tells the two apart is a control on a **known-good input**; until you have run
one, you have a question, not a finding.

What survives from the older, tool-first phrasing is the operational half:
re-run **unfiltered** before drawing any conclusion, and **a mutant that
produced no output has not been shown to survive.** Silence is never evidence of
survival — see [how to read the run](#how-to-read-the-run-the-failure-text-never-a-missing-pass-line).

The discipline pays directly in mutation work: a surviving mutant is only
*found* by probing the drop against a case known to exercise it, never by
observing that no test went red. Likewise a suppression claim holds only if you
first ran the fixture **without** the suppressing rule and watched the row
appear.

### A surviving mutant is a question about the CODE, not the test

The reflex on a survivor is to strengthen the test. Ask first whether the
mutated behaviour was ever **required** — a mutant nothing can observe is
sometimes telling you the code path has no consumer, and the honest resolution
is to delete or narrow the code rather than to invent an assertion that pins an
accident. That question was worth asking of a `layer` static in the
github-actions work; it is worth asking every time, before writing a test whose
only purpose is to make a mutant die.

Two legitimate outcomes besides "strengthen the test": **remove the code** the
mutant proved nobody needs, and **report it as unpinnable** (see below). Only
the third outcome — a test written for the sake of having one — is always
wrong.

### When two reads of one file disagree, settle against the committed blob

A sweep runs greps constantly, and sooner or later two of them contradict each
other about the same file — one says the export is there, one says it is gone.
That is not a puzzle to reason about; it means the working tree changed between
the reads (a half-applied mutant, a concurrent edit, a stale revert). **Settle
it against the committed blob** — `git show HEAD:<path>` — and re-read the
working tree fresh, then reconcile the difference deliberately.

The rule exists because the alternative is so easy: pick whichever read
supports the conclusion you already reached, and continue. That is not a
judgement call, it is a coin flip recorded as evidence.

### Mutation is DISCOVERY, not confirmation

Do not run the mutant expecting to watch it go red. Run it to **find out** — in
one session it turned up three separate tests that were green, plausible, and
**structurally incapable of failing**. None was found by reading the test.

### How to READ the run: the failure text, never a missing pass line

A mutation run is verified when you have **seen the assertion message** and it
names the property you expected to break. Inferring the catch from the *absence*
of a pass line is the same defect the technique exists to expose: evidence-shaped
output carrying no information.

Twice in one branch a run's failure text was swallowed by a too-narrow grep, and
the empty result was nearly recorded as "the mutant was caught." Both runs had
genuinely failed — the evidence simply was not in the filtered output.

The operating rules:

- **Empty output is a failed experiment, not a surviving mutant.** Re-run
  unfiltered before drawing any conclusion — and scope the suspicion to the
  input (the filter, the invocation, the fixture) **before** the tool. Full rule
  → [run a control that FIRES](#before-acting-on-nothing-found-run-a-control-that-fires).
- **Grep for the test NAME or the file, not for a phrase you expect in the
  failure.** You do not know what the failure will say — that is why you are
  running it — and a pattern written from your expectation matches only the
  outcome you already assumed.
- **Read the Tests line every time.** `0 tests passed` or a filter that matched
  no test is a run that never happened; see
  [false-greens.md](./false-greens.md).
- **Quote the message when you report the result.** "Mutant caught" with no
  quoted assertion text is an unverified claim; write it down as unverified
  rather than letting it read as established.

**The assertion must DISCRIMINATE.** After mutating, it is not enough that the
test fails; confirm it fails **for the right reason**.

- A retry test asserted `attempts() === 2`. That was true whether the delay was
  the correct exponential backoff **or a negative (hot-loop) sleep** — the
  mutant survived, because the assertion could not see the thing under test.
  Fixed by pinning the **timing**: advance 500 ms and assert the retry has *not*
  fired yet.
- A `readPatterns` test passed **for the wrong reason entirely**. With the
  mutation applied, discovery re-read the root `package.json` and failed at a
  *different site* with the same error `kind` and the same `path` — so the
  assertion still matched. The branch under test was simply **not observable
  through the public surface**; the test had to be rewritten against the internal
  function directly. A test that fails for the wrong reason is as dangerous as
  one that cannot fail, and it looks even better.

**Never verify a change by grepping for the text you just wrote.** An
`invalidShape` discriminant was added to a union but **never emitted**. The test
asserted the *old* value (`invalidJson`) and passed happily — precisely *because*
the new value was never produced. The agent had "verified" the change by grepping
the declaration line. Grep finds the declaration; only a mutation finds the
**emit site**. Verify behaviour, not text.

**Some correct changes cannot be pinned — say so.** A semantics-preserving
performance fix (e.g. `shift()` → a head index) **correctly survives every
mutant**: it changes no observable behaviour, and a timing assertion that "proved"
it would just be flaky. Report it honestly as **fixed but unpinned** rather than
inventing a test that proves nothing. A test written only to have a test is a
future maintainer's false confidence.
