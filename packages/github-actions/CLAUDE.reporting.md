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
  which has them under test.

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
