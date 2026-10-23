---
"@effected/cli": minor
---

## Features

- `Fmt.duration` accepts any `Duration.Input`. A number is still milliseconds and is used as given; a `bigint` is nanoseconds, as in core. An invalid, negative or infinite input formats as `0ms` instead of throwing.

## Documentation

- Fixes API Extractor link and code-span warnings in the `ui` TSDoc.
