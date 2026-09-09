#!/usr/bin/env node

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

const repository = "https://github.com/yazanabuashour/typescript-config-policy";
const root = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const destinationArgument = NodeProcess.argv[2];
if (!destinationArgument || !NodePath.isAbsolute(destinationArgument)) {
  throw new Error("Usage: npm run vendor -- /absolute/consumer/tools/typescript-config-policy");
}
const destination = NodePath.resolve(destinationArgument);
const expectedSuffix = NodePath.join("tools", "typescript-config-policy");
const rootFromDestination = NodePath.relative(destination, root);
if (
  destination === NodePath.parse(destination).root ||
  !destination.endsWith(`${NodePath.sep}${expectedSuffix}`) ||
  rootFromDestination === "" ||
  (!rootFromDestination.startsWith("..") && !NodePath.isAbsolute(rootFromDestination))
) {
  throw new Error(`Refusing unsafe snapshot destination: ${destination}`);
}
const profiles = ["base.json", "bundler.json", "node-ts-source.json", "node.json", "portable.json"];
const contents = await Promise.all(
  profiles.map(async (file) => [file, await NodeFSP.readFile(NodePath.join(root, file))]),
);
const digest = NodeCrypto.createHash("sha256");
for (const [file, content] of contents) {
  digest.update(file);
  digest.update("\0");
  digest.update(content);
}
const source = {
  repository,
  contentSha256: digest.digest("hex"),
};
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

if (NodeFS.existsSync(destination)) {
  const entries = await NodeFSP.readdir(destination);
  if (entries.length > 0) {
    const current = JSON.parse(
      await NodeFSP.readFile(NodePath.join(destination, "SOURCE.json"), "utf8"),
    );
    if (current.repository !== repository) {
      throw new Error(`Refusing to replace an unidentified snapshot: ${destination}`);
    }
  }
}

const parent = NodePath.dirname(destination);
const name = NodePath.basename(destination);
const transaction = NodeCrypto.randomUUID();
const temporary = NodePath.join(parent, `.${name}.new-${transaction}`);
const backup = NodePath.join(parent, `.${name}.old-${transaction}`);
await NodeFSP.mkdir(temporary, { recursive: true });
await Promise.all(
  contents.map(([file, content]) => NodeFSP.writeFile(NodePath.join(temporary, file), content)),
);
await Promise.all([
  NodeFSP.copyFile(NodePath.join(root, "LICENSE"), NodePath.join(temporary, "LICENSE")),
  NodeFSP.writeFile(NodePath.join(temporary, "README.md"), readme),
  NodeFSP.writeFile(
    NodePath.join(temporary, "SOURCE.json"),
    `${JSON.stringify(source, null, 2)}\n`,
  ),
]);

const hadDestination = NodeFS.existsSync(destination);
let backupActive = false;
try {
  if (hadDestination) {
    await NodeFSP.rename(destination, backup);
    backupActive = true;
  }
  await NodeFSP.rename(temporary, destination);
} catch (error) {
  await NodeFSP.rm(temporary, { recursive: true, force: true });
  if (backupActive && !NodeFS.existsSync(destination)) {
    await NodeFSP.rename(backup, destination);
  }
  throw error;
}
if (backupActive) await NodeFSP.rm(backup, { recursive: true, force: true });
