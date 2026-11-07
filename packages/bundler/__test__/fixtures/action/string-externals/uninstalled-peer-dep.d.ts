// Ambient declaration so the fixture type-checks. The module is intentionally
// absent from node_modules — only the bundler's externals handling makes the
// build resolve it. See issue #81.
declare module "uninstalled-peer-dep";
