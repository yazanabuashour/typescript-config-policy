#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import * as SnapshotTransaction from "./transaction.mjs";

const repository = SnapshotTransaction.repository;

const root = NodeFS.realpathSync(
  NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url))),
);

const profiles = ["base.json", "bundler.json", "node-ts-source.json", "node.json", "portable.json"];

const readme = `# Vendored TypeScript configuration policy

This directory contains the five dependency-free profiles from the public
[TypeScript configuration policy](${repository}), distributed under the MIT
license in \`LICENSE\`.

\`SOURCE.json\` records the repository URL and \`contentSha256\`. The SHA-256 digest
covers each profile's filename, a NUL byte, and its unchanged file bytes, in
filename order. It excludes \`LICENSE\`, this README, and \`SOURCE.json\`; it is not
a Git commit pin.

To update, select the intended source revision in the policy repository and run
\`npm ci\` and \`npm run check\` there. Then run
\`npm run vendor -- /absolute/consumer/tools/typescript-config-policy\` to replace
this snapshot. Review the diff and run the consumer repository's checks.

The consumer's TypeScript configuration selects a profile and owns its runtime
settings. See the source repository's README for profile details.
`;

/** Runs in the flock-owned worker, not as a standalone export API. */
export function updateSnapshot(destination) {
  SnapshotTransaction.assertOutsideSource(destination, root);
  SnapshotTransaction.recoverSnapshot(destination, root);
  SnapshotTransaction.assertOutsideSource(destination, root);

  const previous = SnapshotTransaction.pathIdentity(destination);

  if (previous !== null) {
    try {
      if (NodeFS.readdirSync(destination).length > 0) {
        const current = JSON.parse(
          NodeFS.readFileSync(NodePath.join(destination, "SOURCE.json"), "utf8"),
        );

        if (current?.repository !== repository)
          throw new Error("SOURCE.json repository does not match");
      }
    } catch (error) {
      throw new Error(`Refusing to replace an unidentified snapshot: ${destination}`, {
        cause: error,
      });
    }
  }

  const contents = profiles.map((file) => [file, NodeFS.readFileSync(NodePath.join(root, file))]);
  const digest = NodeCrypto.createHash("sha256");

  for (const [file, content] of contents) {
    digest.update(file);
    digest.update("\0");
    digest.update(content);
  }

  const source = { repository, contentSha256: digest.digest("hex") };

  const workspace = NodePath.join(
    NodePath.dirname(destination),
    ".typescript-config-policy.transaction",
  );

  const temporary = NodePath.join(workspace, "staging");
  const backup = NodePath.join(workspace, "backup");
  NodeFS.mkdirSync(workspace);

  const state = {
    version: 1,
    repository,
    destination,
    sourceRoot: root,
    pid: NodeProcess.pid,
    workspace: SnapshotTransaction.pathIdentity(workspace),
    previous,
    staged: null,
  };

  let backupActive = false;

  try {
    SnapshotTransaction.recordState(workspace, state);
    NodeFS.mkdirSync(temporary);

    for (const [file, content] of contents)
      NodeFS.writeFileSync(NodePath.join(temporary, file), content);

    NodeFS.copyFileSync(NodePath.join(root, "LICENSE"), NodePath.join(temporary, "LICENSE"));
    NodeFS.writeFileSync(NodePath.join(temporary, "README.md"), readme);
    NodeFS.writeFileSync(
      NodePath.join(temporary, "SOURCE.json"),
      `${JSON.stringify(source, null, 2)}\n`,
    );
    state.staged = SnapshotTransaction.pathIdentity(temporary);
    SnapshotTransaction.recordState(workspace, state);

    if (previous !== null) {
      NodeFS.renameSync(destination, backup);
      backupActive = true;
    }

    NodeFS.renameSync(temporary, destination);
  } catch (error) {
    SnapshotTransaction.rollbackSnapshot(workspace, state, backupActive, error);
  }

  SnapshotTransaction.finishTransaction(workspace);
}

function run() {
  const argument = NodeProcess.argv[2];

  if (NodeProcess.argv.length !== 3 || !argument || !NodePath.isAbsolute(argument)) {
    throw new Error("Usage: npm run vendor -- /absolute/consumer/tools/typescript-config-policy");
  }

  const destination = NodePath.resolve(argument);

  if (
    !destination.endsWith(`${NodePath.sep}${NodePath.join("tools", "typescript-config-policy")}`)
  ) {
    throw new Error(`Refusing unsafe snapshot destination: ${destination}`);
  }

  SnapshotTransaction.assertOutsideSource(destination, root);
  const parent = NodePath.dirname(destination);

  NodeFS.mkdirSync(parent, { recursive: true });
  const canonical = NodePath.join(NodeFS.realpathSync(parent), NodePath.basename(destination));
  const worker = `import { updateSnapshot } from ${JSON.stringify(import.meta.url)}; updateSnapshot(${JSON.stringify(canonical)});`;

  const result = NodeChildProcess.spawnSync(
    "flock",
    [
      "--nonblock",
      "--no-fork",
      "--conflict-exit-code",
      "75",
      parent,
      NodeProcess.execPath,
      ...NodeProcess.execArgv,
      "--input-type=module",
      "--eval",
      worker,
    ],
    { stdio: "inherit" },
  );

  if (result.error)
    throw new Error(`Unable to start Linux flock for snapshot destination: ${canonical}`, {
      cause: result.error,
    });

  if (result.status === 75)
    throw new Error(
      `Snapshot destination is locked: ${canonical}; parent: ${NodeFS.realpathSync(parent)}`,
    );

  if (result.signal)
    throw new Error(
      `Snapshot exporter interrupted by ${result.signal}; inspect transaction workspace: ${NodePath.join(NodePath.dirname(canonical), ".typescript-config-policy.transaction")}`,
    );

  NodeProcess.exit(result.status);
}

if (
  NodeProcess.argv[1] &&
  NodeFS.existsSync(NodeProcess.argv[1]) &&
  NodeFS.realpathSync(NodeProcess.argv[1]) ===
    NodeFS.realpathSync(NodeURL.fileURLToPath(import.meta.url))
)
  run();
