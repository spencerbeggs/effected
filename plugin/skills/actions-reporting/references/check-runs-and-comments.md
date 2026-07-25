# Check runs and PR comments (`@effected/github`)

Both services follow the package's usual shape: a `Context.Service` with a
`.layer` requiring `GitHubClient`, `Repo` resolved **per call** (not at layer
construction, so `Repo.provide(other)` works for a multi-repository caller),
and `makeTest`/`layerTest` doubles whose unstubbed members die naming
themselves.

## `CheckRun`

```ts
import { CheckRun, CheckRunOutput } from "@effected/github";
```

### The bracket: `withCheckRun`

```ts
readonly withCheckRun: <A, E, R>(
 name: string,
 headSha: string,
 use: (id: number) => Effect.Effect<A, E, R>,
) => Effect.Effect<A, E | GitHubError, R | Repo>;
```

(`CheckRunShape`, `packages/github/src/CheckRun.ts:139-143`.) `use` keeps its
own `R` — unlike the version this replaces, whose callback was `R`-less and
forced consumers to build self-contained layers just to use the bracket
(`CheckRun.ts:135-138`).

Implementation (`CheckRun.ts:258-269`):

```ts
withCheckRun: <A, E, R>(name: string, headSha: string, use: (id: number) => Effect.Effect<A, E, R>) =>
 Effect.gen(function* () {
  const run = yield* create(name, headSha);
  return yield* use(run.id).pipe(
   Effect.tap(() =>
    complete(run.id, "success", CheckRunOutput.make({ title: name, summary: "Completed successfully." })),
   ),
   Effect.tapError(() =>
    Effect.ignore(complete(run.id, "failure", CheckRunOutput.make({ title: name, summary: "Failed." }))),
   ),
  );
 }),
```

**Read this literally, because the two conclusions it produces are the
only two it can produce.** `Effect.tap` completes the run `"success"` when
`use` succeeds; `Effect.tapError` completes it `"failure"` (ignoring any
error completing has) when `use` fails typed. There is no path from
`withCheckRun` to `"neutral"`, `"cancelled"`, `"timed_out"`,
`"action_required"` or `"skipped"` — reach for `CheckRun.complete` directly
and pass one of those `CheckConclusion` literals if your findings warrant it
(`CheckConclusion`, `CheckRun.ts:7-15`).

**`withCheckRun` does not clean up on interruption.** The bracket is
`Effect.gen` + `.pipe(Effect.tap, Effect.tapError)`, not
`Effect.acquireUseRelease` or an `Effect.onExit` handler — so an interrupted
`use` (the process killed, a sibling fiber failing a `Effect.all` it ran
under) leaves the check run **`in_progress`** on GitHub with no completion
call ever made. If a caller needs a check run that always reaches a terminal
state, it needs its own `Effect.onExit`/`Effect.ensuring` around
`withCheckRun`, or to call `create`/`complete` explicitly and handle the
interruption case itself. This is stated plainly because the bracket shape
invites the assumption that it behaves like `acquireUseRelease` — it does
not, and nothing in the type signature says so.

### The explicit calls

| Member | Signature | Note |
| --- | --- | --- |
| `create(name, headSha)` | `Effect<CheckRunRef, GitHubError, Repo>` | Starts `in_progress` (`CheckRun.ts:200-212`) |
| `get(id)` | `Effect<CheckRunRef, GitHubError, Repo>` | (`CheckRun.ts:236-245`) |
| `update(id, output)` | `Effect<void, GitHubError, Repo>` | Output truncated on the way out (`CheckRun.ts:247-256`) |
| `complete(id, conclusion, output?)` | `Effect<void, GitHubError, Repo>` | `output` optional; truncated when present (`CheckRun.ts:214-230`) |

`CheckRunRef` is `{ id, name, url, status }` (`CheckRun.ts:106-112`); `url`
falls back to `""` when GitHub's `html_url` is absent (`refOf`,
`CheckRun.ts:196-197`).

### `CheckRunOutput`: automatic truncation, not a caller's job

```ts
class CheckRunOutput extends Schema.Class<CheckRunOutput>("CheckRunOutput")({
 title: Schema.String,
 summary: Schema.String,
 text: Schema.optionalKey(Schema.String),
 annotations: Schema.optionalKey(Schema.Array(Annotation)),
}) {
 static readonly LIMIT_BYTES = 65_535;
 static readonly MAX_ANNOTATIONS = 50;
 truncated(): CheckRunOutput { … }
}
```

(`CheckRun.ts:49-82`.) `LIMIT_BYTES` and `MAX_ANNOTATIONS` are GitHub's real
limits, verified directly against this source — not carried over as a
remembered number from a predecessor package. The limit is a **byte** limit:
`✅`, `❌`, `🦋`, `│` all cost several bytes each, so counting characters
passes while GitHub's API answers 422. `capBytes` (`CheckRun.ts:93-99`) cuts
on a whole UTF-8 code point boundary — slicing mid-character decodes to
U+FFFD, and a four-byte code point split at the wrong offset can produce
**more than one** replacement character, so the trim loops until none remain
— then appends `CheckRunOutput.NOTICE`.

**You never call `truncated()` yourself in the ordinary path.**
`CheckRun.update` and `.complete` call it through `wireOutput`
(`CheckRun.ts:175-194`) on every request, so truncation is automatic. Call
`.truncated()` directly only when you need the cut value before sending it —
logging what will actually reach GitHub, for instance.

### `Annotation`

```ts
class Annotation extends Schema.Class<Annotation>("Annotation")({
 path: Schema.String,
 startLine: Schema.Int,
 endLine: Schema.Int,
 level: AnnotationLevel, // "notice" | "warning" | "failure"
 message: Schema.String,
 title: Schema.optionalKey(Schema.String),
}) {}
```

(`CheckRun.ts:17-35`.) On the wire, `startLine`/`endLine` become
`start_line`/`end_line` and `level` becomes `annotation_level`
(`wireOutput`, `CheckRun.ts:181-192`) — the same readable-vocabulary /
wire-abbreviation split `ActionLogger.annotated` follows for workflow-command
annotations, kept consistent across both packages.

## `PullRequestComment`

```ts
import { CommentMarker, PullRequestComment } from "@effected/github";
```

### `CommentMarker`: the hidden marker that makes a comment findable again

```ts
class CommentMarker extends Schema.Class<CommentMarker>("CommentMarker")({
 namespace: Schema.NonEmptyString,
 key: Schema.NonEmptyString,
}) {
 get html(): string; // `<!-- ${namespace}:${key} -->`
 matches(body: string): boolean;
}
```

(`packages/github/src/PullRequestComment.ts:19-34`.) A pure class, not a
hardcoded string — the surface this replaces baked one vendor's marker
(`<!-- savvy-web:${key} -->`) directly into the library. Here the namespace
is the caller's; a general-purpose package has no opinion about whose
comments these are.

### Members

| Member | Signature | Note |
| --- | --- | --- |
| `create(issueNumber, body)` | `Effect<CommentRecord, GitHubError, Repo>` | (`PullRequestComment.ts:117-127`) |
| `find(issueNumber, marker, options?)` | `Effect<Option.Option<CommentRecord>, GitHubError, Repo>` | **Paginates** — see below (`PullRequestComment.ts:129-143`) |
| `upsert(issueNumber, marker, body)` | `Effect<CommentRecord, GitHubError, Repo>` | Appends the marker, `find`s, then creates or updates (`PullRequestComment.ts:149-167`) |
| `delete(commentId)` | `Effect<void, GitHubError, Repo>` | (`PullRequestComment.ts:169-177`) |

`CommentRecord` is `{ id, body, url }` (`PullRequestComment.ts:41-45`), with
`body` defaulting to `""` when GitHub's payload omits it (`recordOf`,
`PullRequestComment.ts:113-114`).

**`find` paginates**, walking every page of issue comments through
`client.paginate` before testing each one against `marker.matches`
(`PullRequestComment.ts:129-143`). The version this replaces requested a
single page of 100 and stopped, so on a busy pull request the marker
silently vanished past the first hundred comments and every `upsert` posted
a duplicate instead of updating the existing one. There is no size limit to
reason about here beyond what pagination already handles — unlike
`CheckRunOutput`, comment bodies carry no enforced truncation in this
package.

### `upsert`'s exact flow

```ts
upsert: Effect.fn("PullRequestComment.upsert")(function* (issueNumber, marker, body) {
 const { owner, repo } = yield* Repo;
 const marked = `${body}\n\n${marker.html}`;
 const existing = yield* find(issueNumber, marker);
 if (Option.isNone(existing)) {
  return yield* create(issueNumber, marked);
 }
 const updated = yield* client.request("PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}", {
  owner,
  repo,
  comment_id: existing.value.id,
  body: marked,
 });
 return recordOf(updated);
}),
```

(`PullRequestComment.ts:149-167`.) One call either way — no find-then-create
dance at the call site, and the marker is always appended fresh so a comment
`upsert` writes is always findable by the same marker on the next call.

```ts
import { CommentMarker, PullRequestComment } from "@effected/github";
import { Effect } from "effect";

const marker = CommentMarker.make({ namespace: "silk-release-action", key: "release-summary" });

const program = Effect.gen(function* () {
 const comments = yield* PullRequestComment;
 yield* comments.upsert(issueNumber, marker, "## Release summary\n\n…");
});
```
