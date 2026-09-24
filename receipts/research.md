# Configuration decisions

The profiles separate semantic checks from module and runtime settings.
`test/config.test.mjs` verifies profile composition with TypeScript `7.0.2` and
checks inherited safety settings and that shared profiles omit consumer-owned
settings. `test/compiler.test.mjs` verifies that incomplete returns, unused locals
and parameters, and invalid declaration files fail compilation. It also verifies
that explicit optional results and underscore-prefixed callback parameters pass.

Runtime libraries, global types, emit paths, path aliases, project references,
framework settings, and Effect diagnostics stay local. Those settings do not
have one valid meaning across Node, Bun, browsers, workers, and emitting libraries.

`bundler.json` sets `noEmit` because a bundler owns JavaScript output.
`node-ts-source.json` permits `.ts` imports and rewrites relative import
extensions when TypeScript emits. The consumer decides whether to emit.

## Strictness and compatibility

`noImplicitReturns` requires explicit absence on otherwise value-returning paths.
`noUnusedLocals` and `noUnusedParameters` reject dead bindings even when consumers
do not run our lint policy. Intentionally unused callback parameters can retain
required positional signatures by using an underscore prefix.

`skipLibCheck: false` checks declaration files instead of silently excluding part
of the type contract. Before enabling these four settings, TypeScript `7.0.2`
passed the following probes against both policy repositories, including the lint
policy's unchanged upstream source and regression tests:

```bash
# typescript-config-policy
npx --no-install tsc --noEmit --noImplicitReturns --noUnusedLocals --noUnusedParameters --skipLibCheck false

# typescript-lint-policy
npx --no-install tsc --noEmit --noImplicitReturns --noUnusedLocals --noUnusedParameters --skipLibCheck false
npx --no-install tsc -p tsconfig.upstream.json --noImplicitReturns --noUnusedLocals --noUnusedParameters --skipLibCheck false
```

These are compatibility receipts for these repositories, not a guarantee about
arbitrary consumer dependencies. A consumer with broken third-party declarations
must document any temporary local override.

## Upstream comparison

The comparison used
[t3code revision `d4cd7d5c33122473da22ae118c93477ef7e38310`](https://github.com/pingdotgg/t3code/blob/d4cd7d5c33122473da22ae118c93477ef7e38310/tsconfig.base.json).
Its shared strictness settings were already covered by our base and portable
profiles. We do not copy its `skipLibCheck: true`: the compatibility probes above
support declaration checking here. Its runtime target, module choices, JSON
imports, class-field behavior, and Effect language-service diagnostics remain
consumer decisions. Effect diagnostics require the consumer's Effect toolchain;
adding that plugin to these dependency-free profiles would not enforce it.

The lint policy owns anti-slop provenance and executable lint rules. This
repository consumes its exported Oxlint snapshot instead of duplicating upstream
rules or introducing a second lint or formatting tool.
