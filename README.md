# TypeScript configuration policy

Strict, portable TypeScript configuration profiles, available as
[public GitHub source](https://github.com/yazanabuashour/typescript-config-policy)
under the [MIT license](LICENSE). Consumers vendor the profiles rather than
install a registry package.

The development manifest uses the name `@yazanabuashour/tsconfig` and keeps
`private: true` to block npm publication. That flag does not control GitHub
visibility. The profiles support TypeScript 7 or newer; checks use TypeScript `7.0.2`.

## Profiles

- `base.json` enables semantic safety checks, including `strict`,
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitReturns`,
  `noUnusedLocals`, and `noUnusedParameters`. It checks declaration files with
  `skipLibCheck: false` and leaves runtime, module, and emit settings to consumers.
- `portable.json` extends `base.json` with `erasableSyntaxOnly`, `isolatedModules`,
  and `verbatimModuleSyntax` for source that tools can strip without TypeScript emit.
- `node.json` extends `portable.json` with NodeNext modules and module resolution.
- `node-ts-source.json` extends `node.json` to permit local `.ts` imports and
  rewrite relative import extensions when TypeScript emits. It does not set `noEmit`.
- `bundler.json` extends `portable.json` with Preserve modules, Bundler module
  resolution, `.ts` imports, and `noEmit: true`.

## Vendor or update a snapshot

Use Node.js 22.19 or newer for the repository's development commands.

1. Select the intended revision of this repository.
2. Install the locked dependencies and verify the source:

   ```bash
   npm ci
   npm run check
   ```

3. Export to an absolute consumer path:

   ```bash
   npm run vendor -- /absolute/consumer/tools/typescript-config-policy
   ```

4. Review the snapshot diff and run the consumer's checks.

The exporter copies all five profiles unchanged, plus `LICENSE`, `README.md`,
and `SOURCE.json`. It refuses a nonempty destination unless `SOURCE.json`
identifies this repository. Keep the license with the snapshot.

`SOURCE.json` records the public repository URL and `contentSha256`. The SHA-256
digest covers each profile's filename, a NUL byte, and its file bytes, in filename
order. It excludes the license and generated metadata. It identifies profile
content, not a Git commit or the complete exported directory.

## Configure the consumer

Extend one profile and supply the runtime settings in the consumer's `tsconfig.json`:

```json
{
  "extends": "./tools/typescript-config-policy/node-ts-source.json",
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

Keep these settings local because they describe a project rather than shared safety checks:

- `target`, `lib`, global `types`, JSX, and framework options;
- declarations, source maps, `rootDir`, and `outDir`;
- `noEmit`, except for the `bundler.json` contract;
- `paths`, project references, `files`, `include`, and `exclude`;
- language-service plugins, decorators, and class-field behavior.

Override a shared rule only with a documented project-specific reason. Return
`undefined` explicitly when a value-returning function intentionally has no result.
Prefix an intentionally unused callback parameter with `_`; remove unused locals
rather than retaining dead code. Resolve declaration-file errors rather than
blanket-skipping dependency checks. If a dependency requires a temporary
`skipLibCheck` override, record the affected dependency and why it is necessary.

[Configuration decisions](receipts/research.md) records upstream comparisons and
compatibility checks. Oxlint and Oxfmt own linting and formatting; compiler checks
also protect consumers that use these profiles without the lint policy.
