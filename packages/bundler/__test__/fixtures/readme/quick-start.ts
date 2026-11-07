import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Bundler, EffectedConfigFile } from "@effected/bundler";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const discovery = WorkspaceDiscovery.layer().pipe(
  Layer.provideMerge(WorkspaceRoot.layer),
  Layer.provideMerge(platform),
);

const program = Effect.gen(function* () {
  const cwd = process.cwd();
  const { config } = yield* EffectedConfigFile.load({ cwd });
  const result = yield* Bundler.build({
    cwd,
    config: config.package.build,
    tsdoctor: config.package.tsdoctor,
    noExe: false,
    verbose: false,
    plugins: [],
    ci: Boolean(process.env.CI),
  });
  return result.issuesPath;
});

Effect.runPromise(program.pipe(Effect.provide(discovery))).then(console.log);
