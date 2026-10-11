---
"@effected/github": minor
---

## Features

### Single-flight installation tokens

`GitHubApp.cachedToken` now single-flights concurrent misses per installation within one process, through a new `GitHubAppShape.cachedToken` member built with the layer (`makeTest` honours an override). Closes #999.

* Joiners receive the new `CachedToken.source` value `"joined"`; the union is now `"cached" | "minted" | "joined"`.
* A failed mint fails every waiter with the same `GitHubAppError` and releases the key.
* Interrupting the leader leaves the mint running for waiters.
* The key is the installation id only. Cross-isolate double-minting remains accepted.

## Dependencies

| Dependency | Type           | Action  | From  | To     |
| :--------- | :------------- | :------ | :---- | :----- |
| effect     | peerDependency | updated | 4.0.2 | ^4.0.3 |
