# Testing — @effected/markdown

Child context file for the conformance corpora and the oracle. The rules live in
the parent; this is what actually runs.

**Parent:** [CLAUDE.md](./CLAUDE.md)

---

Five vendored corpora, each pinned by a `VENDORED.md` (upstream repo, ref,
license), all with **empty skip maps**:

1. **CommonMark spec.json 0.31.2** — all 652 examples, zero skips, zero
   deferrals, via normalized-HTML equivalence against the test-only writer.
2. **GFM spec extension sections** (cmark-gfm 0.29.0.gfm.13) — 22/22. It is 22,
   not 24: the two task-list spec examples are disabled upstream.
3. **cmark-gfm `extensions.txt`** — 30/30, the only official footnote corpus.
4. **cmark pathological cases** — 21, with the calibrated budgets and
   `GUARD_REFUSED` set described in [CLAUDE.engine.md](./CLAUDE.engine.md).
5. **mdast-util-from-markdown@2.0.3 fixtures** — 27 `.md`/`.json` pairs asserting
   AST-**plus-position** equality through `Mdast`, proving interop rather than
   rendering.

Plus the **dialect matrix**, running all 652 CommonMark examples under both
dialects with an explicitly asserted bidirectional divergence list of **exactly 11
examples** (6 tagfilter, 5 autolink-literal) — changing that count means changing
an assertion, deliberately.

The **differential oracle** is `commonmark@0.31.2`, an exact-pinned devDependency
imported only by `__test__/oracle.property.test.ts` — never a runtime dep, never
elsewhere, never drifting from the ported version. **Corpus-wide re-parse
equivalence** (1361 round-trips over all three corpora) is the stringify
authority.

Tests live in `__test__/` only, never in `src/`; conformance in `__test__/e2e/`.
Use `@effect/vitest` and assert with `assert.*` — **never `expect`**.

HTML rendering exists here and nowhere else: `__test__/e2e/support/htmlWriter.ts`
is test-harness machinery, not a product feature. Do not promote it to `src/`.

---

**Related context:** [CLAUDE.engine.md](./CLAUDE.engine.md) for the hardening
posture these corpora hold in place.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the package overview.*
