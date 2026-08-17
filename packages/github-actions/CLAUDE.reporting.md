# Reporting, attestation and the token bridge — @effected/github-actions

Child context file for the GitHub-surfaces suite, the `@effected/sbom` seam
adapters and `GitHubToken`. The rules live in the parent; this file is why they
are shaped that way.

**Parent:** [CLAUDE.md](./CLAUDE.md)
**Design depth:**
`@../../.claude/design/effected/packages/github-actions-reporting.md` and
`@../../.claude/design/effected/packages/github-actions-attestation.md`

---

## The GitHub-surfaces suite (2026-07-26)

- **`GitHubMarkdown`'s impossible serializer arm is a defect, not a fallback.** A
  string-joining fallback is the live table-corruption defect this module exists
  to delete. `tableFor(schema)` defines columns once from a row schema —
  declaration order, `title` annotations, **encoded** cell values — so a field
  whose encoded side is not a string makes `format` (and therefore `columns`)
  **required** rather than defaulting to `String(value)`.
- **`CheckDocument` writes only when the render changed.** Byte-identical ⇒ no
  write; **trailing** debounce with a max-wait (leading-edge publishes the one
  state guaranteed to be stale); the finalizer is registered **before** the daemon
  is forked, so the flush cannot race the sink; a failed background pass logs and
  leaves the registry intact — only `flush` surfaces the typed error, because a
  reporting document must not fail the run it reports on.
- **`CheckState` mirrors `github`'s conclusion literals structurally** so the
  module never reaches an API client; a test pins the mirror. Do not "fix" it into
  an import.
- **`ManagedDocument` is not a second region engine.** The `BEGIN`/`END` grammar,
  the line-ending invariant and the idempotence proof stay in `@effected/templates`,
  which has them under test. Region **metadata** rides that same mechanism and adds
  no meaning here: `withRegions` takes a `[key, content, meta?]` triple beside the
  unchanged two-tuple, `entry(key)` answers content and metadata together, and
  `meta` is **always present** (`{}` for a bare marker) so no reader branches on
  absence. Metadata is **not addressable** — a region is found by key alone, so
  changing metadata updates it in place. `invalidAttribute` reports the consumer's
  region key, never the namespaced wire key.

## The staleness guard: two runs, one document (2026-08-17)

The reconciler shipped assuming it was the only writer — each pass reconciled
against **the last text this process wrote** — so a re-run racing a slow original
rewrote over it and the report flickered between two runs' states. Two opt-in,
separable mechanisms close it: reading fixes *what a pass reconciles against*,
stamping fixes *whether a pass may write at all*.

- **The sink widened to `{write, read?}`; a bare function is exactly `{write}`,
  so no caller moved.** With a `read`, every pass fetches the live text and
  reconciles against that. It carries the **same timeout bound as the write**, for
  the same non-defensive reason: the pass holds the single permit and the
  finalizer's last flush waits on it, so an unbounded read stalls scope teardown.
  A failed read is `kind: "read"` — "GitHub would not tell us the current comment"
  is a different problem from "the state could not be rendered".
- **`stamp` is a per-run constant, minted once at startup, never per pass.** That
  is what preserves write suppression: the same run rendering the same state
  produces byte-identical text, stamp included. Per-pass "now" would turn the
  cheapest property in the reconciler into a write per debounce window. The
  accepted corner is that a content-identical pass does not refresh the document's
  stamp — sound because only a **strictly older** stamp drops.
- **`CheckDocumentStamp.isAtLeastAsRecent` is total and reflexive.** Equal stamps
  pass, so a run may refine its own regions; a comparator with an "I cannot tell"
  case would have to choose between dropping and clobbering on garbage input, and
  both are wrong somewhere. Unstamped regions are ignored — they are evidence of a
  run that never opted in, not of a newer one.
- **`flush` answers `written | unchanged | stale`**, and a drop announces itself
  **once, at the transition** (INFO), repeats at debug: the stamp is constant, so a
  stale run stays stale and a per-report line would bury the one fact in the log a
  person reads when the report looks wrong.
- **The guard narrows the window; it does not make the write atomic.** A
  read-then-write still races inside one pass, and nothing on GitHub's comment API
  offers a conditional write to build a compare-and-swap on. Never restate it as
  the stronger claim.

## Attestation: `ActionsProvenance.capture` owns the OIDC-claims rename once

Eleven all-string fields — a transposed `repository_id` / `repository_owner_id`
compiles, typechecks and signs the **wrong** provenance. `serverUrl` comes from
`getOptional` with a `https://github.com` default (absence is not a failure),
`OidcTokenError` passes through untouched (mandatory-vs-best-effort attestation is
the *consumer's* policy), and the construct **ends at the predicate**.

`ActionsIdentityToken.layer` and `ActionsProvenance.capture` close
`@effected/sbom`'s `IdentityToken` and `SlsaProvenance` contracts. **`sbom` must
not depend on the Actions runtime, so the adapter that closes its contract lives
here** — the same inversion as `commands`' `LocalExec` and `npm`'s
`CatalogResolver`. Never add the reverse edge.

## The token bridge's one-hour contract

An installation token lives about an hour and **no later phase can re-mint one** —
the credential that could is the app's private key, and persisting *that* through
`GITHUB_STATE` would trade a one-hour token for a permanent one. So
`GitHubToken.read` fails typed (`GitHubTokenError`, `reason: "expired"`) rather
than handing back a token that answers `401` with no explanation, and a phase that
can outlive the hour calls `provision` itself. `dispose` skips revoking an
already-expired token: GitHub has stopped accepting it, so the request could only
turn a successful run into a failed one on the way out.

`provision` is an `acquireUseRelease` whose release arm **revokes** — a workflow
retrying a failing `pre` would otherwise leave an hour of unreferenced write
tokens behind. Its member-usage table is in the module's TSDoc and is
**executable**: one test supplies exactly the documented members and passes,
another supplies one fewer and dies.

---

**Related context:** [CLAUDE.processes.md](./CLAUDE.processes.md) for `Secret`,
which every credential here travels inside;
[CLAUDE.testing.md](./CLAUDE.testing.md) for `OidcTokenIssuer.layerFor`, the real
decodable JWT that makes the provenance path reachable.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the package overview.*
