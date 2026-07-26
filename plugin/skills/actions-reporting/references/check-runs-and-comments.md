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
 use: (id: number, conclude: ConcludeCheckRun) => Effect.Effect<A, E, R>,
) => Effect.Effect<A, E | GitHubError, R | Repo>;
```

`use` keeps its own `R` **and** its own `A` — unlike the version this replaces,
whose callback was `R`-less and forced consumers to build self-contained layers
just to use the bracket.

Implementation (`CheckRun.ts:375-389`, with the finalizer at `:250-311`):

```ts
Effect.gen(function* () {
 const run = yield* create(name, headSha);
 const recorded = yield* Ref.make<RecordedConclusion | undefined>(undefined);
 const conclude: ConcludeCheckRun = (conclusion, output) => Ref.set(recorded, { conclusion, output });
 return yield* use(run.id, conclude).pipe(
  Effect.onExit((exit) =>
   Effect.flatMap(Ref.get(recorded), (chosen) => concludeFor(name, run.id, exit, chosen, complete)),
  ),
 );
})
```

**The bracket always reaches a terminal state, and it takes an exit-aware
finalizer to do it.** Left to itself, `concludeFor` reads the `Exit`:

| `use` exits | Default conclusion | Error channel |
| --- | --- | --- |
| success | `"success"` | **not** ignored — failing to record a success is a real failure |
| typed failure, or a defect | `"failure"` | ignored |
| interrupt only (`Cause.hasInterruptsOnly`) | `"cancelled"` | ignored |

`Effect.onExit` runs its finalizer **uninterruptibly**
(`internal/effect.ts`'s `onExitPrimitive` clears `fiber.interruptible` unless
told otherwise), which is what lets the concluding `PATCH` survive the very
interrupt that triggered it.

### `conclude`: the other four conclusions

The defaults answer "how did the *program* end". `conclude` answers "how did
the *check* go", which is a different question and the only one `use` can
answer:

```ts
type ConcludeCheckRun = (
 conclusion: (typeof CheckConclusion.literals)[number],
 output?: CheckRunOutput,
) => Effect.Effect<void>;
```

That is how `"neutral"`, `"timed_out"`, `"action_required"` and `"skipped"`
become reachable without dropping to a raw `create`/`complete` pair. The
motivating case is a **findings-derived** verdict, where `"neutral"` means *ran,
advisory output, does not block branch protection* and a `strict-warnings`
input escalates it to `"failure"`:

```ts
check.withCheckRun("lint", sha, (id, conclude) =>
 Effect.gen(function* () {
  const findings = yield* lint();
  yield* conclude(deriveConclusion(findings, strictWarnings), report(findings));
  return findings;
 }),
);
```

Four properties, each pinned by a test:

1. **It records; it does not send.** The verdict goes in a `Ref` and the
   finalizer writes it — so the completion stays **one** request however many
   times you call `conclude`, and the **last** verdict wins.
2. **A recorded verdict wins on every exit path**, failure and interruption
   included. A findings-derived `"neutral"` is not overwritten by `"cancelled"`
   because the job was torn down afterwards.
3. **`use`'s own `A` is untouched.** `conclude` is a second parameter, not a
   return-value contract — which is also why existing `(id) => …` callbacks
   still compile.
4. **Its error channel is `never`.** The finalizer owns reporting; a caller that
   could observe a failed `complete` there would have to decide what to do about
   it while already on the way out.

Omit `output` to conclude without touching the rendered output — whatever the
last `update` wrote stays.

**Both halves of this replace real defects, fixed 2026-07-25.** The bracket used
to be a `Effect.tap` / `Effect.tapError` pair, which fires on success and on a
*typed* failure only — so an interrupted `use` (a cancelled workflow, a job
timeout, a losing branch of a race) and a defect both left the check run
**`in_progress` forever**. GitHub never reaps such a run, so it blocks branch
protection until someone deletes it by hand. And the four non-default
conclusions were unreachable through the bracket at all, so a findings-derived
verdict meant dropping to a raw `create`/`complete` pair.

Nine tests now pin the bracket (`__test__/resources2.test.ts:99-305`, seven of
them added by this fix) with two discriminating
mutants: reverting to the `tap` form fails the interruption and defect tests
while leaving the success and typed-failure tests green, and restricting the
recorded verdict to the success path fails exactly the two precedence tests.
Both mutants matter — the first proves the finalizer is exit-aware, the second
proves the precedence is real rather than incidental.

### The explicit calls

Still the right tool when you need the run's `id` or `htmlUrl` **outside** the
bracket's scope, or when the run outlives the effect that created it.

| Member | Signature | Note |
| --- | --- | --- |
| `create(name, headSha)` | `Effect<CheckRunRef, GitHubError, Repo>` | Starts `in_progress` (`CheckRun.ts:317-329`) |
| `get(id)` | `Effect<CheckRunRef, GitHubError, Repo>` | (`CheckRun.ts:353-362`) |
| `update(id, output)` | `Effect<void, GitHubError, Repo>` | Output truncated on the way out (`CheckRun.ts:364-373`) |
| `complete(id, conclusion, output?)` | `Effect<void, GitHubError, Repo>` | `output` optional; truncated when present (`CheckRun.ts:331-347`) |

`CheckRunRef` is `{ id, name, url, status }` (`CheckRun.ts:106-112`); `url`
falls back to `""` when GitHub's `html_url` is absent (`refOf`,
`CheckRun.ts:313-314`).

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
(`CheckRun.ts:228-247`) on every request, so truncation is automatic. Call
`.truncated()` directly only when you need the cut value before sending it —
logging what will actually reach GitHub, for instance.

```ts
import { CheckRunOutput } from "@effected/github";

const output = CheckRunOutput.make({
 title: "lint",
 summary: "3 findings.",
 // text and annotations are optionalKey — omit the key entirely to leave
 // them unset. Do NOT pass an explicit `undefined` for either (see below).
});
```

**There are TWO ways to get burned here, and migrators meet the misleading
one first.**

**Trap (a) — the bare object literal, and a compile error that lies to you.**
Passing a plain `{ title, summary }` literal where a `CheckRunOutput` is
expected (e.g. straight into `conclude(...)`) fails at compile time with
TS2741: **"Property 'truncated' is missing"**. The compiler is demanding the
instance *method* — a class instance is not a plain object — but its error
text names `truncated` as if it were a data field you forgot, which is
exactly how a migrator ends up hunting for a field that does not exist. The
fix is not to add anything: construct through `CheckRunOutput.make({...})`
and the literal becomes a real instance, method included.

**There is no `truncated` field on this schema — do not go looking for one.**
`truncated()` is the instance *method* above, not a constructor input; `make`
takes exactly `title`, `summary`, and the two `optionalKey` fields `text` and
`annotations`.

**Trap (b) — explicit `undefined` on an `optionalKey`, a runtime throw.**
This one sits one level up, and it is this package's
general v4 constructor rule, not something special to check runs: `text` and
`annotations` being `optionalKey` means the **key** may be omitted, not that
the value may be `undefined` — `CheckRunOutput.make({ title, summary, text:
maybeUndefinedString })` throws at construction the moment
`maybeUndefinedString` actually is `undefined`, and the thrown error names a
schema issue, not "you passed `text: undefined`." Build the object with a
conditional spread instead:

```ts
CheckRunOutput.make({
 title,
 summary,
 ...(renderedText === undefined ? {} : { text: renderedText }),
});
```

This is the same conditional-spread discipline `CheckRunOutput.truncated()`
itself follows internally (`CheckRun.ts:75-81`) and that `effect-v4-idioms`
states generally — check runs are simply where a caller is most likely to
have an optional `text`/`annotations` value in hand already.

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
(`wireOutput`, `CheckRun.ts:236-245`) — the same readable-vocabulary /
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
