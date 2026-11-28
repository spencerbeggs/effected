---
"@effected/cli-kit": minor
---

## Features

- `Fmt.durationWords(input, { parts?, smallest? })` writes a duration in words for a sentence: `5 minutes`, `1 minute`, `2 hours 30 minutes`. Core's `Duration.format` and `Fmt.duration` only write the compact form (`5m`). The units run from days to milliseconds. Units that are zero are skipped, and the first two of the rest are written by default. The remainder is dropped and never rounded up. Zero is `0 milliseconds` and infinity is `infinity`. A negative or unreadable input counts as zero. The new `DurationWordsOptions` and `DurationWordsUnit` types describe the options.
