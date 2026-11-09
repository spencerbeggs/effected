/** Read at render time in the site's own build, never at this package's build. */
export const useMode = (): string => (import.meta.env.SSG_MD ? "markdown" : "html");
