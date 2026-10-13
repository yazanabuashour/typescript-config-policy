import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import NodeTest from "node:test";
import * as NodeURL from "node:url";

const root = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

const exporter = NodePath.join(root, "scripts", "vendor.mjs");

const repository = "https://github.com/yazanabuashour/typescript-config-policy";

const files = [
  "base.json",
  "bundler.json",
  "node-ts-source.json",
  "node.json",
  "portable.json",
  "LICENSE",
  "README.md",
  "SOURCE.json",
];

function interruptAt(phase) {
  return `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const phase = ${JSON.stringify(phase)};
const mkdir = fs.mkdirSync, write = fs.writeFileSync;
const rename = fs.renameSync, remove = fs.rmSync;
const interrupt = () => process.kill(process.pid, "SIGKILL");
fs.mkdirSync = (file, options) => {
  const result = mkdir(file, options);
  if (phase === "workspace" && file.endsWith(".transaction")) interrupt();
  return result;
};
fs.writeFileSync = (file, content, options) => {
  const result = write(file, content, options);
  if (phase === "pending-journal" && file.endsWith("state.json.tmp")) interrupt();
  if (phase === "staging" && file.includes("/staging/") && file.endsWith("base.json")) interrupt();
  return result;
};
fs.renameSync = (from, to) => {
  const result = rename(from, to);
  if (phase === "ready-journal" && to.endsWith("state.json") && JSON.parse(fs.readFileSync(to)).staged !== null) interrupt();
  if (phase === "backup" && to.endsWith("/backup")) interrupt();
  if (phase === "installed" && from.endsWith("/staging")) interrupt();
  return result;
};
fs.rmSync = (file, options) => {
  if (phase === "backup-cleanup" && file.endsWith("/backup") && fs.existsSync(file)) {
    remove(file + "/marker");
    interrupt();
  }
  const result = remove(file, options);
  if (phase === "empty-workspace" && file.endsWith("state.json")) interrupt();
  return result;
};
syncBuiltinESMExports();
`;
}

NodeTest("vendor recovers owned interrupted staging, replacement, and cleanup on retry", () => {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "typescript-config-interruption-"),
  );

  const phases = [
    "workspace",
    "pending-journal",
    "staging",
    "ready-journal",
    "backup",
    "installed",
    "backup-cleanup",
    "empty-workspace",
  ];

  const cases = [
    ...phases.map((phase) => ({ phase, replacing: true })),
    { phase: "staging", replacing: false },
    { phase: "installed", replacing: false },
  ];

  try {
    for (const { phase, replacing } of cases) {
      const fixture = NodePath.join(directory, `${phase}-${replacing}`);
      const destination = NodePath.join(fixture, "tools", "typescript-config-policy");
      const workspace = NodePath.join(fixture, "tools", ".typescript-config-policy.transaction");
      const preloader = NodePath.join(fixture, "interrupt.mjs");

      NodeFS.mkdirSync(replacing ? destination : fixture, { recursive: true });

      if (replacing) {
        NodeFS.writeFileSync(
          NodePath.join(destination, "SOURCE.json"),
          JSON.stringify({ repository }),
        );
        NodeFS.writeFileSync(NodePath.join(destination, "marker"), "previous snapshot");
      }

      NodeFS.writeFileSync(preloader, interruptAt(phase));

      const interrupted = NodeChildProcess.spawnSync(
        NodeProcess.execPath,
        ["--import", preloader, exporter, destination],
        { encoding: "utf8" },
      );

      NodeAssert.equal(interrupted.status, 1, interrupted.stdout + interrupted.stderr);
      NodeAssert.match(interrupted.stderr, /interrupted by SIGKILL/);
      NodeAssert.ok(NodeFS.existsSync(workspace));

      if (phase === "backup") {
        NodeAssert.equal(NodeFS.existsSync(destination), false);
        const backup = NodeFS.readdirSync(workspace).find((entry) => entry === "backup");

        NodeAssert.ok(backup);
        NodeAssert.equal(
          NodeFS.readFileSync(NodePath.join(workspace, backup, "marker"), "utf8"),
          "previous snapshot",
        );
      } else if (
        replacing &&
        ["workspace", "pending-journal", "staging", "ready-journal"].includes(phase)
      ) {
        NodeAssert.equal(
          NodeFS.readFileSync(NodePath.join(destination, "marker"), "utf8"),
          "previous snapshot",
        );
      }

      const retried = NodeChildProcess.spawnSync(NodeProcess.execPath, [exporter, destination], {
        encoding: "utf8",
      });

      NodeAssert.equal(retried.status, 0, retried.stdout + retried.stderr);
      NodeAssert.match(
        retried.stderr,
        /(?:Recovered snapshot transaction|Removed empty snapshot transaction workspace)/,
      );
      NodeAssert.deepEqual(NodeFS.readdirSync(NodePath.dirname(destination)), [
        "typescript-config-policy",
      ]);
      NodeAssert.deepEqual(NodeFS.readdirSync(destination).sort(), files.toSorted());

      for (const file of files.filter((entry) => !["README.md", "SOURCE.json"].includes(entry))) {
        NodeAssert.deepEqual(
          NodeFS.readFileSync(NodePath.join(destination, file)),
          NodeFS.readFileSync(NodePath.join(root, file)),
          `${phase}: ${file}`,
        );
      }
    }
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
