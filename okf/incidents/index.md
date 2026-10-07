# Incident

* [A zero-width space never stopped the Actions runner reading a workflow command](zero-width-neutralizer-never-defeated-the-runner.md) - CommandNeutralizer shipped putting U+200B before a :: line and inside ##\[, but the runner matches with culture-sensitive .NET comparisons under ICU, which skip zero-width characters, so every neutralized line was still a command; it now matches through what ICU skips and marks with U+2800.
