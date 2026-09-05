# The eight questions

Ask in order, one per message. Lead with the recommended default. Record every answer in the plan, including defaults.

## 1. Identity

> What is the action called, which org publishes it, and what does it do in one line? Any branding icon and colour preference?

Adds to the plan: the rename list — `package.json` name/description/repository/homepage/bugs/author; `.changeset/config.json` `changelog[1].repo`; `action.yml` name/description/branding; `README.md` usage line; `.github/CODEOWNERS`; `dependabot.yml` assignees; any hardcoded `owner:` in workflows.

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

Adds: `OUTPUT_NAMES` tuple and count; the all-disabled baseline values; for a structured `result`: one exported `Schema.Class`, `ActionOutputs.setJson` through it, a versioned schema under `schemas/<version>/`, the generator at `lib/scripts/generate-schema.ts` — whose `SchemaPipeline.run` refuses a pinned target's contract change itself, no hand-rolled preflight needed — `schema:generate` / `schema:check` scripts, the drift test, and `@effected/schemastore` in `devDependencies`.

## 6. Runner capabilities

> Which of these does the action do? Cache a directory; upload or download artifacts; install a toolchain or package manager; run subprocesses; publish to a registry; produce an SBOM or attestation; read or write files in the workspace; parse lockfiles, manifests, JSONC, YAML or TOML. **Default: none beyond reading inputs and writing outputs.**

Adds: one row per capability naming the kit package (`@effected/github-actions` for cache, artifact, tool install; `@effected/commands` for subprocesses; `@effected/npm` for publishing; `@effected/sbom` for attestation; `@effected/lockfiles`, `@effected/package-json`, `@effected/jsonc`, `@effected/yaml`, `@effected/toml`, `@effected/workspaces` as implied) and the step that will import it. A package with no importing step is not listed.

## 7. Reporting

> How should the action report? **Default: job summary only.** Options: job summary; a check run; a sticky pull-request comment; a living managed document (check state reconciled onto a PR body or comment).

Adds: the reporting surfaces, all built through `GitHubMarkdown` from one `format.ts`; for a check run or comment, `@effected/github` and the App-auth or token decision from question 3 revisited if it was "none"; for two runs in flight against one document, a per-run stamp minted at startup.

## 8. Self-dogfood

> Which workflow in this repository will run the built action against the repository itself, and on what trigger? **Default: a `self-dogfood.yml` on pull request and manual dispatch.**

Adds: the workflow name and trigger; the `act-test.yml` target (`.github/actions/local`, produced by `persistLocal`); the dist-freshness gate.
