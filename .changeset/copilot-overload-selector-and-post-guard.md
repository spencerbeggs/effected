---
"@effected/copilot-plugin": patch
---

## Documentation

- The `effect-api-extractor-bases` skill covers `{@link}` to an overloaded exported function: the fix for the *"ambiguous… add a TSDoc member reference selector"* diagnostic is the parenthesized overload-index selector — `{@link (descend:1)}` — not `:function`, which matches every overload and fails on the count. The section records the probe that settled it at the `@effected/walker` build (bare, `:function`, an unparenthesized selector and an out-of-range index all fail; `:1` and `:2` resolve clean), that the implementation signature is not counted, and that the index names a position, so reordering overloads silently repoints every link. Closes #646.
- The `structuring-an-action` skill's `post.ts` example now carries the same `GITHUB_ACTIONS` entry guard the page requires of every entry, with the downstream incident that motivated it — a guardless entry that would have minted and revoked a live installation token as an import side effect on a runner. Its tests reference settles where the env-stripping step must run: probed on `vitest@5.0.0` under the fork pool, both `globalSetup` and `setupFiles` strip the marker before any worker evaluates an entry (with or without `projects`), a top-of-file `delete` in a test never does, and the sibling-repo comment claiming `globalSetup` deletions are invisible to workers is false as stated. The canonical tree also places the output-contract drift test where `actions-inputs-outputs` puts it. Closes #638.
