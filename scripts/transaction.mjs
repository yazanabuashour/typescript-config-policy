import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

export const repository = "https://github.com/yazanabuashour/typescript-config-policy";

export function pathIdentity(path) {
  try {
    const stat = NodeFS.lstatSync(path, { bigint: true });

    return { dev: stat.dev.toString(), ino: stat.ino.toString() };
  } catch (error) {
    if (error.code === "ENOENT") return null;

    throw error;
  }
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function assertIdentity(value) {
  NodeAssert.deepEqual(Object.keys(value).sort(), ["dev", "ino"]);
  NodeAssert.match(value.dev, /^\d+$/);
  NodeAssert.match(value.ino, /^\d+$/);
}

export function assertOutsideSource(path, root) {
  const physical = NodeFS.existsSync(path) ? NodeFS.realpathSync(path) : path;
  const relative = NodePath.relative(physical, root);

  if (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${NodePath.sep}`) &&
      !NodePath.isAbsolute(relative))
  ) {
    throw new Error(`Refusing unsafe snapshot destination: ${path}`);
  }
}

export function recordState(workspace, state) {
  const temporary = NodePath.join(workspace, "state.json.tmp");

  NodeFS.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
  NodeFS.renameSync(temporary, NodePath.join(workspace, "state.json"));
}

export function finishTransaction(workspace) {
  for (const file of ["staging", "backup", "state.json.tmp", "state.json"]) {
    NodeFS.rmSync(NodePath.join(workspace, file), { recursive: true, force: true });
  }

  NodeFS.rmdirSync(workspace);
}

export function rollbackSnapshot(workspace, state, error) {
  const temporary = NodePath.join(workspace, "staging");
  const backup = NodePath.join(workspace, "backup");
  const errors = [error];

  try {
    NodeFS.rmSync(temporary, { recursive: true, force: true });
  } catch (cleanupError) {
    errors.push(
      new Error(`Unable to remove snapshot staging directory: ${temporary}`, {
        cause: cleanupError,
      }),
    );
  }

  try {
    const identity = pathIdentity(backup);

    if (identity !== null) {
      if (!sameIdentity(identity, state.previous))
        throw new Error(
          `Refusing unowned snapshot backup: ${backup}; recorded identity: ${JSON.stringify(state.previous)}; observed identity: ${JSON.stringify(identity)}`,
        );

      if (pathIdentity(state.destination) !== null)
        throw new Error(
          `Snapshot destination is occupied: ${state.destination}; retained backup: ${backup}`,
        );

      NodeFS.renameSync(backup, state.destination);
    }
  } catch (rollbackError) {
    errors.push(
      new Error(`Unable to restore snapshot from backup: ${backup}`, { cause: rollbackError }),
    );
  }

  if (errors.length === 1) {
    try {
      finishTransaction(workspace);
    } catch (cleanupError) {
      errors.push(
        new Error(`Unable to remove snapshot transaction workspace: ${workspace}`, {
          cause: cleanupError,
        }),
      );
    }
  }

  if (errors.length > 1)
    throw new AggregateError(errors, `Snapshot update and recovery failed: ${state.destination}`, {
      cause: error,
    });

  throw error;
}

function readState(workspace, destination) {
  const statePath = NodePath.join(
    workspace,
    NodeFS.existsSync(NodePath.join(workspace, "state.json")) ? "state.json" : "state.json.tmp",
  );

  try {
    const state = JSON.parse(NodeFS.readFileSync(statePath, "utf8"));

    NodeAssert.deepEqual(Object.keys(state).sort(), [
      "destination",
      "pid",
      "previous",
      "repository",
      "sourceRoot",
      "staged",
      "version",
      "workspace",
    ]);
    NodeAssert.equal(state.version, 1);
    NodeAssert.equal(state.repository, repository);
    NodeAssert.equal(state.destination, destination);
    NodeAssert.ok(NodePath.isAbsolute(state.sourceRoot));
    NodeAssert.ok(Number.isInteger(state.pid) && state.pid > 0);
    assertIdentity(state.workspace);
    NodeAssert.ok(sameIdentity(state.workspace, pathIdentity(workspace)));

    for (const identity of [state.previous, state.staged]) {
      if (identity !== null) assertIdentity(identity);
    }

    return { state, statePath };
  } catch (error) {
    const message = `Refusing ambiguous snapshot transaction: ${workspace}; ownership journal: ${statePath}; destination: ${destination}`;
    let observed;

    try {
      observed = [
        destination,
        workspace,
        ...NodeFS.readdirSync(workspace).map((entry) => NodePath.join(workspace, entry)),
      ].map((path) => ({ path, identity: pathIdentity(path) }));
    } catch (inspectionError) {
      throw new AggregateError(
        [error, inspectionError],
        `${message}; unable to inspect transaction paths`,
        { cause: inspectionError },
      );
    }

    throw new Error(`${message}; observed identities: ${JSON.stringify(observed)}`, {
      cause: error,
    });
  }
}

export function recoverSnapshot(destination, root) {
  const parent = NodePath.dirname(destination);
  const workspace = NodePath.join(parent, ".typescript-config-policy.transaction");

  const legacy = NodeFS.readdirSync(parent).filter((entry) =>
    /^\.typescript-config-policy\.(new|old)-/.test(entry),
  );

  if (legacy.length > 0) {
    throw new Error(
      `Refusing unowned snapshot transaction paths: ${JSON.stringify(
        legacy.map((entry) => ({
          path: NodePath.join(parent, entry),
          identity: pathIdentity(NodePath.join(parent, entry)),
        })),
      )}; no ownership journal; destination: ${destination}`,
    );
  }

  if (pathIdentity(workspace) === null) return;

  assertOutsideSource(workspace, root);

  if (NodeFS.readdirSync(workspace).length === 0) {
    const identity = pathIdentity(workspace);

    NodeFS.rmdirSync(workspace);
    NodeProcess.stderr.write(
      `Removed empty snapshot transaction workspace: ${workspace}; identity: ${JSON.stringify(identity)}\n`,
    );

    return;
  }

  const { state, statePath } = readState(workspace, destination);

  const temporary = NodePath.join(workspace, "staging");
  const backup = NodePath.join(workspace, "backup");

  const observed = {
    destination: pathIdentity(destination),
    temporary: pathIdentity(temporary),
    backup: pathIdentity(backup),
  };

  const allowed = new Set([
    "state.json",
    "state.json.tmp",
    NodePath.basename(temporary),
    NodePath.basename(backup),
  ]);

  const unknown = NodeFS.readdirSync(workspace).filter((entry) => !allowed.has(entry));

  const unexpected =
    unknown.length > 0 ||
    (observed.backup !== null && !sameIdentity(observed.backup, state.previous)) ||
    (observed.temporary !== null &&
      state.staged !== null &&
      !sameIdentity(observed.temporary, state.staged));

  const restoreBackup = observed.destination === null && observed.backup !== null;

  const previousPresent =
    sameIdentity(observed.destination, state.previous) && observed.backup === null;

  const stagedInstalled =
    state.staged !== null &&
    sameIdentity(observed.destination, state.staged) &&
    observed.temporary === null;

  if (unexpected || (!restoreBackup && !previousPresent && !stagedInstalled))
    throw new Error(
      `Refusing ambiguous snapshot transaction: ${workspace}; ownership journal: ${statePath}; recorded: ${JSON.stringify(state)}; paths: ${JSON.stringify({ destination, temporary, backup })}; observed identities: ${JSON.stringify(observed)}; unexpected entries: ${JSON.stringify(unknown)}`,
    );

  if (restoreBackup) NodeFS.renameSync(backup, destination);

  finishTransaction(workspace);
  NodeProcess.stderr.write(
    `Recovered snapshot transaction: ${workspace}; destination: ${destination}; recorded owner: ${JSON.stringify(state)}; observed identities: ${JSON.stringify(observed)}\n`,
  );
}
