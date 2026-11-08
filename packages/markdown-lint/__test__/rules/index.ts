// The five example rules in the order systems' ChangesetLinter runs them.

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
