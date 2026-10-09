---
type: Decision
title: Image formats are read by in-house header readers
description: PNG, JPEG, GIF, WebP and AVIF dimensions are read by small hardened readers under src/internal rather than by wrapping or vendoring image-size.
status: draft
tags:
  - architecture
  - deps
  - security
generated:
  by: "okfit/claude-code"
  at: 2026-10-09T14:42:08Z
  body_sha256: cf09eccc51fb6ed0f3198edb18e0f547bc2f02b8973f44d90259ac55180771c2
verified:
  - by: human:spencer
    at: 2026-10-09T17:05:48Z
---

# Image formats are read by in-house header readers

## Context

The three named consumers (tsdoctor twice, systems once) all use the `image-size` npm package to read format and dimensions, each with a private try/catch and a private MIME table. [`@effected/images`](../modules/images.md) replaces that with a typed `ImageFacts` and one `ImageParseError`. The question is where the format knowledge comes from.

## Decision

One reader per format lives under `src/internal/`, each reading only the header bytes it needs and returning a `Result`. They follow the [input-hardening standards](../conventions/input-hardening-standards.md): every offset and length is bounds-checked, the JPEG segment walk and the AVIF box walk carry a step budget, and nothing is allocated in proportion to a length field read from the input. The `toml` and `glob` packages are the precedent for an in-house engine.

## Alternatives rejected

- **Wrapping `image-size`.** It would make the package integrated tier, and under R2 that propagates to every kit dependent; it would also leave the typed parse failure to be reconstructed from a thrown error.
- **Vendoring image-size's readers.** It inherits maintenance for formats no consumer needs (BMP, ICO, TIFF, HEIC and others) and for code written without the bounded-walk and typed-failure requirements.

## Consequences

Five formats are supported; SVG, other raster formats and EXIF orientation are excluded until a consumer names them. The hardening tests (every fixture truncated at every offset, endless-segment JPEG, self-referential AVIF boxes, a never-throws property test) are the package's own obligation, not an upstream's.
