---
id: "0023"
title: Base64Url.decode and BigDecimal.fromString reject more input
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.0"
detect: ["Base64Url\\.decode", "BigDecimal\\.fromString"]
---

`Base64Url.decode` rejects partially padded input (`Zg=`). `BigDecimal.fromString` rejects scales beyond ±10,000. Input that decoded before may now fail; decide whether to normalise the input or surface the failure.

From the Effect changelog, not probed by the kit. Only tests find it.
