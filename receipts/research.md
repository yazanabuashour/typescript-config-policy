# Configuration decisions

The profiles separate semantic checks from module and runtime settings.
`test/config.test.mjs` verifies profile composition with TypeScript `7.0.2` and
checks that shared profiles omit consumer-owned settings.

Runtime libraries, global types, emit paths, path aliases, project references,
framework settings, and Effect diagnostics stay local. Those settings do not
have one valid meaning across Node, Bun, browsers, workers, and emitting libraries.

`bundler.json` sets `noEmit` because a bundler owns JavaScript output.
`node-ts-source.json` permits `.ts` imports and rewrites relative import
extensions when TypeScript emits. The consumer decides whether to emit.
