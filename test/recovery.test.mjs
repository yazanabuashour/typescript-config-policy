import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import NodeTest from "node:test";
import * as NodeURL from "node:url";

const root = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

function faultPreloader(faults) {
  return `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const faults = ${JSON.stringify(faults)};
const rename = fs.renameSync;
const remove = fs.rmSync;
fs.renameSync = (from, to) => {
  if (from.endsWith("/staging")) {
    if (faults.includes("occupied")) {
      fs.mkdirSync(to);
      fs.writeFileSync(to + "/marker", "occupied destination");
    }
    throw new Error("injected install failure");
  }
  if (faults.includes("rollback") && from.endsWith("/backup")) {
    throw new Error("injected rollback failure");
  }
  return rename(from, to);
};
fs.rmSync = (file, options) => {
  if (faults.includes("cleanup") && file.endsWith("/staging")) {
    throw new Error("injected cleanup failure");
  }
  return remove(file, options);
};
syncBuiltinESMExports();
`;
}

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
    for (const faults of [[], ["cleanup"], ["rollback"], ["cleanup", "rollback"], ["occupied"]]) {
      NodeFS.mkdirSync(destination, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(destination, "SOURCE.json"), metadata);
      NodeFS.writeFileSync(NodePath.join(destination, "marker"), "original snapshot");
      NodeFS.writeFileSync(preloader, faultPreloader(faults));

      const result = NodeChildProcess.spawnSync(
        NodeProcess.execPath,
        ["--import", preloader, NodePath.join(root, "scripts", "vendor.mjs"), destination],
        { encoding: "utf8" },
      );

      NodeAssert.equal(result.status, 1, result.stdout + result.stderr);
      NodeAssert.match(result.stderr, /injected install failure/);

      const workspace = NodePath.join(
        NodePath.dirname(destination),
        ".typescript-config-policy.transaction",
      );

      const entries = NodeFS.existsSync(workspace) ? NodeFS.readdirSync(workspace) : [];
      const backup = entries.find((entry) => entry === "backup");
      const staging = entries.find((entry) => entry === "staging");

      if (faults.includes("cleanup")) {
        NodeAssert.match(result.stderr, /Unable to remove snapshot staging directory: .*\/staging/);
        NodeAssert.match(result.stderr, /injected cleanup failure/);
        NodeAssert.ok(staging, result.stderr);
      } else {
        NodeAssert.equal(staging, undefined);
      }

      let preserved = destination;

      if (faults.includes("rollback") || faults.includes("occupied")) {
        NodeAssert.match(result.stderr, /Unable to restore snapshot from backup: .*\/backup/);
        NodeAssert.ok(backup, result.stderr);
        preserved = NodePath.join(workspace, backup);

        if (faults.includes("occupied")) {
          NodeAssert.match(result.stderr, /Snapshot destination is occupied/);
          NodeAssert.ok(result.stderr.includes(destination));
          NodeAssert.ok(result.stderr.includes(preserved));
          NodeAssert.deepEqual(NodeFS.readdirSync(destination), ["marker"]);
          NodeAssert.equal(
            NodeFS.readFileSync(NodePath.join(destination, "marker"), "utf8"),
            "occupied destination",
          );
        } else {
          NodeAssert.match(result.stderr, /injected rollback failure/);
          NodeAssert.equal(NodeFS.existsSync(destination), false);
        }
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
      NodeAssert.deepEqual(
        entries.sort(),
        [
          ...(faults.length > 0 ? ["state.json"] : []),
          ...(staging ? [staging] : []),
          ...(backup ? [backup] : []),
        ].sort((left, right) => left.localeCompare(right)),
      );
      NodeAssert.deepEqual(
        NodeFS.readdirSync(NodePath.dirname(destination)).sort(),
        [
          ...(faults.includes("rollback") ? [] : ["typescript-config-policy"]),
          ...(faults.length > 0 ? [".typescript-config-policy.transaction"] : []),
        ].sort(),
      );
      NodeFS.rmSync(NodePath.dirname(destination), { recursive: true });
    }
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
