// Vitest runs outside React Server Components, where the real `server-only` package throws on
// import. Tests may import server modules, so it is replaced by this empty module.
export {};
