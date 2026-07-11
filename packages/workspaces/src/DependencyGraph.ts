// The inter-workspace dependency graph — a pure VALUE, not a service.
//
// v3 shipped this as two services (`DependencyGraph` and `TopologicalSorter`)
// wrapping a `Request`/`RequestResolver` cache with a one-minute TTL over a
// `Map.get`. There is no batching win on a single-key resolver and nothing to
// deduplicate that discovery's own memo has not already done, so both services
// and the whole request machinery are deleted. Sorting is a pure function of
// the graph, so it lives here as a method.
//
// Cycle detection is ITERATIVE. v3's was a recursive DFS closure — the one
// stack-overflow surface the lockfiles/glob extractions left behind.

import { Effect, Schema } from "effect";
import { PackageNotFoundError } from "./WorkspaceDiscovery.js";
import { WorkspacePackage } from "./WorkspacePackage.js";

/**
 * Raised when the workspace dependency graph cannot be topologically ordered
 * because it contains a cycle.
 *
 * @remarks
 * `cycle` lists every package still carrying unsatisfied dependencies when
 * Kahn's algorithm stalls — the strongly-connected residue, sorted. It is the
 * set to break, not necessarily a single ordered loop.
 *
 * @public
 */
export class CyclicDependencyError extends Schema.TaggedErrorClass<CyclicDependencyError>()("CyclicDependencyError", {
	/** The packages participating in the cycle. */
	cycle: Schema.Array(Schema.String),
}) {
	/** Renders the cycle members into a one-line message. */
	override get message(): string {
		return `Cyclic workspace dependencies among: ${this.cycle.join(", ")}`;
	}
}

interface Edges {
	/** name → the workspace packages it depends on. */
	readonly forward: ReadonlyMap<string, ReadonlySet<string>>;
	/** name → the workspace packages that depend on it. */
	readonly reverse: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The directed graph of dependencies **between workspace packages**. External
 * npm dependencies are not nodes.
 *
 * @remarks
 * A pure value over the discovered package list, with the edge indexes built
 * lazily into `#private` fields the schema never encodes. Edges are drawn from
 * `dependencies`, `devDependencies`, `peerDependencies` and
 * `optionalDependencies`; a self-edge is dropped.
 *
 * Total accessors never fail; the four fallible operations are `Effect.fn`
 * boundaries.
 *
 * @example
 * ```ts
 * import { DependencyGraph, WorkspaceDiscovery } from "@effected/workspaces";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* WorkspaceDiscovery;
 *   const graph = DependencyGraph.make({ packages: yield* discovery.listPackages() });
 *   return yield* graph.levels();
 * });
 * ```
 *
 * @public
 */
export class DependencyGraph extends Schema.Class<DependencyGraph>("DependencyGraph")({
	/** The workspace packages the graph is drawn over. */
	packages: Schema.Array(WorkspacePackage),
}) {
	#edges: Edges | undefined;

	#index(): Edges {
		if (this.#edges !== undefined) return this.#edges;
		const names = new Set(this.packages.map((pkg) => pkg.name));
		const forward = new Map<string, Set<string>>();
		const reverse = new Map<string, Set<string>>();
		for (const name of names) {
			forward.set(name, new Set());
			reverse.set(name, new Set());
		}
		for (const pkg of this.packages) {
			for (const dependency of Object.keys(pkg.allDependencies)) {
				if (!names.has(dependency) || dependency === pkg.name) continue;
				forward.get(pkg.name)?.add(dependency);
				reverse.get(dependency)?.add(pkg.name);
			}
		}
		this.#edges = { forward, reverse };
		return this.#edges;
	}

	/** Every workspace package name, sorted. Total. */
	get names(): ReadonlyArray<string> {
		return [...this.#index().forward.keys()].sort();
	}

	/** The adjacency map: name → the names it depends on. Total. */
	get adjacency(): ReadonlyMap<string, ReadonlySet<string>> {
		return this.#index().forward;
	}

	/**
	 * Whether the graph contains a cycle. Total.
	 *
	 * @remarks
	 * An explicit-stack DFS with an on-stack set — never recursive, so a long
	 * dependency chain cannot overflow.
	 */
	get hasCycle(): boolean {
		const { forward } = this.#index();
		const visited = new Set<string>();
		const onStack = new Set<string>();

		for (const start of forward.keys()) {
			if (visited.has(start)) continue;
			// Each frame is a node plus the iterator position into its dependencies.
			const stack: Array<{ readonly node: string; readonly deps: Array<string>; cursor: number }> = [
				{ node: start, deps: [...(forward.get(start) ?? [])], cursor: 0 },
			];
			visited.add(start);
			onStack.add(start);

			while (stack.length > 0) {
				const frame = stack[stack.length - 1];
				if (frame.cursor >= frame.deps.length) {
					onStack.delete(frame.node);
					stack.pop();
					continue;
				}
				const next = frame.deps[frame.cursor];
				frame.cursor += 1;
				if (onStack.has(next)) return true;
				if (visited.has(next)) continue;
				visited.add(next);
				onStack.add(next);
				stack.push({ node: next, deps: [...(forward.get(next) ?? [])], cursor: 0 });
			}
		}
		return false;
	}

	/** The workspace packages `name` depends on, sorted. */
	readonly dependenciesOf = Effect.fn("DependencyGraph.dependenciesOf")(
		(name: string): Effect.Effect<ReadonlyArray<string>, PackageNotFoundError> => {
			const deps = this.#index().forward.get(name);
			return deps === undefined
				? Effect.fail(new PackageNotFoundError({ name, available: this.names }))
				: Effect.succeed([...deps].sort());
		},
	);

	/** The workspace packages that depend on `name`, sorted. */
	readonly dependentsOf = Effect.fn("DependencyGraph.dependentsOf")(
		(name: string): Effect.Effect<ReadonlyArray<string>, PackageNotFoundError> => {
			const dependents = this.#index().reverse.get(name);
			return dependents === undefined
				? Effect.fail(new PackageNotFoundError({ name, available: this.names }))
				: Effect.succeed([...dependents].sort());
		},
	);

	/**
	 * `name` plus every package that transitively depends on it — the blast
	 * radius of a change. Sorted; includes `name` itself.
	 */
	readonly affectedBy = Effect.fn("DependencyGraph.affectedBy")(
		(names: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, never> => {
			const { reverse } = this.#index();
			const affected = new Set<string>();
			const queue = [...names];
			while (queue.length > 0) {
				const current = queue.shift();
				/* v8 ignore next */
				if (current === undefined) break;
				if (affected.has(current)) continue;
				affected.add(current);
				for (const dependent of reverse.get(current) ?? []) {
					if (!affected.has(dependent)) queue.push(dependent);
				}
			}
			return Effect.succeed([...affected].sort());
		},
	);

	/**
	 * Packages grouped into parallel build levels: level 0 depends on nothing in
	 * the workspace, level *n* depends only on levels below it.
	 *
	 * @remarks
	 * Kahn's algorithm over the reverse-edge index — linear, where v3's rescanned
	 * the whole adjacency map per processed node. Each level is sorted
	 * lexicographically, so the output is deterministic.
	 */
	readonly levels = Effect.fn("DependencyGraph.levels")(
		(): Effect.Effect<ReadonlyArray<ReadonlyArray<string>>, CyclicDependencyError> =>
			Effect.suspend(() => Effect.succeed(kahn(this.#index()))).pipe(
				Effect.flatMap((result) =>
					result.stalled.length > 0
						? Effect.fail(new CyclicDependencyError({ cycle: result.stalled }))
						: Effect.succeed(result.levels),
				),
			),
	);

	/** The flattened topological order — `levels()` concatenated. */
	readonly sort = Effect.fn("DependencyGraph.sort")(
		(): Effect.Effect<ReadonlyArray<string>, CyclicDependencyError> =>
			this.levels().pipe(Effect.map((levels) => levels.flat())),
	);

	/**
	 * A topological order over `names` plus their transitive workspace
	 * dependencies — the build order for a subset.
	 */
	readonly sortSubset = Effect.fn("DependencyGraph.sortSubset")(
		(
			names: ReadonlyArray<string>,
		): Effect.Effect<ReadonlyArray<string>, CyclicDependencyError | PackageNotFoundError> =>
			Effect.suspend((): Effect.Effect<ReadonlyArray<string>, CyclicDependencyError | PackageNotFoundError> => {
				const { forward } = this.#index();
				for (const name of names) {
					if (!forward.has(name)) {
						return Effect.fail(new PackageNotFoundError({ name, available: this.names }));
					}
				}

				const needed = new Set<string>();
				const queue = [...names];
				while (queue.length > 0) {
					const current = queue.shift();
					/* v8 ignore next */
					if (current === undefined) break;
					if (needed.has(current)) continue;
					needed.add(current);
					for (const dependency of forward.get(current) ?? []) {
						if (!needed.has(dependency)) queue.push(dependency);
					}
				}

				const subForward = new Map<string, ReadonlySet<string>>();
				const subReverse = new Map<string, Set<string>>();
				for (const node of needed) subReverse.set(node, new Set());
				for (const node of needed) {
					const deps = new Set([...(forward.get(node) ?? [])].filter((dep) => needed.has(dep)));
					subForward.set(node, deps);
					for (const dep of deps) subReverse.get(dep)?.add(node);
				}

				const result = kahn({ forward: subForward, reverse: subReverse });
				return result.stalled.length > 0
					? Effect.fail(new CyclicDependencyError({ cycle: result.stalled }))
					: Effect.succeed(result.levels.flat());
			}),
	);
}

/**
 * Kahn's algorithm. `forward[A] = {B}` reads "A depends on B", so level 0 is
 * the set with an out-degree of zero and each completed level decrements its
 * dependents through the reverse index.
 */
const kahn = (
	edges: Edges,
): { readonly levels: ReadonlyArray<ReadonlyArray<string>>; readonly stalled: ReadonlyArray<string> } => {
	const remaining = new Map<string, number>();
	for (const [node, deps] of edges.forward) remaining.set(node, deps.size);

	const levels: Array<Array<string>> = [];
	let current = [...remaining.entries()].filter(([, count]) => count === 0).map(([node]) => node);
	current.sort();

	while (current.length > 0) {
		levels.push(current);
		const next: Array<string> = [];
		for (const done of current) {
			remaining.delete(done);
			for (const dependent of edges.reverse.get(done) ?? []) {
				const count = remaining.get(dependent);
				if (count === undefined) continue;
				const decremented = count - 1;
				remaining.set(dependent, decremented);
				if (decremented === 0) next.push(dependent);
			}
		}
		next.sort();
		current = next;
	}

	return { levels, stalled: [...remaining.keys()].sort() };
};
