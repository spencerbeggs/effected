---
type: Decision
title: Markdown dialects are a closed set with no public extension API
description: "@effected/markdown exposes a dialect option (CommonMark or GFM) with no plugin mechanism, matching the yaml and toml packages' zero-plugin posture."
status: draft
tags:
  - architecture
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 580ffba2579d513c
---

# Markdown dialects are a closed set with no public extension API

## Context

CommonMark and GFM are the two dialects `@effected/markdown` needs to
support today, and an `obsidian` dialect is an explicit future design goal.
The package needed to decide up front whether dialect support would be a
public plugin mechanism a consumer could extend, or a closed, in-package
set — a decision that becomes very expensive to reverse once a plugin
contract ships and consumers depend on it.

## Decision

Dialects are a closed set with no public extension API, matching `toml` and
`yaml`'s zero-plugin posture. A dialect option defaults to GFM, plus a
frontmatter capture toggle. GFM means tables, strikethrough, autolink
literals, task-list items and tagfilter, plus footnotes — a
cmark-gfm/GitHub extension rather than GFM spec text proper, included as
table stakes. A future `obsidian` dialect must land purely as new construct
modules in the package's internal dialect registries, with no public API
change — that constraint is the acceptance test for the registry design
itself. Two constructs (footnote handling inside close-bracket handling, and
the image-opener guard that stops a footnote marker from opening an image)
are expressed as parameterized construct factories swapped into the GFM
table rather than as registry entries, because that is how cmark-gfm itself
expresses them; the CommonMark dialect takes the no-seam defaults and stays
byte-for-byte unchanged.

## Alternatives rejected

**A public plugin API letting a consumer register their own dialect or
construct.** Rejected for the same reason `toml` and `yaml` rejected it:
once a plugin contract is public, every future internal refactor of the
block-starts and inline-trigger registries is constrained by what a
third-party plugin might already depend on. A closed set keeps the
registries as a pure internal implementation detail, free to change shape
as long as the `dialect` option's observable behavior does not.

## Consequences

Consumers who need a markdown construct outside CommonMark/GFM/`obsidian`
cannot add it without a change to this package itself. The trade is a
smaller, more stable public surface and freedom to restructure the internal
registries; the `obsidian` dialect, when it lands, is the proof this
constraint holds under real pressure to extend the vocabulary.
