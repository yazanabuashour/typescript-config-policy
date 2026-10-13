# TypeScript configuration policy

Vendor strict, dependency-free TypeScript configuration profiles from this
[public GitHub repository](https://github.com/yazanabuashour/typescript-config-policy).
Use TypeScript 7 or newer. The profiles use the [MIT license](LICENSE); there is
no registry package.

## Choose a profile

Extend the profile that matches your toolchain. Each profile inherits the checks
of its parent; follow the file links for the exact compiler options.

| Profile                                    | Parent          | Use when                                                                         |
| ------------------------------------------ | --------------- | -------------------------------------------------------------------------------- |
| [base.json](base.json)                     | —               | You need semantic safety checks without shared module or emit settings.          |
| [portable.json](portable.json)             | `base.json`     | Your tools strip TypeScript syntax without TypeScript emitting JavaScript.       |
| [node.json](node.json)                     | `portable.json` | You use NodeNext modules and module resolution.                                  |
| [node-ts-source.json](node-ts-source.json) | `node.json`     | You use local `.ts` imports in Node source; emitted imports are rewritten.       |
| [bundler.json](bundler.json)               | `portable.json` | A bundler resolves modules and owns JavaScript output; TypeScript does not emit. |

## Vendor or update a snapshot

Use Node.js 22.19 or newer for development commands. The destination must be an
absolute path ending in `tools/typescript-config-policy`. Pass only that path;
the exporter rejects extra arguments and has no flags. It refuses a nonempty
directory unless its `SOURCE.json` identifies this repository. Updating
an identified snapshot replaces the entire directory, including any local additions.
Keep consumer settings outside the snapshot and retain its license.

1. Select the intended revision of this repository.
2. Install the locked dependencies and verify the source:

   ```bash
   npm ci
   npm run check
   ```

3. Export the snapshot:

   ```bash
   npm run vendor -- /absolute/consumer/tools/typescript-config-policy
   ```

4. Review the snapshot diff and run the consumer's checks.

The exporter copies the profiles and `LICENSE` unchanged, then generates a
snapshot `README.md` and `SOURCE.json`. It stages the files before replacing the
destination and restores the previous snapshot if the replacement rename fails.

`SOURCE.json` records the public repository URL and `contentSha256`. The SHA-256
digest covers each profile's filename, a NUL byte, and its file bytes, in filename
order. It excludes the license, README, and metadata. It identifies profile
content, not a Git commit or the complete exported directory.

## Configure the consumer

Extend one profile in the consumer's `tsconfig.json`:

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

This Node example needs `@types/node` in the consumer. For ES module source, set
`"type": "module"` in the consumer's `package.json`. Set `noEmit` locally when Node
or another tool loads the source; `node-ts-source.json` also supports TypeScript
emit. Only `bundler.json` requires `noEmit` in the shared policy.

Keep project-specific settings in the consumer:

- `target`, `lib`, global `types`, JSX, and framework options;
- declarations, source maps, `rootDir`, and `outDir`;
- `paths`, project references, `files`, `include`, and `exclude`;
- language-service plugins, decorators, and class-field behavior.

Override a shared rule only with a documented project-specific reason. The base
profile checks declaration files and rejects dead bindings and incomplete returns:

- Return `undefined` explicitly when a value-returning function has no result.
- Prefix an intentionally unused callback parameter with `_`; remove unused locals.
- Resolve declaration-file errors rather than blanket-skipping dependency checks.
  For a temporary `skipLibCheck` override, record the affected dependency and reason.

## Change the policy

Edit the root profiles, not exported consumer snapshots. Keep runtime-independent
checks in `base.json` and toolchain behavior in the derived profiles.
[Configuration decisions](receipts/research.md) explains the boundaries and records
compatibility receipts.

Run `npm run check` before handing off changes. It checks formatting, type-checks
the lint configuration, runs profile and exporter contract tests, and lints the
repository. Use `npm run format` to apply formatting; the individual gates are
listed in [package.json](package.json).

The compiled [lint policy snapshot](tools/typescript-lint-policy/README.md) is a
local development dependency, not part of exported compiler profiles. Follow its
update procedure rather than editing its generated files. Preserve its license
and provenance files. Keep `private: true` in the root manifest to block npm
publication; it does not control GitHub visibility.
