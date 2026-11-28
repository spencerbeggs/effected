---
id: "0028"
title: "@effected/cli-kit: Fmt.durationWords writes a duration in words (\"2 hours 30 minutes\")"
kind: adopt
shows: none
applies:
  "@effected/cli-kit": ">=0.33.0"
detect: ["Duration\\.to(Minutes|Seconds|Hours|Days)"]
closes: ["#1447"]
changesets: ["fix-duration-prose-cli-kit"]
---

`Fmt.durationWords(input, { parts?, smallest? })` writes a `Duration` for a sentence: `5 minutes`, `1 minute`, `2 hours 30 minutes`, where `Duration.format` and `Fmt.duration` write the compact `5m`. Find a phrase built by hand from `Duration.toMinutes` (or `toSeconds`, `toHours`) with its own singular and plural branch, and replace it. It drops the remainder rather than rounding, skips zero units and writes two parts by default; check the zero, negative and infinite cases against the installed `.d.ts` before swapping a message a test pins.
