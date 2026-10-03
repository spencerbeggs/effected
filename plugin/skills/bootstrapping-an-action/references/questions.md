# The eight questions

Ask in order, one per message. Lead with the recommended default. Record every answer in the plan, including defaults.

## 1. Identity

> What is the action called, which org publishes it, and what does it do in one line? Any branding icon and colour preference?

Adds to the plan: the rename list — `package.json` name/description/repository/homepage/bugs/author; `.changeset/config.json` `changelog[1].repo`; `action.yml` name/description/branding; `README.md`'s `uses:` line (`<org>/<repo>@<ref>`, not the template's own slug); `.github/CODEOWNERS`; `dependabot.yml` assignees; any hardcoded `owner:` in workflows.

When question 5 keeps the structured `result` output, the rename list also carries the **schema identity**, which the template ships under its own name:

- `src/schema/result.ts` — the `HostedSchema.github({ repo, name, … })` identity's `repo` and `name`, and the documentation URL on the last line of the `result` schema's `description`.
- `schemas/<version>/<name>-<version>.json` — the committed document's file name derives from the identity's `name`. Run `schema:build` after the rename to write the new file, then **delete the old one by hand**: `schema:check` flags an orphan only at a sibling shape of a name the config still derives, so a file under a retired name is invisible to it.
- `action.yml`'s `result` output description, which names the document path (`.github/actions/local/action.yml` is regenerated from it by the build).
- `docs/04-output-schema.md`, which names the same file.

When question 5 removes the structured output, these rows are deleted rather than renamed.

## 2. Phases

> Which lifecycle phases does the action need? **Default: main plus post.** Options: main only; main plus post (cleanup or duration reporting that must never fail the workflow); pre, main and post (pre exists to fail fast on credentials or to provision something main reads back).

Adds: the phase decision; whether `src/pre.ts` and a `PreLive` layer exist; the `action.yml` `runs` block shape.

## 3. GitHub access

> Does the action call the GitHub API, and if so how does it authenticate? **Default: none.** Options: none; a `github-token` input the workflow supplies; GitHub App authentication (client id and private key inputs, token provisioned in `pre` with required-scope verification, revoked unconditionally in `post`).

Adds: App auth → `pre.ts`, the two inputs, `GitHubToken.provision` with `required` scopes, `GitHubToken.clientLayer()` in main, `dispose()` in post under the double net, and `@effected/github` entering the dependency list **with the edit that lands `pre.ts`**. Token input → `ActionInput.redacted("github-token")` and `@effected/github` when a step calls the API.

## 4. Inputs

> List the inputs. For each: is it a flat value or list (line-list), or genuinely nested structure (JSON)? **Default: every input line-list.**

Adds: `INPUT_NAMES` tuple and count; defaults mirrored from `action.yml`; cross-field validation rules; for any JSON input, `ActionInput.schema(name, Schema)` plus an unversioned `<action>.input.schema.json` published through `@effected/schemastore`.

## 5. Outputs

> List the outputs. Is any of them a structured document that a downstream job, a bot or an LLM will parse? **Default: scalars only.**

Adds: `OUTPUT_NAMES` tuple and count; the all-disabled baseline values; for a structured `result`: one exported `Schema.Class` asserting `$schema` from a `HostedSchema` declared beside it, `ActionOutputs.setJson` through it, a versioned schema under `schemas/<version>/`, `lib/scripts/schemastore.config.ts` handing that identity to `defineConfig` as `hosted`, `schema:build` / `schema:check` scripts that name that path (`schemastore build lib/scripts/schemastore.config.ts`, `schemastore check lib/scripts/schemastore.config.ts` — the command's upward discovery never looks inside `lib/scripts/`), `schema:check` in `ci:test` as the drift gate (no drift test to write), `@effected/schemastore` in `dependencies` and `@effected/schemastore-cli` in `devDependencies`. If the template copy carries its config at the repository root, the plan moves it to `lib/scripts/` and re-points its relative paths (`outputDir: "../../schemas"`, the `../../src/schema/…` import) — relative paths resolve against the config file's own directory.

**The template ships the structured output, so the default is a removal, not a no-op.** A fresh template copy already carries a `result` output and the whole publication pipeline. Answering "scalars only" puts a removal step in the plan; the template's `docs/04-output-schema.md` "Remove the structured output" section is the authoritative checklist — cite it in the plan and follow it rather than improvising. It covers, in outline: the `result` output in `action.yml`; `src/schema/result.ts`; `"result"` in `OUTPUT_NAMES` and the `setJson` call in `src/schema/outputs.ts`; `schemas/` and the config file; both `@effected/schemastore*` packages and the two `schema:*` scripts in `package.json`; the `schema:build` turbo task and its `dependsOn` edge; the `schema-freshness` CI job and the `act-test.yml` payload-validation step; the `result` tests and assertions; and the docs that name any of it. The output-mirror and dependency-honesty tests fail on anything missed.

**Kept, it ships unpublished.** A freshly bootstrapped action declares its config entry `published: false` and the plan says so: an unpublished schema regenerates in place through any change, contract included, which is what the skeleton and fill phases need. Flipping it to `true` is a first-release task — the day a consumer can pin the document — and belongs in the plan's build order at that point, never earlier; a published entry refuses every contract change at its current label.

## 6. Runner capabilities

> Which of these does the action do? Cache a directory; upload or download artifacts; install a toolchain or package manager; run subprocesses; publish to a registry; produce an SBOM or attestation; read or write files in the workspace; parse lockfiles, manifests, JSONC, YAML or TOML. **Default: none beyond reading inputs and writing outputs.**

Adds: one row per capability naming the kit package (`@effected/github-actions` for cache, artifact, tool install; `@effected/commands` for subprocesses; `@effected/npm` for publishing; `@effected/sbom` for attestation; `@effected/lockfiles`, `@effected/package-json`, `@effected/jsonc`, `@effected/yaml`, `@effected/toml`, `@effected/workspaces` as implied) and the step that will import it. A package with no importing step is not listed.

## 7. Reporting

> How should the action report? **Default: job summary only.** Options: job summary; a check run; a sticky pull-request comment; a living managed document (check state reconciled onto a PR body or comment).

Adds: the reporting surfaces, all built through `GitHubMarkdown` from one `format.ts`; for a check run or comment, `@effected/github` and the App-auth or token decision from question 3 revisited if it was "none"; for two runs in flight against one document, a per-run stamp minted at startup.

## 8. Self-dogfood

> Which workflow in this repository will run the built action against the repository itself, and on what trigger? **Default: a `self-dogfood.yml` on pull request and manual dispatch.**

Adds: the workflow name and trigger; the `act-test.yml` target (`.github/actions/local`, produced by `persistLocal`); the dist-freshness gate.
