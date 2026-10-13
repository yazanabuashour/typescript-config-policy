import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import NodeTest from "node:test";
import * as NodeURL from "node:url";

const root = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

const exporter = NodePath.join(root, "scripts", "vendor.mjs");

function pausedExporter(directory, destination) {
  const barrier = NodePath.join(directory, "release.fifo");
  const preloader = NodePath.join(directory, "wait.mjs");
  const fifo = NodeChildProcess.spawnSync("mkfifo", [barrier], { encoding: "utf8" });

  NodeAssert.equal(fifo.status, 0, fifo.stdout + fifo.stderr);
  NodeFS.writeFileSync(
    preloader,
    `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const write = fs.writeFileSync;
fs.writeFileSync = (file, content, options) => {
  const result = write(file, content, options);
  if (file.includes("/staging/") && file.endsWith("base.json")) {
    fs.writeSync(1, "LOCKED\\n");
    fs.readFileSync(${JSON.stringify(barrier)});
  }
  return result;
};
syncBuiltinESMExports();
`,
  );

  const first = NodeChildProcess.spawn(
    NodeProcess.execPath,
    ["--import", preloader, exporter, destination],
    { detached: true },
  );

  return { first, finished: NodeEvents.once(first, "exit"), barrier };
}

async function stopExporter(first, finished) {
  if (first.exitCode === null && first.signalCode === null) {
    try {
      NodeProcess.kill(-first.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }

  await finished;
}

NodeTest(
  "vendor fails fast through parent aliases while another exporter holds the destination",
  async (t) => {
    const directory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "typescript-config-concurrency-"),
    );

    const destination = NodePath.join(directory, "consumer", "tools", "typescript-config-policy");

    const workspace = NodePath.join(
      NodePath.dirname(destination),
      ".typescript-config-policy.transaction",
    );

    let running;

    t.after(async () => {
      if (running) await stopExporter(running.first, running.finished);

      NodeFS.rmSync(directory, { recursive: true, force: true });
    });
    NodeFS.mkdirSync(destination, { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(destination, "SOURCE.json"),
      JSON.stringify({ repository: "https://github.com/yazanabuashour/typescript-config-policy" }),
    );
    NodeFS.writeFileSync(NodePath.join(destination, "marker"), "previous snapshot");
    NodeFS.mkdirSync(NodePath.join(directory, "alias"));
    NodeFS.symlinkSync(
      NodePath.dirname(destination),
      NodePath.join(directory, "alias", "tools"),
      "junction",
    );
    running = pausedExporter(directory, destination);
    const { first, finished, barrier } = running;
    let stderr = "";

    first.stderr.setEncoding("utf8");
    first.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const [ready] = await Promise.race([
      NodeEvents.once(first.stdout, "data"),
      finished.then(() => {
        throw new Error(`Exporter exited before acquiring lock: ${stderr}`);
      }),
    ]);

    NodeAssert.match(ready.toString(), /LOCKED/);
    const journal = NodeFS.readFileSync(NodePath.join(workspace, "state.json"));
    const entries = NodeFS.readdirSync(NodePath.dirname(destination), { recursive: true }).sort();
    const alias = NodePath.join(directory, "alias", "tools", "typescript-config-policy");

    const conflict = NodeChildProcess.spawnSync(NodeProcess.execPath, [exporter, alias], {
      encoding: "utf8",
    });

    NodeAssert.equal(conflict.status, 1, conflict.stdout + conflict.stderr);
    NodeAssert.match(conflict.stderr, /Snapshot destination is locked/);
    NodeAssert.ok(conflict.stderr.includes(destination), conflict.stderr);
    NodeAssert.deepEqual(NodeFS.readFileSync(NodePath.join(workspace, "state.json")), journal);
    NodeAssert.deepEqual(
      NodeFS.readdirSync(NodePath.dirname(destination), { recursive: true }).sort(),
      entries,
    );
    NodeAssert.equal(
      NodeFS.readFileSync(NodePath.join(destination, "marker"), "utf8"),
      "previous snapshot",
    );
    const independent = NodePath.join(directory, "other", "tools", "typescript-config-policy");

    const unrelated = NodeChildProcess.spawnSync(NodeProcess.execPath, [exporter, independent], {
      encoding: "utf8",
    });

    NodeAssert.equal(unrelated.status, 0, unrelated.stdout + unrelated.stderr);
    NodeAssert.equal(first.exitCode, null, stderr);
    NodeFS.writeFileSync(barrier, "release");
    const [status, signal] = await finished;

    NodeAssert.equal(signal, null, stderr);
    NodeAssert.equal(status, 0, stderr);
    NodeAssert.deepEqual(NodeFS.readdirSync(NodePath.dirname(destination)), [
      "typescript-config-policy",
    ]);
    NodeAssert.deepEqual(
      NodeFS.readFileSync(NodePath.join(destination, "base.json")),
      NodeFS.readFileSync(NodePath.join(root, "base.json")),
    );
  },
);
