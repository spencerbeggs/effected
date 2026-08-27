# The document suite: `GitHubMarkdown`, `ManagedDocument`, `CheckDocument`

The layer between "a value my program has" and the comment/description
sinks: a GFM writer, a marker-delimited document, and a debounced
reconciler that projects check state onto one.

## `GitHubMarkdown` — the GFM writer

A pure class of static members — no service, no IO: `table(headers, rows)`,
`tableFor(schema, options?)`, `heading(text, level = 2)`, `link(text, url)`,
`code(text)`, `codeBlock(content, language?)`, `list(items, { ordered? })`,
`details(summary, body)`, `raw(markdown)`. Fragments are escaped through a
real GFM serializer: `table` escapes pipes and pads short rows, `code`
widens its backtick delimiter, `codeBlock` lengthens its fence. `raw` is
the identity, existing only to *state* that a fragment is already
rendered.

**`tableFor(schema)` defines a table's columns once, by a row schema**:
column order is field declaration order, each header is the field's
`title` annotation (falling back to the property name, overridable per
column), and each cell is the field value's **encoded** string form — a
branded field projects through its own codec, so a row can no longer
transpose columns. A field whose encoded side is not a string makes that
column's `format` — and therefore `columns` and `options` — **required at
the type level**. An absent optional field renders as an empty cell. The
returned `GitHubSchemaTable`'s `.render(rows)` maps through `table`, so escaping is
inherited and identical rows produce identical output.

## `ManagedDocument` — marker-delimited regions in text a human also edits

The one primitive behind both the sticky PR comment and a managed PR
description: a sentinel HTML comment (`<!-- namespace:key -->`) identifies
the document, each region is delimited by HTML-comment markers, everything
outside a managed region survives regeneration byte-for-byte, and regions
are **replaced from current state, never appended**. Pure string → string;
the region engine reuses `@effected/templates`' section-document primitive
with an HTML-comment dialect. Construct with `ManagedDocument.parseResult(source)`
/ `.parse` — create-or-update in one call; absent, empty and
sentinel-less text are all a legal fresh document. Apply with
`.withRegionsResult(entries)` / `.withRegions`; read with `.sentinel`,
`.matches(text)`, `.region(key)`, `.regions`.

`ManagedDocumentError.kind` names four structural parse ambiguities
(`unterminatedRegion`, `orphanedEnd`, `overlappingRegions`,
`duplicateRegion`) and two declaration refusals (`markerInContent`,
`duplicateDeclaration`) — each a case where a silent choice would corrupt
content a human wrote. `PullRequestComment`'s `CommentMarker` renders the
**same** sentinel for the same namespace and key, which is what stitches
`ManagedDocument` and `PullRequestComment` together.

### The five managed-section rules

Apply these to any sticky comment or PR description a program maintains
across multiple runs:

1. **Write the running state before doing the work.** A reader who checks
   mid-run sees "in progress," not a stale result from the last run.
2. **Never blank a section.** A section with nothing new to say keeps its
   last content rather than going empty — an empty section reads as "this
   never ran," not "nothing changed."
3. **Sha-stamp staleness.** A region carries the commit sha it was
   rendered against, so a reader can tell a section is describing an
   earlier push rather than the current one.
4. **Keep sections independent.** One region's update must not require
   rewriting another — a check-run section and a release-notes section
   update on their own schedules.
5. **Write monotonically.** A region's content only moves forward — later
   information replaces earlier information, never the reverse, so a
   reader watching the comment update never sees it regress.

### Payload budgets are a design step, not a runtime discovery

`CheckRunOutput`'s 65535-byte cap is enforced automatically by the API
client on every `update`/`complete` call — but a program that assembles a
large findings table should design its own truncation policy (what to cut,
in what order, with what notice) rather than discover the cap by watching
content silently disappear at the edge. Comment bodies carry no enforced
truncation of their own; the size limit that matters there is what
pagination in `find` already handles, not a byte cap.

## `CheckState` + `CheckDocument` — the debounced reconciler

`CheckState` is the kit's check vocabulary — `running | pass | fail | warn
| user_interaction_required | skipped | timeout`, deliberately wider than
GitHub's own conclusions (`running` is a state, not the absence of a
conclusion; GitHub's `cancelled` has no counterpart on purpose).
`projectCheckState` maps each onto the check-run wire as a discriminated
projection as a discriminated `CheckRunProjection`: `running → in_progress`;
everything else `completed` with `pass → success`, `fail → failure`,
`warn → neutral`, `user_interaction_required → action_required`,
`skipped → skipped`, `timeout → timed_out`. A structural test pins these
literals against `@effected/github`'s check-conclusion vocabulary, so the
pure projection module keeps the API client off its import graph.

`CheckDocument.layer({ namespace, key, initial?, render, sink, debounce? })`
is **push, not pull** — nothing polls GitHub. Consumers call
`report(check, CheckReport.make({ state, title?, outcome?, detail?, url? }))`
as states change (never fails, never blocks; a later report for the same
key replaces the whole entry — resolution is not terminal), and a
background fiber projects the registry onto a `ManagedDocument` through the
pure `render` projection. The write leaves through the narrow
`CheckDocumentSink` type — `PullRequestComment.upsert`, a PR-body update,
and a test's recording `Ref` all fit it. The debounce is **trailing with a
max-wait, never leading** (defaults 500 ms quiet / 3 s max); a
byte-identical render issues no write; `flush` reconciles immediately and
the layer's finalizer runs it once more, so a scope closing mid-window
cannot strand the final state. `CheckDocumentError` routes
`kind: "render" | "sink"`; a failed background pass logs and retries on
the next report — only `flush` surfaces the typed error. `layer` mints
fresh state per call — bind it to a `const` if two parts of a program must
share one registry.

## What has no kit successor

Report shaping — assembling a whole report object from parts — is
consumer policy, not a library concern: compose `GitHubMarkdown` pieces or
reach for `@effected/markdown` directly rather than looking for a
report-builder construct. Fan-out-and-accumulate over a collection has no
named construct either; `Effect.partition(items, f)` is the answer — it
runs every effect and never fails, separating successes from failures in
one call, with no custom accumulator type for a consumer to hand-roll:

```ts
import { Effect } from "effect";

const [failures, successes] = yield* Effect.partition(reports, (report) => publish(report));
```
