---
type: Interface
title: "@effected/markdown frontmatter"
description: The frontmatter capture node, its read/write codec contract, the $schema declaration grammar and resolver seam, and the string-level split/join facade.
status: stable
kind: api
resource: ../../packages/markdown/src/Frontmatter.ts
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-11-07T02:02:05Z
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:41.636Z
  - by: human:spencer
    at: 2026-10-13T21:42:59Z
  - by: human:spencer
    at: 2026-11-08T18:25:54Z
integrity:
  generated:
    body: 05f269156eb28341
  verified:
    by: human:spencer
    at: 2026-11-08T18:25:54Z
    content: e1c9a443a67b49d9
---

# `@effected/markdown` frontmatter

Frontmatter is the one subsystem of the [markdown module](../modules/markdown.md)
that reaches across packages: the engine captures the frontmatter block as a
raw fidelity-preserving node, and three free-standing codec modules — each on
an optional peer, `@effected/yaml`, `@effected/toml` or `@effected/jsonc` —
decode and encode its body.

## The capture node

The core engine captures the frontmatter block as a raw fidelity-preserving
node: text plus a format marker. Schema decoding ships as free-standing
named codec modules, one per format, each peering on its corresponding
format package. Never a namespace object: the kit's tree-shaking rule
applies verbatim, and a JSON-frontmatter consumer must not pay for the
`yaml` engine. mdast has no native frontmatter parsing story, so this is a
differentiator from the wider ecosystem.

Capture defaults off: an enabled capture changes how a leading `---` parses,
and the CommonMark and GFM spec corpora contain documents that open that
way, so the toggle is a consumer opt-in and the conformance harnesses run
untouched. The fence grammar is a closed set — the yaml, toml and JSON
spellings, with the `gray-matter` and `remark-frontmatter` npm packages as
the external authorities the grammar was checked against. An unclosed fence
is not frontmatter and emits no diagnostic; the document's fence state reports
it instead, so a linter can. The capture runs as an offset-0
pre-scan in the block-parser constructor rather than as a registry
construct, because it fires at most once and before any block. One capture
node exists, not per-format classes: mdast has no JSON frontmatter type
name, so a per-format split would invent a non-mdast type anyway, and one
shape keeps the codec contract format-uniform. The root's children widen to
admit frontmatter at the root and nowhere else.

The node's optional `valueStart` is the UTF-16 code-unit offset in the parsed
source where its value begins, the start of the line after the opening fence.
A format parser's offset inside the value plus `valueStart` is the offset in
the whole file, with no fence arithmetic in the consumer. The parser always
sets it; a node built with `make` or admitted by `Mdast.fromMdast` has none,
and neither the stringifier nor the `Mdast` projection reads it.

## Read and write

The `FrontmatterCodec` contract carries both directions, and `encode` is
required, not optional — the codecs stay field-identical, pinned by a
contract-shape test. Encoding serializes data to the body text that belongs
between the fences and never the fences themselves, which are
format-determined and rendered by the write seam.

The write seam normalizes the trailing terminator, because the engines
genuinely disagree: `@effected/yaml` and `@effected/toml` emit a final
newline and the JSON codec matches `JSON.stringify` and does not.
Normalizing at the one render site rather than in each codec keeps the
divergence from leaking into the contract — this is the recorded
"trailing-newline asymmetry" rough edge in the kit's parity surface, per the
[format-package convention](../conventions/format-package-convention.md).

The writer produces exactly one edit: either a replacement spanning the
whole capture, both fence lines included, or, with no capture present, an
offset-0 insert of the block plus a separator. A capture of a different
format fails typed — fences are never switched, so writing cannot silently
convert a toml block to yaml. The parse precondition mirrors the read side,
because without the capture toggle, absence is ambiguous, and the insert
path would otherwise double a block the parse ignored.

Per-codec empty-object rulings are each chosen so write-then-read recovers
an empty object: `@effected/yaml` encodes an empty object to the flow
mapping `{}`, deliberately not an empty body, because an empty body would
round-trip as yaml's empty-document null and lose the object; `@effected/toml`
encodes to the empty body, mirroring the decode ruling that an empty toml
capture is an empty object; the JSON codec encodes to braces, having no
empty-document value in either direction.

Whole-block re-serialization is the caveat: the block is re-serialized whole
from the encoded data — `gray-matter` parity, not surgical editing — so
anything the format's data model does not carry is lost, and comments inside
a yaml frontmatter block do not survive a write. Per-key surgical frontmatter
editing over the format packages' own edit layers is recorded future work;
the siblings already ship the machinery it would sit on.

## Absence is three facts, and the discriminant is derived

The missing-frontmatter error carries a required reason, because three
different problems look the same from an empty capture, and each has its own
fix. `absent` is a genuinely blockless document, which needs content.
`captureDisabled` is a document with a well-formed block that was parsed
without the capture toggle, which needs a parse option. `unclosed` is a
document whose opening fence no closing fence follows: per the grammar that is
not frontmatter, so nothing is captured, but the author almost certainly meant
a block, and the fix is the missing closing fence.

Two accessors answer this, both derived, not stored. `hasFrontmatterBlock`
runs the same offset-0 pre-scan the parser runs when capture is enabled, so it
is true exactly when parsing this source with capture on would produce a node.
`frontmatterFence` reports the head of the source as `absent`, `unclosed` or
`closed` however the document was parsed, and `closed` holds exactly when
`hasFrontmatterBlock` does. A stored flag set at parse time would be a second
source of truth for a question the source already answers, and the failure
mode would be silent — a document constructed or edited without going through
that path would report an absence contradicting its own bytes. Because the
error's reason reads the same accessors, the error, the getters and the capture
agree by construction. The cost is honest: they recompute per access like every
other navigation accessor, so a caller checking repeatedly should bind them
once.

## The `$schema` declaration grammar and resolver seam

Frontmatter blocks may self-describe their schema. The package classifies
the declaration by shape into a tagged union, and this is the full grammar
contract:

- **By URL** and **by path** are carried as data and never resolved
  in-package — no IO in the pure tier.
- **Inline** (the value is a mapping) is likewise carried as data,
  interpretable only via an external resolver. The kit deliberately has no
  JSON Schema engine.
- **By name** is any other string, with a committed grammar of
  `name[@version]`, split at the last `@` so a leading npm-style scope
  survives. The version grammar is internal and dependency-free: one to
  three dot-separated non-negative integers, with no prerelease, no build
  metadata and no range operators. `@effected/semver` was consciously
  declined as a peer here so the resolver module depends on nothing. The
  recorded cost: `@` in a by-name declaration is reserved forever as the
  version separator, except the leading scope `@`.

Resolution lives behind an in-package seam: a resolver contract that, given
the declaration and the whole decoded frontmatter data, returns a schema or
fails typed. The package ships one registry-backed implementation. Because
the resolver sees the whole decoded frontmatter, dispatch need not key on
the declaration at all — a resolver for a foreign convention can dispatch on
that convention's own key with zero knowledge of it in this package.

Resolution is exact version-segment equality, compared numerically per
segment, so leading zeros are legal and numerically colliding registrations
throw at construction as programmer errors. A versionless declaration
matches only a versionless registration; both mismatch directions fail with
the dedicated version error rather than unknown-name. A partial version is
legal grammar yet resolves only against an identically-written registration.
The documented future minor is prefix resolution — the Docker-tag mental
model, where a partial version selects the highest matching registration; no
grammar or API change is needed, since the version error would simply stop
firing for satisfiable prefixes.

## The string-level facade

`FrontmatterSource.split`/`.join` (`packages/markdown/src/FrontmatterSource.ts`)
is a string-level, pure, total frontmatter facade: split raw source into its
frontmatter block and body without parsing the body, or the frontmatter
value, at all. It exists for a consumer whose body the CommonMark engine
cannot or should not parse (an MDX page whose body is not CommonMark, a
template) and whose contract is byte-exact boundaries — a snapshot hash over
the body, for example. It runs the same closed fence grammar as the parser's
offset-0 pre-scan (`---` yaml, `+++` toml, `---json` json; a fence line is
exactly the fence; an unclosed fence is not frontmatter) via a shared
primitive, so the string-level and parsed-tree surfaces can never disagree
about whether a document has frontmatter. Unlike the parse path, there is no
capture toggle at this level, so `captureDisabled` does not apply, since this
surface always looks: the block is absent exactly when the source has no closed
one. The other two reasons remain, and `split` tells them apart with `fence`
(`FrontmatterFenceState`: `absent` for no opening fence, `unclosed` for one that
never closes, `closed` for a block) and `fenceFormat`, the format the opening
fence declared whenever there was one. `join` reads neither. A block `split`
produced also records `valueStart` and `valueEnd`, UTF-16 code-unit offsets with
`source.slice(valueStart, valueEnd) === value`, which `join` ignores too.

`FrontmatterSourceBlock.value` deliberately differs from the parsed
`Frontmatter` node's `value`: the string-level surface keeps every line's own
terminator (so a one-blank-line block stays distinct from a
no-value-lines block, and interior CRLF survives), while the node's `value`
drops the final terminator for the codecs' benefit. `split`/`join`
round-trip byte-for-byte except at two documented normalization edges: a
closing fence at end-of-document gains a final newline on `join`, and
mismatched open/close fence-line terminators re-emit both with the opening
one — value and body bytes survive verbatim in every case.
