# TypeScript configuration policy

This public GitHub repository exports strict, portable TypeScript configuration
profiles under the MIT license. Consumers vendor an exact snapshot, including
`LICENSE`. Keep `private: true` in `package.json` to block npm registry publication;
it does not control GitHub visibility. Do not publish this package to a registry
or add consumer-specific settings to the shared profiles.

The exporter records the public repository URL and a digest of profile content
in `SOURCE.json`. Keep that digest scoped to the profiles. Do not claim a commit
pin unless that commit contains the exact exported files. Preserve destination
identity checks and rollback when changing the exporter.

## Profiles

- `base.json` owns runtime-independent semantic safety checks.
- `portable.json` adds rules for source that tools can strip without TypeScript
  emitting JavaScript.
- `node.json` adds NodeNext module behavior.
- `node-ts-source.json` adds the `.ts` import convention used by source-loaded
  Node applications.
- `bundler.json` adds no-emit bundler module behavior.

Keep `target`, `lib`, `types`, JSX, emit paths, declarations, framework plugins,
project references, path aliases, decorators, and environment globals in each
consumer. A shared option must have the same meaning in every supported runtime.

Use Node.js 22.19 or newer and install with `npm ci`. Run `npm run check` before
committing or handing off.
