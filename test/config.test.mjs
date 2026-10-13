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

NodeTest(
  "snapshots preserve profiles, survive staging failures, and compose without dependencies",
  () => {
    const directory = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "typescript-config-vendor-test-"),
    );

    const destination = NodePath.join(directory, "consumer", "tools", "typescript-config-policy");

    try {
      const digest = NodeCrypto.createHash("sha256");

      for (const file of Object.keys(profiles).sort()) {
        digest.update(file);
        digest.update("\0");
        digest.update(NodeFS.readFileSync(NodePath.join(root, file)));
      }

      const source = {
        repository: "https://github.com/yazanabuashour/typescript-config-policy",
        contentSha256: digest.digest("hex"),
      };

      const obsolete = NodePath.join(destination, "obsolete.json");

      for (const replacing of [false, true]) {
        if (replacing) {
          NodeFS.writeFileSync(obsolete, "{}\n");
          NodeFS.writeFileSync(NodePath.join(destination, "base.json"), "{}\n");
        }

        const result = NodeChildProcess.spawnSync(
          NodeProcess.execPath,
          [NodePath.join(root, "scripts", "vendor.mjs"), destination],
          { encoding: "utf8" },
        );

        NodeAssert.equal(result.status, 0, result.stdout + result.stderr);
        NodeAssert.deepEqual(
          NodeFS.readdirSync(destination).sort(),
          [...Object.keys(profiles), "LICENSE", "README.md", "SOURCE.json"].sort(),
        );
        NodeAssert.deepEqual(
          JSON.parse(NodeFS.readFileSync(NodePath.join(destination, "SOURCE.json"), "utf8")),
          source,
        );

        for (const file of [...Object.keys(profiles), "LICENSE"]) {
          NodeAssert.deepEqual(
            NodeFS.readFileSync(NodePath.join(destination, file)),
            NodeFS.readFileSync(NodePath.join(root, file)),
            file,
          );
        }
      }

      const incompleteSource = NodePath.join(directory, "incomplete-source");
      NodeFS.mkdirSync(NodePath.join(incompleteSource, "scripts"), { recursive: true });

      for (const file of ["vendor.mjs", "transaction.mjs"]) {
        NodeFS.copyFileSync(
          NodePath.join(root, "scripts", file),
          NodePath.join(incompleteSource, "scripts", file),
        );
      }

      for (const file of Object.keys(profiles)) {
        NodeFS.copyFileSync(NodePath.join(root, file), NodePath.join(incompleteSource, file));
      }

      const snapshot = NodeFS.readdirSync(destination).map((file) => [
        file,
        NodeFS.readFileSync(NodePath.join(destination, file)),
      ]);

      const failed = NodeChildProcess.spawnSync(
        NodeProcess.execPath,
        [NodePath.join(incompleteSource, "scripts", "vendor.mjs"), destination],
        { encoding: "utf8" },
      );

      NodeAssert.equal(failed.status, 1, failed.stdout + failed.stderr);
      NodeAssert.match(failed.stderr, /ENOENT.*LICENSE/);
      NodeAssert.deepEqual(NodeFS.readdirSync(NodePath.dirname(destination)), [
        "typescript-config-policy",
      ]);

      for (const [file, content] of snapshot) {
        NodeAssert.deepEqual(NodeFS.readFileSync(NodePath.join(destination, file)), content, file);
      }

      NodeFS.writeFileSync(NodePath.join(directory, "index.ts"), "export {};\n");

      for (const [profile, expected] of Object.entries(profiles)) {
        const config = NodePath.join(directory, "tsconfig.json");
        NodeFS.writeFileSync(
          config,
          `${JSON.stringify({ extends: NodePath.join(destination, profile), files: ["index.ts"] })}\n`,
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
  },
);

NodeTest("vendor rejects invalid arguments and unsafe destinations without writing", () => {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "typescript-config-safety-test-"),
  );

  const marker = NodePath.join(directory, "marker");

  try {
    NodeFS.writeFileSync(marker, "preserved");

    const destination = NodePath.join(directory, "tools", "typescript-config-policy");

    const cases = [
      { arguments: [], diagnostic: /Usage: npm run vendor/ },
      { arguments: ["relative/path"], diagnostic: /Usage: npm run vendor/ },
      { arguments: [destination, "--dry-run"], diagnostic: /Usage: npm run vendor/ },
      { arguments: [directory], diagnostic: /Refusing unsafe snapshot destination/ },
    ];

    for (const fixture of cases) {
      const result = NodeChildProcess.spawnSync(
        NodeProcess.execPath,
        [NodePath.join(root, "scripts", "vendor.mjs"), ...fixture.arguments],
        { encoding: "utf8" },
      );

      NodeAssert.equal(result.status, 1, result.stdout + result.stderr);
      NodeAssert.match(result.stderr, fixture.diagnostic);
      NodeAssert.deepEqual(NodeFS.readdirSync(directory), ["marker"]);
      NodeAssert.equal(NodeFS.readFileSync(marker, "utf8"), "preserved");
    }

    const producer = NodePath.join(destination, "..producer");
    NodeFS.mkdirSync(NodePath.join(producer, "scripts"), { recursive: true });

    for (const file of ["vendor.mjs", "transaction.mjs"]) {
      NodeFS.copyFileSync(
        NodePath.join(root, "scripts", file),
        NodePath.join(producer, "scripts", file),
      );
    }

    for (const file of [...Object.keys(profiles), "LICENSE"]) {
      NodeFS.copyFileSync(NodePath.join(root, file), NodePath.join(producer, file));
    }

    const metadata = JSON.stringify({
      repository: "https://github.com/yazanabuashour/typescript-config-policy",
    });

    NodeFS.writeFileSync(NodePath.join(destination, "SOURCE.json"), metadata);

    const alias = NodePath.join(directory, "alias", "tools");
    NodeFS.mkdirSync(NodePath.dirname(alias), { recursive: true });
    NodeFS.symlinkSync(NodePath.join(directory, "tools"), alias, "junction");

    const sourceAlias = NodePath.join(directory, "source-alias");

    NodeFS.symlinkSync(producer, sourceAlias, "junction");
    const program = NodePath.join(producer, "scripts", "vendor.mjs");
    const aliased = NodePath.join(alias, "typescript-config-policy");

    for (const [script, candidate] of [
      [program, destination],
      [program, aliased],
      [NodePath.join(sourceAlias, "scripts", "vendor.mjs"), aliased],
    ]) {
      const result = NodeChildProcess.spawnSync(NodeProcess.execPath, [script, candidate], {
        encoding: "utf8",
      });

      NodeAssert.equal(result.status, 1, result.stdout + result.stderr);
      NodeAssert.match(result.stderr, /Refusing unsafe snapshot destination/);
      NodeAssert.equal(
        NodeFS.readFileSync(NodePath.join(destination, "SOURCE.json"), "utf8"),
        metadata,
      );
      NodeAssert.deepEqual(
        NodeFS.readFileSync(NodePath.join(producer, "scripts", "vendor.mjs")),
        NodeFS.readFileSync(NodePath.join(root, "scripts", "vendor.mjs")),
      );
    }
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

NodeTest("vendor preserves unidentified directories and dangling destination links", () => {
  const directory = NodeFS.mkdtempSync(
    NodePath.join(NodeOS.tmpdir(), "typescript-config-identity-test-"),
  );

  const destination = NodePath.join(directory, "consumer", "tools", "typescript-config-policy");
  const marker = NodePath.join(destination, "marker");
  const metadata = NodePath.join(destination, "SOURCE.json");

  const cases = [
    null,
    "invalid JSON",
    "null",
    JSON.stringify({ repository: "https://example.com/other-policy" }),
  ];

  try {
    NodeFS.mkdirSync(destination, { recursive: true });
    NodeFS.writeFileSync(marker, "preserved");

    for (const source of cases) {
      if (source !== null) NodeFS.writeFileSync(metadata, source);

      const result = NodeChildProcess.spawnSync(
        NodeProcess.execPath,
        [NodePath.join(root, "scripts", "vendor.mjs"), destination],
        { encoding: "utf8" },
      );

      NodeAssert.equal(result.status, 1, result.stdout + result.stderr);
      NodeAssert.match(result.stderr, /Refusing to replace an unidentified snapshot/);
      NodeAssert.equal(NodeFS.readFileSync(marker, "utf8"), "preserved");

      if (source === null) {
        NodeAssert.equal(NodeFS.existsSync(metadata), false);
      } else {
        NodeAssert.equal(NodeFS.readFileSync(metadata, "utf8"), source);
      }
    }

    NodeFS.rmSync(destination, { recursive: true });
    const missing = NodePath.join(directory, "missing");

    NodeFS.symlinkSync(missing, destination, "junction");

    const refused = NodeChildProcess.spawnSync(
      NodeProcess.execPath,
      [NodePath.join(root, "scripts", "vendor.mjs"), destination],
      { encoding: "utf8" },
    );

    NodeAssert.equal(refused.status, 1, refused.stdout + refused.stderr);
    NodeAssert.match(refused.stderr, /Refusing to replace an unidentified snapshot/);
    NodeAssert.ok(NodeFS.lstatSync(destination).isSymbolicLink());
    NodeAssert.equal(NodeFS.readlinkSync(destination), missing);
    NodeAssert.deepEqual(NodeFS.readdirSync(NodePath.dirname(destination)), [
      "typescript-config-policy",
    ]);
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
