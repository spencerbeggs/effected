# When a JSON input earns a published schema

## Line-list inputs first

Prefer a line-list or comma-separated input over a JSON-shaped one whenever
the values are flat: a list of paths, a list of scopes, a set of flags.
Line-list inputs read better in workflow YAML — no quoting, no escaping,
no JSON syntax a workflow author has to get exactly right in a string
field. Reach for `ActionInput.schema(name, schema)` — a JSON-parsed,
schema-decoded input — only when the input is genuinely nested structure
that a flat encoding can't represent cleanly: a config object with several
independent optional sections, for instance.

## JSON Schema publication is conditional, not automatic

Publishing a JSON Schema for an input is mandatory whenever a JSON
contract crosses the action boundary — input or output — and skipped
entirely for a flat or line-list action with no JSON surface at all.
When it applies, generate the document from the same `Schema` the input
decodes through, via `@effected/schemastore`'s `StoreDocument` assembly
rather than a hand-rolled JSON Schema lowering: the package owns the
SchemaStore-shaped document assembly, catalog modes, and fileMatch
hygiene lint that a hand-written document would have to reinvent and keep
in sync by hand.

Commit the generated schema, validate it with ajv, and drift-test it the
same way an output contract is drift-tested (see
`references/output-contracts.md`) — one schema, one generator, one
committed artifact, checked for byte-for-byte agreement on every run.

## Why this belongs at design time, not as a later add-on

A JSON input without a published schema still works — `ActionInput.schema`
decodes it regardless — but a workflow author editing the action's calling
YAML gets no completion, no validation, and no documentation beyond
whatever prose lives in `action.yml`. Deciding whether an input's shape
earns a published schema is part of freezing the input/output contract at
design time, alongside choosing line-list versus JSON in the first place —
retrofitting publication after the shape has shipped means the schema has
to describe a contract already in the wild rather than one still being
designed.
