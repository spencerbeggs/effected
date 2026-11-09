/** A component the barrel never imports: the framework resolves it by its path. */
export function Unlisted(): unknown {
	return <span>{import.meta.env.SSG_MD}</span>;
}
