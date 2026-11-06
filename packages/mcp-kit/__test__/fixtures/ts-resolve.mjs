// Lets `node` run this package's TypeScript sources directly. Workspace links resolve to each sibling's source, which
// plain type stripping cannot run, so the process runs under tsx.
import "tsx";
