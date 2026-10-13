import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import NodeTest from "node:test";
import * as NodeURL from "node:url";

const root = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

NodeTest("vendor attempts rollback even when cleanup fails and preserves failure evidence", () => {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "typescript-config-recovery-test-"),
  );

  const destination = NodePath.join(directory, "tools", "typescript-config-policy");
  const preloader = NodePath.join(directory, "fault.mjs");

  const metadata = JSON.stringify({
    repository: "https://github.com/yazanabuashour/typescript-config-policy",
  });

  try {
    for (const faults of [[], ["cleanup"], ["rollback"], ["cleanup", "rollback"]]) {
      NodeFS.mkdirSync(destination, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(destination, "SOURCE.json"), metadata);
      NodeFS.writeFileSync(NodePath.join(destination, "marker"), "original snapshot");
      NodeFS.writeFileSync(
        preloader,
        `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const faults = ${JSON.stringify(faults)};
const rename = fs.renameSync;
const remove = fs.rmSync;
fs.renameSync = (from, to) => {
  if (from.includes(".new-")) throw new Error("injected install failure");
  if (faults.includes("rollback") && from.includes(".old-")) {
    throw new Error("injected rollback failure");
  }
  return rename(from, to);
};
fs.rmSync = (file, options) => {
  if (faults.includes("cleanup") && file.includes(".new-")) {
    throw new Error("injected cleanup failure");
  }
  return remove(file, options);
};
syncBuiltinESMExports();
`,
      );

      const result = NodeChildProcess.spawnSync(
        NodeProcess.execPath,
        ["--import", preloader, NodePath.join(root, "scripts", "vendor.mjs"), destination],
        { encoding: "utf8" },
      );

      NodeAssert.equal(result.status, 1, result.stdout + result.stderr);
      NodeAssert.match(result.stderr, /injected install failure/);
      const entries = NodeFS.readdirSync(NodePath.dirname(destination));
      const backup = entries.find((entry) => entry.startsWith(".typescript-config-policy.old-"));
      const staging = entries.find((entry) => entry.startsWith(".typescript-config-policy.new-"));

      if (faults.includes("cleanup")) {
        NodeAssert.match(result.stderr, /Unable to remove snapshot staging directory: .*\.new-/);
        NodeAssert.match(result.stderr, /injected cleanup failure/);
        NodeAssert.ok(staging, result.stderr);
      } else {
        NodeAssert.equal(staging, undefined);
      }

      let preserved = destination;

      if (faults.includes("rollback")) {
        NodeAssert.match(result.stderr, /Unable to restore snapshot from backup: .*\.old-/);
        NodeAssert.match(result.stderr, /injected rollback failure/);
        NodeAssert.ok(backup, result.stderr);
        NodeAssert.equal(NodeFS.existsSync(destination), false);
        preserved = NodePath.join(NodePath.dirname(destination), backup);
      } else {
        NodeAssert.equal(backup, undefined);
      }

      NodeAssert.deepEqual(NodeFS.readdirSync(preserved).sort(), ["SOURCE.json", "marker"]);
      NodeAssert.equal(
        NodeFS.readFileSync(NodePath.join(preserved, "SOURCE.json"), "utf8"),
        metadata,
      );
      NodeAssert.equal(
        NodeFS.readFileSync(NodePath.join(preserved, "marker"), "utf8"),
        "original snapshot",
      );
      NodeAssert.equal(entries.length, faults.includes("cleanup") ? 2 : 1);
      NodeFS.rmSync(NodePath.dirname(destination), { recursive: true });
    }
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
