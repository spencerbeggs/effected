---
id: "0033"
title: "effect/DateTime: DateTime.make parses zoneless strings as UTC and accepts UT, UTC and US time-zone abbreviations"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.5"
detect: ["DateTime\\.make(Unsafe)?\\("]
---

`DateTime.make` parses strings more predictably (Effect-TS/effect#10690, #10562, #10620). A probe on both versions ran under `TZ=America/Los_Angeles`:

| Input | Old | New |
| --- | --- | --- |
| `"2024-1-15"` | `2024-01-15T08:00:00.000Z` (local midnight) | `2024-01-15T00:00:00.000Z` (UTC midnight) |
| `"Mon, 15 Jan 2024 10:00:00 PDT"` | `None` | `2024-01-15T17:00:00.000Z` |
| `"2024-01-15T10:00:00"` | `2024-01-15T10:00:00.000Z` | unchanged |

- **A zoneless non-ISO date string is now UTC, not the runner's local time.** Results no longer depend on `TZ`. A test that passed only in one time zone, or code that compensated for the local offset, needs its expectation corrected.
- **A string ending in `UT`, `UTC` or a US abbreviation such as `PDT` now parses**, where it used to fail. A test asserting that such input is rejected now fails.
- A whitespace-separated time zone followed by trailing whitespace or a single comment is now honoured instead of ignored.

Read each hit for the input shapes it accepts. Verify with the date tests, ideally run under two `TZ` values.
