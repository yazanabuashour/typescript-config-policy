import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import NodeTest from "node:test";
import * as NodeURL from "node:url";

const root = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

const tsc = NodePath.join(root, "node_modules", "typescript", "bin", "tsc");

NodeTest("base checks incomplete returns, dead bindings, and declaration files", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "typescript-policy-checks-"));

  const cases = [
    {
      name: "incomplete return",
      file: "index.ts",
      source: "export function choose(flag: boolean) { if (flag) return 1; }",
      diagnostic: "TS7030",
    },
    {
      name: "unused local",
      file: "index.ts",
      source: "const unused = 1; export {};",
      diagnostic: "TS6133",
    },
    {
      name: "unused parameter",
      file: "index.ts",
      source: "export function choose(unused: string) { return 1; }",
      diagnostic: "TS6133",
    },
    {
      name: "invalid declaration",
      file: "index.d.ts",
      source: "export declare const value: MissingDeclaration;",
      diagnostic: "TS2304",
    },
    {
      name: "explicit absence and intentional callback placeholder",
      file: "index.ts",
      source:
        "export function choose(flag: boolean, _context: string) { return flag ? 1 : undefined; }",
      diagnostic: null,
    },
  ];

  try {
    for (const fixture of cases) {
      NodeFS.writeFileSync(NodePath.join(directory, fixture.file), fixture.source);
      const config = NodePath.join(directory, "tsconfig.json");
      NodeFS.writeFileSync(
        config,
        JSON.stringify({
          extends: NodePath.join(root, "base.json"),
          compilerOptions: { noEmit: true, types: [], lib: ["ES2024"], target: "ES2024" },
          files: [fixture.file],
        }),
      );

      const result = NodeChildProcess.spawnSync(tsc, ["-p", config, "--pretty", "false"], {
        encoding: "utf8",
      });

      const output = result.stdout + result.stderr;

      if (fixture.diagnostic === null) {
        NodeAssert.equal(result.status, 0, `${fixture.name}: ${output}`);
      } else {
        NodeAssert.notEqual(result.status, 0, fixture.name);
        NodeAssert.ok(output.includes(fixture.diagnostic), `${fixture.name}: ${output}`);
      }
    }
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
