import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import NodeTest from "node:test";
import * as NodeURL from "node:url";

const root = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

const tsc = NodePath.join(root, "node_modules", "typescript", "bin", "tsc");

const profiles = {
  "base.json": {
    strict: true,
    allowUnreachableCode: false,
    allowUnusedLabels: false,
    exactOptionalPropertyTypes: true,
    forceConsistentCasingInFileNames: true,
    noFallthroughCasesInSwitch: true,
    noImplicitOverride: true,
    noImplicitReturns: true,
    noPropertyAccessFromIndexSignature: true,
    noUncheckedIndexedAccess: true,
    noUncheckedSideEffectImports: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    skipLibCheck: false,
    useUnknownInCatchVariables: true,
  },
  "portable.json": {
    erasableSyntaxOnly: true,
    isolatedModules: true,
    verbatimModuleSyntax: true,
  },
  "node.json": {
    module: "nodenext",
    moduleResolution: "nodenext",
  },
  "node-ts-source.json": {
    allowImportingTsExtensions: true,
    rewriteRelativeImportExtensions: true,
  },
  "bundler.json": {
    allowImportingTsExtensions: true,
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
  },
};

NodeTest("profiles compose through TypeScript 7", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "typescript-config-policy-"));

  try {
    NodeFS.writeFileSync(NodePath.join(directory, "index.ts"), "export {};\n");

    for (const [profile, expected] of Object.entries(profiles)) {
      const config = NodePath.join(directory, "tsconfig.json");
      NodeFS.writeFileSync(
        config,
        `${JSON.stringify({ extends: NodePath.join(root, profile), files: ["index.ts"] })}\n`,
      );

      const result = NodeChildProcess.spawnSync(tsc, ["--showConfig", "-p", config], {
        encoding: "utf8",
      });

      NodeAssert.equal(result.status, 0, result.stdout + result.stderr);
      const resolved = JSON.parse(result.stdout);
      const inherited = { ...profiles["base.json"] };

      if (profile !== "base.json") Object.assign(inherited, profiles["portable.json"]);

      if (profile === "node-ts-source.json") Object.assign(inherited, profiles["node.json"]);
      Object.assign(inherited, expected);

      for (const [option, value] of Object.entries(inherited)) {
        NodeAssert.deepEqual(resolved.compilerOptions[option], value, `${profile}: ${option}`);
      }
    }
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

NodeTest("vendor snapshots are dependency-free", () => {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "typescript-config-vendor-test-"),
  );

  const destination = NodePath.join(directory, "consumer", "tools", "typescript-config-policy");

  try {
    const result = NodeChildProcess.spawnSync(
      NodeProcess.execPath,
      [NodePath.join(root, "scripts", "vendor.mjs"), destination],
      { encoding: "utf8" },
    );

    NodeAssert.equal(result.status, 0, result.stderr);
    NodeAssert.equal(NodeFS.existsSync(NodePath.join(destination, "package.json")), false);

    for (const file of [...Object.keys(profiles), "LICENSE"]) {
      NodeAssert.deepEqual(
        NodeFS.readFileSync(NodePath.join(destination, file)),
        NodeFS.readFileSync(NodePath.join(root, file)),
        file,
      );
    }

    const source = JSON.parse(
      NodeFS.readFileSync(NodePath.join(destination, "SOURCE.json"), "utf8"),
    );

    const digest = NodeCrypto.createHash("sha256");

    for (const file of Object.keys(profiles).sort()) {
      digest.update(file);
      digest.update("\0");
      digest.update(NodeFS.readFileSync(NodePath.join(destination, file)));
    }

    NodeAssert.deepEqual(source, {
      repository: "https://github.com/yazanabuashour/typescript-config-policy",
      contentSha256: digest.digest("hex"),
    });
    const obsolete = NodePath.join(destination, "obsolete.json");
    NodeFS.writeFileSync(obsolete, "{}\n");

    const replacement = NodeChildProcess.spawnSync(
      NodeProcess.execPath,
      [NodePath.join(root, "scripts", "vendor.mjs"), destination],
      { encoding: "utf8" },
    );

    NodeAssert.equal(replacement.status, 0, replacement.stderr);
    NodeAssert.equal(NodeFS.existsSync(obsolete), false);
    NodeAssert.deepEqual(
      JSON.parse(NodeFS.readFileSync(NodePath.join(destination, "SOURCE.json"), "utf8")),
      source,
    );
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

NodeTest("vendor rejects unsafe destinations without deleting them", () => {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "typescript-config-safety-test-"),
  );

  const marker = NodePath.join(directory, "marker");

  try {
    NodeFS.writeFileSync(marker, "preserved");

    const result = NodeChildProcess.spawnSync(
      NodeProcess.execPath,
      [NodePath.join(root, "scripts", "vendor.mjs"), directory],
      { encoding: "utf8" },
    );

    NodeAssert.notEqual(result.status, 0);
    NodeAssert.equal(NodeFS.readFileSync(marker, "utf8"), "preserved");
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

NodeTest("vendor preserves unidentified existing directories", () => {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "typescript-config-identity-test-"),
  );

  const destination = NodePath.join(directory, "consumer", "tools", "typescript-config-policy");
  const marker = NodePath.join(destination, "marker");

  try {
    NodeFS.mkdirSync(destination, { recursive: true });
    NodeFS.writeFileSync(marker, "preserved");

    const result = NodeChildProcess.spawnSync(
      NodeProcess.execPath,
      [NodePath.join(root, "scripts", "vendor.mjs"), destination],
      { encoding: "utf8" },
    );

    NodeAssert.notEqual(result.status, 0);
    NodeAssert.equal(NodeFS.readFileSync(marker, "utf8"), "preserved");
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

NodeTest("shared profiles omit consumer-owned project settings", () => {
  const forbidden = [
    "composite",
    "declaration",
    "incremental",
    "jsx",
    "lib",
    "outDir",
    "paths",
    "plugins",
    "rootDir",
    "target",
    "types",
  ];

  for (const profile of Object.keys(profiles)) {
    const config = JSON.parse(NodeFS.readFileSync(NodePath.join(root, profile), "utf8"));

    for (const option of forbidden) {
      NodeAssert.equal(config.compilerOptions?.[option], undefined, `${profile}: ${option}`);
    }

    for (const field of ["exclude", "files", "include", "references"]) {
      NodeAssert.equal(config[field], undefined, `${profile}: ${field}`);
    }
  }
});
