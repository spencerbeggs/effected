---
"@effected/ai-plugins": patch
---

## Maintenance

* Closes the `effected-renovate` upgrade-ledger round released in 0.48.0, so the shipped ledger starts empty from that release
* A repository older than the new baseline still gets every entry it crossed, fetched from the 0.48.0 release tag
