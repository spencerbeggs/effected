// `node --import register-ts.mjs fixture.mts` runs a fixture against the package sources without a build. Workspace
// links resolve to each sibling's source, which plain type stripping cannot run, so the fixture runs under tsx.
import "tsx";
