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

function evidence(directory) {
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(directory, entry.name);

    return entry.isDirectory() ? evidence(path) : [[path, NodeFS.readFileSync(path)]];
  });
}

function interruptReplacement(destination, preloader, kind) {
  NodeFS.mkdirSync(destination, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(destination, "SOURCE.json"), JSON.stringify({ repository }));
  NodeFS.writeFileSync(NodePath.join(destination, "marker"), "previous snapshot");
  NodeFS.writeFileSync(
    preloader,
    `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const rename = fs.renameSync;
const write = fs.writeFileSync;
fs.writeFileSync = (file, content, options) => {
  if (${JSON.stringify(kind)} === "partial-journal" && file.endsWith("state.json.tmp")) {
    write(file, content.slice(0, 10), options);
    process.kill(process.pid, "SIGKILL");
  }
  return write(file, content, options);
};
fs.renameSync = (from, to) => {
  const result = rename(from, to);
  if (to.endsWith("/backup")) process.kill(process.pid, "SIGKILL");
  return result;
};
syncBuiltinESMExports();
`,
  );

  const result = NodeChildProcess.spawnSync(
    NodeProcess.execPath,
    ["--import", preloader, exporter, destination],
    { encoding: "utf8" },
  );

  NodeAssert.equal(result.status, 1, result.stdout + result.stderr);
  NodeAssert.match(result.stderr, /interrupted by SIGKILL/);
}

function makeAmbiguous(kind, fixture, destination, workspace, state) {
  const journal = NodePath.join(workspace, "state.json");

  if (kind === "corrupt-journal") {
    NodeFS.writeFileSync(journal, "partial ownership journal");
  } else if (kind === "wrong-destination") {
    NodeFS.writeFileSync(
      journal,
      JSON.stringify({ ...state, destination: `${destination}-other` }),
    );
  } else if (kind === "wrong-workspace") {
    NodeFS.writeFileSync(
      journal,
      JSON.stringify({ ...state, workspace: { ...state.workspace, ino: "0" } }),
    );
  } else if (kind === "replaced-backup") {
    const backup = NodePath.join(workspace, "backup");

    NodeFS.renameSync(backup, NodePath.join(fixture, "retained-previous"));
    NodeFS.mkdirSync(backup);
    NodeFS.writeFileSync(NodePath.join(backup, "marker"), "different owner");
  } else if (kind === "occupied-destination") {
    NodeFS.mkdirSync(destination);
    NodeFS.writeFileSync(NodePath.join(destination, "marker"), "different owner");
  } else if (kind === "unknown-entry") {
    NodeFS.writeFileSync(NodePath.join(workspace, "unowned"), "different owner");
  } else if (kind === "missing-journal") {
    NodeFS.unlinkSync(journal);
  } else {
    NodeAssert.fail(`Unknown fixture: ${kind}`);
  }
}

NodeTest("vendor refuses ambiguous ownership or outcome without deleting any evidence", () => {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "typescript-config-ownership-"),
  );

  const cases = [
    "partial-journal",
    "corrupt-journal",
    "wrong-destination",
    "wrong-workspace",
    "replaced-backup",
    "occupied-destination",
    "unknown-entry",
    "missing-journal",
  ];

  try {
    for (const kind of cases) {
      const fixture = NodePath.join(directory, kind);
      const destination = NodePath.join(fixture, "tools", "typescript-config-policy");
      const workspace = NodePath.join(fixture, "tools", ".typescript-config-policy.transaction");
      const preloader = NodePath.join(fixture, "interrupt.mjs");

      interruptReplacement(destination, preloader, kind);

      if (kind !== "partial-journal") {
        const state = JSON.parse(
          NodeFS.readFileSync(NodePath.join(workspace, "state.json"), "utf8"),
        );

        makeAmbiguous(kind, fixture, destination, workspace, state);
      }

      const before = evidence(fixture);

      const result = NodeChildProcess.spawnSync(NodeProcess.execPath, [exporter, destination], {
        encoding: "utf8",
      });

      NodeAssert.equal(result.status, 1, result.stdout + result.stderr);
      NodeAssert.match(result.stderr, /Refusing ambiguous snapshot transaction/);
      NodeAssert.ok(result.stderr.includes(workspace), result.stderr);
      NodeAssert.match(result.stderr, /ownership journal: .*state\.json/);
      NodeAssert.match(result.stderr, /(?:workspace identity|observed identities)/);
      NodeAssert.deepEqual(evidence(fixture), before, kind);
    }
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

NodeTest(
  "vendor preserves unjournaled legacy paths and source-containing recovery workspaces",
  () => {
    const directory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "typescript-config-legacy-"),
    );

    const destination = NodePath.join(directory, "tools", "typescript-config-policy");

    const legacy = NodePath.join(
      NodePath.dirname(destination),
      ".typescript-config-policy.old-unowned",
    );

    try {
      NodeFS.mkdirSync(legacy, { recursive: true });
      NodeFS.writeFileSync(NodePath.join(legacy, "SOURCE.json"), JSON.stringify({ repository }));
      const before = evidence(directory);

      const refused = NodeChildProcess.spawnSync(NodeProcess.execPath, [exporter, destination], {
        encoding: "utf8",
      });

      NodeAssert.equal(refused.status, 1, refused.stdout + refused.stderr);
      NodeAssert.match(refused.stderr, /Refusing unowned snapshot transaction paths/);
      NodeAssert.ok(refused.stderr.includes(legacy), refused.stderr);
      NodeAssert.match(refused.stderr, /identity.*dev.*ino/);
      NodeAssert.deepEqual(evidence(directory), before);
      NodeFS.rmSync(legacy, { recursive: true });

      const workspace = NodePath.join(
        NodePath.dirname(destination),
        ".typescript-config-policy.transaction",
      );

      const producer = NodePath.join(workspace, "producer");

      NodeFS.mkdirSync(NodePath.join(producer, "scripts"), { recursive: true });

      for (const file of ["vendor.mjs", "transaction.mjs"]) {
        NodeFS.copyFileSync(
          NodePath.join(root, "scripts", file),
          NodePath.join(producer, "scripts", file),
        );
      }

      const protectedFiles = evidence(directory);

      const protectedResult = NodeChildProcess.spawnSync(
        NodeProcess.execPath,
        [NodePath.join(producer, "scripts", "vendor.mjs"), destination],
        { encoding: "utf8" },
      );

      NodeAssert.equal(protectedResult.status, 1, protectedResult.stdout + protectedResult.stderr);
      NodeAssert.match(protectedResult.stderr, /Refusing unsafe snapshot destination/);
      NodeAssert.deepEqual(evidence(directory), protectedFiles);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  },
);
