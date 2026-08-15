# Mutating tier — @effected/git

Per-member postures for the forty mutating methods. The tier rule itself — the `"Mutating:"` TSDoc marker, and that nothing here serializes concurrent access — is in the parent.

**Parent:** [@effected/git context](./CLAUDE.md)

## Postures that are decisions, not defaults (#193)

The 2026-08-05 slice closed silk-release-action's raw-spawn census. These are decisions, not defaults:

- **`reset` and `clean` fail LOUDLY on any non-zero exit** — they exist so a consumer can restore a tree before retrying a non-idempotent operation (`@changesets/apply-release-plan` deletes the changesets it consumes), and a reset that silently did nothing would hand the retry the same dirty tree. `clean` passes `--force` unconditionally: under default `clean.requireForce`, a forceless clean is a guaranteed no-op.
- **`restore` is a separate member**, git's own verb for the `checkout -- <paths>` shape, so `checkout`'s option-like-ref refusal is NOT weakened. Its paths sit behind a literal `--`; only its `source` ref is guarded.
- **Branch creation is a branch member, not a checkout option**: `branchCreate(cwd, name, { startPoint?, checkout?, force? })` emits `git branch [-f] <name> [<start>]`, or `git checkout (-b | -B) <name> [<start>]` with `checkout: true`. `force` with `checkout` exists because the delete-then-create longhand swallows a real edge: `branch -D` refuses the currently checked-out branch, `checkout -B` resets it fine. `branchDelete` emits `-d`, or `-D` with `force: true`.
- **`isShallow(cwd)` is a dedicated predicate** (`rev-parse --is-shallow-repository`), deliberately not folded into `revParse` — that member's contract stays "resolve this REF".
- **`fetchUnshallow` is a distinct mode, and the CALLER guards.** git rejects `--unshallow` in a non-shallow repo and the method does not tolerate that (tolerating would swallow every other fetch failure shape) — probe with `isShallow` first. `fetch`'s `unshallow: true` option (added for the CI shape that unshallows and fetches a refspec in one invocation) follows the same caller-guards rule; combining it with `depth` is refused typed pre-spawn, exactly as git rejects the pair.
- **`fetch`'s `ref` accepts a full refspec, passed through VERBATIM** (`src:dst`, optionally `+`-prefixed — the guard refuses only a leading `-`). Never guess-transform a bare ref into a refspec: under a single-branch clone (actions/checkout's default) a bare-ref fetch updates only `FETCH_HEAD`, and `+refs/heads/<b>:refs/remotes/origin/<b>` is the caller's own decision.
- **`fetchAny` is the shipped tag-then-branch fallback**: tag-form `fetch` first, retrying as a plain `fetch` on `UnknownRefError` or a `GitCommandError` — EXCEPT one whose `kind` is `"refused"` (a pre-spawn guard rejection), which re-fails immediately, since the plain form would reject it identically. `NotARepositoryError` propagates from the tag attempt. When both attempts fail, the PLAIN fetch's error surfaces.
- `configSet` guards all three string inputs — `key`, `value` AND `options.file` — through `rejectOptionLikeRefs`, because git config has no documented `--` separator. Consequence: a legitimate config value starting with `-` cannot be written through this method. Refused typed, before any spawn.

**Related:** [surface](./CLAUDE.surface.md) · [classification](./CLAUDE.classification.md)
