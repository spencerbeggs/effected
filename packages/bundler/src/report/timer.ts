// packages/bundler/src/report/timer.ts
/** @public */
export function formatTime(ms: number): string {
	return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/** @public */
export interface Timer {
	readonly elapsed: () => number;
	readonly format: () => string;
}

/**
 * Create a wall-clock timer. (Date.now is fine in runtime build code.)
 *
 * @public
 */
export function createTimer(now: () => number = Date.now): Timer {
	const start = now();
	return { elapsed: () => now() - start, format: () => formatTime(now() - start) };
}
