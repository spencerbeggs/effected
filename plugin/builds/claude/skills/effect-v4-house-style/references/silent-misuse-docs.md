# Documenting an API whose misuse is silent

For any API whose wrong call sequence **typechecks, runs, and reports success**,
ordinary "here is the right way" documentation does not work. The reader is not
looking anything up — they already believe they know the shape, and nothing will
contradict them. `@effected/github`'s `GitBranch.upsert` is the worked example.
Three ingredients, all cheap:

1. **Spell out the wrong sequence literally** — "never `upsert(branch,
   targetHead)` followed by `commitFiles`". It must match what the reader is
   *about to write*, not only what they should write instead. Prose describing
   the correct shape never collides with a plan; the wrong spelling does.
2. **State what it cost, concretely.** A window of a few seconds where the
   branch equals its base, an open PR with an empty diff, GitHub auto-closing
   it, a consumer losing its release PR while the run reported success. Severity
   is what converts "noted" into "stop".
3. **Name the consumer that hit it.** That is how a reader recognizes their own
   code in the description.

A port that reads such a docstring can recognize the sequence in the code it is
porting and flag it as a decision needing a human ruling, finding a live bug
instead of faithfully reproducing it. Literal parity would carry the defect
forward.

Apply it deliberately to the other ordering-sensitive and upsert-shaped
surfaces, not just where someone has already been burned. The test for whether
an API qualifies: **would the wrong call go green?** If yes, the anti-pattern
belongs in the docstring.
