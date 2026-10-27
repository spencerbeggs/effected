---
"@effected/schemastore-cli": patch
---

## Bug Fixes

* The internal cause-message helper no longer throws when an error's `message` or `cause` getter (or a proxy trap) throws; that node is read as having no message.
