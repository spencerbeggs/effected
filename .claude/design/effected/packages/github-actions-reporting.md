---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 95
related:
  - github-actions.md
  - github-actions-runtime.md
  - github.md
  - templates.md
  - markdown.md
---

# @effected/github-actions — the reporting suite

## Overview

The reporting suite is four modules answering one consumer shape: an action that reports progress into a **living document** — a pull-request comment or check summary rewritten as checks resolve — otherwise hand-rolls marker parsing, GFM escaping, a debounce and a check-state vocabulary, and gets the escaping wrong in production. `CheckState` is the vocabulary, `ManagedDocument` the marker grammar, `GitHubMarkdown` the writer and `CheckDocument` the reconciler.

The suite reports; it does not deliver. None of the four talks to GitHub — the reconciler writes through a narrow sink the caller supplies, so the same registry drives a pull-request comment, a check summary or a file — and the API calls that carry any of it belong to [`@effected/github`](github.md) and to the action composing them. Inside the package it is the one place [`@effected/markdown`](markdown.md) is reachable, confined to the writer, while the [buffered step logger](github-actions-runtime.md#logging-and-the-workflow-command-protocol) that shares this suite's intent lives with [the runtime](github-actions-runtime.md) because it is a runner service. Package-wide framing is in [github-actions.md](github-actions.md).

## `CheckState` — pure vocabulary

The states a run reports (running, pass, fail, warn, user-interaction-required, skipped, timeout) plus the projection onto GitHub's check-run status-and-conclusion wire.

**The conclusion literals are mirrored structurally rather than imported**, so the module never reaches [`@effected/github`](github.md): a check *state* is a reporting concept an action can hold without linking an API client, and importing one to name a string would put octokit on the graph of every module that reports progress. **A test pins the mirror against the real union**, so the duplication cannot drift silently — this is the package's one deliberate "copy" answer to the shared-vocabulary rule, and it comes with an alarm rather than with trust.

It is also what makes the check-run conclusions that a bracket does not produce by default reachable from a **vocabulary** rather than from a bare literal at a call site.

## `ManagedDocument` — pure, over `@effected/templates`

A marker-delimited document: a sentinel comment identifies *this* action's document among many, and named regions inside it are replaced from current state while every byte the human wrote around them survives. Create-or-update is **one parse**, not a find-then-branch.

It is a thin domain fixing of [`@effected/templates`](templates.md)' section document — HTML comment style, a fixed marker phrase, namespaced wire keys — and deliberately **not a second engine**: the region grammar, the line-ending invariant and the idempotence proof all stay in `templates`, which is the package that has them under test. Worth recording that adopting it wanted the dialect's parameters *narrowed*, not extended: nothing was missing from the mechanism.

### Region metadata rides the marker

A region may carry `name="value"` pairs on its marker: `withRegions` takes a `[key, content, meta?]` **triple** alongside the existing two-tuple, `entry(key)` answers content and metadata together and the `regions` getter reports `meta` on every region. The mechanism is [`templates`' marker attributes](templates.md#attributes-ride-the-begin-marker) passed straight through — this module adds no grammar and no meaning.

Three shape decisions:

- **The triple is additive and the two-tuple is unchanged**, so no existing caller moves. That matters more than symmetry here: the metadata is a minority need and the common render stays a pair.
- **`meta` is always present, never optional.** A region whose marker carries no attributes reports `{}`, so a reader never branches on absence — the same reason the underlying field is a defaulted record rather than an optional key.
- **Metadata is not addressable.** `entry` looks a region up by key exactly as `region` does; attributes decide nothing about *which* region a marker names, only what it says about itself. The [staleness guard](#the-staleness-guard-two-runs-one-document) is the first reader, and it is a reader of values, not of identity.

`ManagedDocumentError` carries an `invalidAttribute` kind with the offending attribute's name, mapped from the render refusal underneath. **The name reported is the consumer's region key, not the namespaced wire key** — the same translation the other kinds already do, and the reason to keep the mapping rather than let the underlying error surface.

## `GitHubMarkdown` — the writer, and the only importer of the engine

A fluent writer for GitHub's surfaces: tables, headings, links, code, lists, collapsible sections and raw passthrough. **Every member takes pre-rendered markdown and returns a string**, so compositions read as plain string assembly; what the writer owns is the *structure*.

The defect it exists to delete is live: **joining strings** is precisely what corrupts a table when a cell contains a pipe — every column after it shifts. Here a cell's pipes are escaped, a fence inside a code block widens the fence and a URL with spaces is bracketed. That is also why the serializer's impossible arm is a **defect, not a fallback**: quietly degrading to string joining on a tree that cannot occur is how the corruption returns.

It is the **only** module permitted to import [`@effected/markdown`](markdown.md), and that confinement is [reachability-tested with a control](github-actions.md#bundle-reachability-confining-the-heavy-edges) exactly as the Azure client is — which constrains the **import** graph, not the resolver graph: the engine is a declared dependency of this package either way, so what the confinement buys is that a consumer writing a check document without calling the writer links none of it and a tree-shaking bundler can drop it.

### The render-cannot-fail invariant

The serializer's only failure is a nesting-depth guard, and it is **unreachable from this writer** — not because these trees happen to be small, but because **their depth does not depend on input**. Every member takes pre-rendered markdown and wraps it in exactly one passthrough node, so a composition nests **strings**, not nodes, and the deepest tree any member can build is a table's own fixed nesting whatever it is handed. Pinned by tests that nest the writer's own output a thousand deep.

Consumers therefore need not wrap a render in a try — and should not, because a defensive wrap widens the catch to anything else thrown inside the builder, hiding a real defect behind a caught error. The one reachable throw in this area is the **typed-table codec**, for a value smuggled past the types, not the serializer.

**Maintenance note:** a future member that accepts a node, or that re-parses a fragment back into one, makes depth input-dependent and collapses this argument. If that lands, the claim must be re-earned, not assumed.

### A table's columns are defined once, by a row schema

The typed-table constructor is the same argument one level up. Column order is field declaration order, each header is the field's title annotation falling back to the property name, and each cell is the field value's **encoded** form — so a branded or typed field projects through its own codec instead of being respelled at every call site, and a row can no longer transpose columns because it is a typed object rather than a positional array.

The one place the types get strict: a field whose encoded side is **not** a string has no string projection to borrow, so its column's formatter — and therefore the column options themselves — becomes **required** rather than defaulting to a stringification. That is deliberate, and it is the general lesson of this whole suite: the defect these modules delete is never "no API for it", it is **"the obvious spelling is silently wrong"**. An absent optional field renders an empty cell without consulting codec or formatter.

## `CheckDocument` — the reconciler

An in-process registry of check reports, last-write-wins per check and resolution non-terminal so a check may report again, projected onto a managed document by a scoped background fiber and written through a **narrow sink** — a function from rendered text to an effect, or that function plus an [optional read-back](#the-staleness-guard-two-runs-one-document) — so the same reconciler drives a pull-request comment, a check summary or a file with no knowledge of any of them.

Four properties carry it:

- **Push, not pull.** The run owns its checks and knows when they resolve; nothing here polls GitHub.
- **Trailing debounce with a max-wait.** A burst coalesces into one write carrying the burst's *final* state, and a steady stream still surfaces progress. Leading-edge would publish the first state of every burst, which is the one state guaranteed to be stale.
- **A byte-identical render issues no write at all** — the cheapest possible answer to a comment-editing rate limit, needing no cache beyond the text already written.
- **The finalizer flushes, and its registration order matters.** It is registered *before* the daemon is forked, so it runs *after* the fork's own interruption finalizer: the daemon is already dead when the last flush runs, so the two cannot race for the sink. A background pass that fails logs a structured warning and leaves the registry intact — the next report retries it — and only an explicit flush surfaces the typed error, **because a reporting document failing must not fail the run it is reporting on**.

Its error carries which phase failed — the document could not be built, the live text could not be read back, or the place it was going refused it — because those are three different problems for the caller.

### The staleness guard: two runs, one document

Two workflow runs can be in flight against one document — a re-run started while a delayed original is still going, or two events racing on the same pull request. With neither mechanism below engaged, the reconciler assumes it is alone: each pass reconciles against **the last text this process wrote**, a process-local shadow, so a run never sees another run's writes and happily rewrites over them. The observable damage is a report that flickers between two runs' states and settles on whichever finished last, which is not necessarily the newest.

Two independent, opt-in mechanisms close it, and they are separable on purpose: reading fixes *what a pass reconciles against*, stamping fixes *whether a pass may write at all*.

**The sink may be read as well as written.** `CheckDocumentSink` is a function or `{ write, read? }`, and a bare function is exactly `{ write }`. With a `read`, every pass fetches the live text and reconciles against that instead of the shadow, so each run sees what the other actually wrote; `undefined` means nothing is there yet, a fresh document. **The read carries the same timeout bound as the write**, for the same non-defensive reason: the pass holds the reconciler's single permit and the finalizer's last flush waits on it, so an unbounded read stalls scope teardown exactly as an unbounded write would. A failed read is its own error kind rather than a rendering failure, because "GitHub would not tell us the current comment" is a different problem from "the state could not be rendered".

**A stamp decides who wins.** The `stamp` option is a per-run `{ at, runId }`; when set, every region a pass writes carries that pair as marker metadata, and a pass whose stamp is **strictly older** than the most recent stamp already on the document is dropped without writing. `CheckDocumentStamp.isAtLeastAsRecent` is the whole rule and it is deliberately **total and reflexive**: `at` compares as epoch milliseconds when both sides parse as dates and lexically otherwise, `runId` breaks ties numerically when both sides are **non-blank** and finite and lexically otherwise, and equal stamps pass so a run may keep refining its own regions. Totality is the point — a comparator with an "I cannot tell" case has to choose between dropping and clobbering on garbage input, and both choices are wrong somewhere.

**The blank guard on `runId` is load-bearing, not defensive trim.** `Number("")` and `Number("  ")` are both a finite `0`, so without it a blank runId — plausible whenever `GITHUB_RUN_ID` is unset, which is the ordinary local and self-hosted case — compares numerically *equal* to `"0"` and *outranks* `"-1"`: a stamp carrying no run identity would silently win ties against real ones. Requiring both sides non-blank sends those pairs to the lexical branch, where the order is still total and blankness sorts as the string it is. It is of the same class as making `at` `Date.parse`-aware rather than string-comparing timestamps: both refinements exist because a *total* comparator has to be right on the inputs a real run actually produces.

Four consequences worth carrying:

- **The stamp is a per-run constant, minted once at startup, never per pass.** That is what preserves the byte-identical-render suppression: the same run rendering the same state produces the same text, stamp included, so no write is issued. Making it "now" per pass would make every pass differ and turn the cheapest property in the reconciler into a write per debounce window.
- **The accepted corner that follows: a content-identical pass does not refresh the document's stamp.** Suppression wins. It is sound precisely because only a *strictly older* stamp drops — a stale stamp on the document can only ever be too old to block anyone who should be writing.
- **Unstamped regions are ignored by the drop rule.** A region carrying no stamp is not evidence of a newer run — it is evidence of a run that never opted in — so treating it as an obstacle would let an unstamped consumer block itself forever.
- **The metadata keys are bare `at` and `runId`.** An implicit protocol between the stamp writer and the stamp reader, documented rather than namespaced, and the reason `CheckDocumentOptions.render` still returns two-tuples: the reconciler injects the stamp itself. Letting a consumer's own region metadata through would need a **merge policy** against the injected pair, and inventing one before a consumer has asked is how a speculative API gets designed twice.

**`flush` answers `written` | `unchanged` | `stale`**, because a caller that flushes explicitly at the end of a run needs to know its report was dropped; a plain literal union costs a caller that ignores the result nothing. And **a drop announces itself once, at the transition** — INFO on the first stale pass, debug on every repeat. Once stale, a run is stale for the rest of its life (the stamp is constant), and the debounced pass plus the explicit flush is the ordinary pair, so a per-report line would turn one fact into noise in exactly the log a person reads when the report looks wrong.

**What this does not do, stated so it is not read as more:** there is no compare-and-swap or ETag on the sink, so read-then-write still races inside one pass. The guard narrows the window from "the whole run" to "one pass", which is what makes the flicker stop; it does not make the write atomic, and nothing on GitHub's comment API offers a conditional write to build that on.

## The logging half

[The buffered step logger](github-actions-runtime.md#logging-and-the-workflow-command-protocol) belongs with this suite in spirit even though it lives with the runtime: it is what keeps a green release log to one line per step while a failure still spills the whole transcript. The two are the same design intent — a run's *narrative* is a surface with its own rules, and getting it right is not the same job as doing the work.
