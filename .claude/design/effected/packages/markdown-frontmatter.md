---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 90
related:
  - markdown.md
  - markdown-mdx.md
  - config-file.md
  - yaml.md
  - toml.md
  - jsonc.md
  - semver.md
---

# @effected/markdown — frontmatter

## Overview

Frontmatter is the one subsystem of [`@effected/markdown`](markdown.md) that reaches across packages: the engine captures the block as a raw fidelity-preserving node, and three free-standing codec modules — each on an optional peer, [yaml](yaml.md), [toml](toml.md) or [jsonc](jsonc.md) — decode and encode its body. Alongside them sit the write seam, the string-level `FrontmatterSource` facade and the `$schema` declaration grammar with its resolver seam.

## The capture node

The core engine captures the frontmatter block as a raw fidelity-preserving node — text plus a format marker. Schema decoding ships as **free-standing named codec modules**, one per format, peering on the corresponding format package. **Never a namespace object**: the [config-file tree-shaking rule](config-file.md) applies verbatim, and a JSON-frontmatter consumer must not pay for the yaml engine. mdast has no native frontmatter parsing story, so this is a differentiator.

**Capture defaults off.** An enabled capture changes how a leading `---` parses and the spec corpora contain such documents, so the toggle is the consumer's opt-in and the conformance harnesses run untouched.

**The fence grammar is a closed set** — the yaml, toml and JSON spellings, with gray-matter and remark-frontmatter as the authorities. An unclosed fence is not frontmatter and emits no diagnostic. The capture runs as an offset-0 pre-scan in the block-parser constructor rather than as a registry construct, because it fires at most once and before any block.

**One capture node, not per-format classes.** mdast has no JSON frontmatter name, so a per-format split would invent a non-mdast type anyway, and one shape keeps the codec contract format-uniform. The root's children widen to admit frontmatter at the root and nowhere else.

## Read and write

The codec contract carries **both directions, and encode is required, not optional** — the codecs stay field-identical, pinned by a contract-shape test. Encoding serializes data to the body text that belongs **between** the fences and never the fences themselves, which are format-determined and rendered by the seam.

**The seam normalizes the trailing terminator**, because the engines genuinely disagree: two of the three emit a final newline and the JSON one matches `JSON.stringify` and does not. Normalizing at the one render site rather than in each codec keeps the divergence from leaking into the contract.

The writer produces **exactly one edit** — either a replacement spanning the whole capture, both fence lines included, or with no capture an offset-0 insert of the block plus a separator. **A capture of a different format fails typed**: fences are never switched, so writing cannot silently convert a toml block to yaml. The parse precondition mirrors the read side, because without the capture toggle absence is ambiguous and the insert path would double a block the parse ignored.

**Per-codec empty-object rulings** are each chosen so write-then-read recovers an empty object: yaml encodes to the flow mapping, deliberately not an empty body, because an empty body round-trips as yaml's empty-document null and would lose the object; toml encodes to the empty body, mirroring the decode ruling that an empty toml capture is an empty object; JSON encodes to braces, having no empty-document value in either direction.

**Whole-block re-serialization is the caveat.** The block is re-serialized whole from the encoded data — gray-matter parity, not surgical editing — so anything the format's data model does not carry is lost, and comments inside a yaml frontmatter block do not survive a write. A per-key surgical mode over the format packages' own edit layers is recorded future work; the siblings already ship the machinery it would sit on.

## Absence is two facts, and the discriminant is derived

The missing-frontmatter error carries a required reason, because a genuinely blockless document and a document that opens with a fence but was parsed without the capture toggle are **different problems with different fixes**: the first needs content, the second needs a parse option.

The ruling worth keeping is *how* the accessor answers: **derived, not stored.** The getter runs the **same** offset-0 pre-scan the parser runs when capture is enabled, so it is true exactly when parsing this source with capture on would produce a node. A stored flag set at parse time would be a second source of truth for a question the source already answers, and the failure mode is silent — a document constructed or edited without going through that path would report an absence contradicting its own bytes. Because the error's reason reads the same accessor, the error, the getter and the capture **agree by construction**. The cost is honest: it recomputes per access, like every other navigation accessor, so bind it once when checking repeatedly.

## The `$schema` declaration grammar and resolver seam

Frontmatter blocks may self-describe their schema. The package **classifies the declaration by shape** into a tagged union and this is the full grammar contract:

- **By URL** and **by path** are carried as data and never resolved in-package — no IO in the pure tier.
- **Inline** (the value is a mapping) is likewise carried as data, interpretable only via an external resolver. The kit deliberately has no JSON Schema engine, and `@effected/json-schema` is off the roadmap entirely.
- **By name** is any other string, with a committed grammar of `name[@version]`, **split at the last `@`** so a leading npm-style scope survives. The version grammar is internal and dependency-free: one to three dot-separated non-negative integers, with no prerelease, no build metadata and no range operators. [@effected/semver](semver.md) was consciously declined as a peer so the resolver module depends on nothing. The recorded cost: `@` in a by-name declaration is reserved forever as the version separator, except the leading scope `@`.

Resolution lives behind an in-package **seam**: a resolver contract that, given the declaration **and the whole decoded frontmatter data**, returns a schema or fails typed. The package ships one registry-backed implementation. Because the resolver sees the whole decoded frontmatter, **dispatch need not key on the declaration at all** — a resolver for a foreign convention can dispatch on that convention's own key with zero knowledge of it in this package.

Resolution is **exact version-segment equality**, compared numerically per segment, so leading zeros are legal and numerically colliding registrations throw at construction as programmer errors. A versionless declaration matches only a versionless registration; both mismatch directions fail with the dedicated version error rather than unknown-name. A partial version is legal grammar yet resolves only against an identically-written registration.

The documented future minor is **prefix resolution** — the Docker-tag mental model, where a partial version selects the highest matching registration. No grammar or API change is needed; the version error simply stops firing for satisfiable prefixes, which makes it a clean semver-minor evolution.

## The string-level facade

**`FrontmatterSource.split`/`.join`** (`src/FrontmatterSource.ts`) is a **string-level, pure, total** frontmatter facade — split raw source into its frontmatter block and body without parsing the body, or the frontmatter value, at all. It exists for the consumer whose body the CommonMark engine cannot or should not parse (an MDX page whose body is not CommonMark, a template) and whose contract is byte-exact boundaries — a snapshot hash over the body, say. It runs the **same closed fence grammar** as the parser's offset-0 pre-scan (`---` yaml, `+++` toml, `---json` json; a fence line is exactly the fence; an unclosed fence is not frontmatter) via a shared primitive, `scanRawFrontmatter` in `src/internal/blocks/frontmatter.ts` — **not a duplicated grammar**: the block parser's own `scanFrontmatter` and this raw variant are two call sites over the one set of fence rules, so the string-level and parsed-tree surfaces can never disagree about whether a document has frontmatter. Unlike the parse path there is no capture toggle at this level, so absence is one fact here (the tree parse path's two-reason absence — capture toggled off vs. genuinely blockless — does not apply, since this surface always looks).

`FrontmatterSourceBlock.value` deliberately differs from the parsed `Frontmatter` node's `value`: the string-level surface keeps every line's own terminator (so a one-blank-line block stays distinct from a no-value-lines block, and interior CRLF survives), while the node's `value` drops the final terminator for the codecs' benefit. `split`/`join` round-trip byte-for-byte except at two documented normalization edges: a closing fence at end-of-document gains a final newline on `join`, and mismatched open/close fence-line terminators re-emit both with the opening one — value and body bytes survive verbatim in every case.
