---
id: "0052"
title: Core fixes that change a result you may have tested
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.2"
detect: ["ByteSize\\.(kilo|mega|giga|tera|peta|kibi|mebi|gibi|tebi|pebi)bytes", "groupAdjacentBy", "DateTime\\.(startOf|endOf|nearest)", "Iterable\\.(unfold|filterMapWhile)", "Schedule\\.(fixed|windowed|cron)", "withCookiesRef"]
---

Effect 4.1.2 fixes several functions whose old output a test may have pinned. Each detect hit names one of them; re-run the tests that cover it and update the expectation to the corrected result, never back to the old one.

Probed on 4.1.1 and 4.1.2:

- **`ByteSize` decimal units** accept a decimal that lands on a whole byte count. `ByteSize.megabytes(2.01)` threw before and is now 2,010,000 bytes. A quantity that lands on a fractional byte count, such as `kilobytes(0.0005)`, still throws.
- **`Stream.groupAdjacentBy`** emits its last group before the stream's failure. Before, the group was dropped.
- **`Iterable.unfold`** no longer calls the generating function again after it has returned `done`. `filterMapWhile` gets the same fix in the changelog, unprobed.
- **`DateTime.startOf`, `endOf` and `nearest`** keep a zoned `DateTime` in the occurrence of a repeated DST hour it started in. `startOf(d, "hour")` at 01:30 EST on the America/New_York fall-back day returned 01:00 EDT, an hour early; it now returns 01:00 EST.

From the changelog, not probed:

- `Schedule.fixed`, `windowed` and `cron` no longer return a zero delay when the clock sits a fraction of a nanosecond before the next run.
- `HttpClient.withCookiesRef` selects cookies for the request's final URL, including a `baseUrl` applied after it and each redirect hop. Before, such requests went without cookies.

Check against the installed `.d.ts`; no signature changed.
