---
id: "0045"
title: Adopt effect/encoding/Csv and effect/http/ProblemDetails
kind: adopt
shows: none
applies:
  effect: ">=4.1.0"
detect: ["csv-parse", "csv-stringify", "papaparse", "fast-csv", "problem\\+json"]
---

Core ships `effect/encoding/Csv` and `effect/http/ProblemDetails` (RFC 9457 problem responses).

Where to look: a CSV dependency, and hand-built `application/problem+json` bodies. Compare dialect options (quoting, headers, line endings) with your current parser before switching. Check the installed `effect/dist/encoding/Csv.d.ts` and `effect/dist/http/ProblemDetails.d.ts`.
