// savvy-web's five changeset house-style rules, test-only copies kept as an
// engine-fidelity corpus (see fixtures/changesets/README.md); the kit ships
// none of them. In the order systems' ChangesetLinter runs them.

import { ContentStructure } from "./content-structure.js";
import { DependencyTableFormat } from "./dependency-table-format.js";
import { HeadingHierarchy } from "./heading-hierarchy.js";
import { RequiredSections } from "./required-sections.js";
import { UncategorizedContent } from "./uncategorized-content.js";

export const changesetRules = [
	HeadingHierarchy,
	RequiredSections,
	ContentStructure,
	DependencyTableFormat,
	UncategorizedContent,
] as const;
