---
"@effected/copilot-plugin": patch
"@effected/claude-code-plugin": patch
---

## Other

- effected-packages skill: the memfs index row and reference now cover the inspection and fault-injection families (layerInspectable/layerInspectableWith publishing Volume, the makeInspectable/makeInspectableWith value-level pair, layerFaulty/layerFaultyWith/makeFaulty with failTimes), document the per-provide re-seed hazard that made post-run "nothing written" assertions vacuous, and give the Layer.provideMerge composition for fault injection plus read-back in one graph (effected#608).
