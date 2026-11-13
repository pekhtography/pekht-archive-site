import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";

const root = new URL("../", import.meta.url);
const schemaNames = [
  "candidate-pool",
  "candidate-validation-report",
  "global-comparison-stage1",
  "global-comparison-stage2",
  "process-audit-v2",
];
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validators = new Map();
for (const name of schemaNames) {
  const schema = JSON.parse(await readFile(new URL(`schemas/${name}.schema.json`, root), "utf8"));
  validators.set(name, ajv.compile(schema));
}

const fixtureCases = [
  ["valid/candidate-pool.json", "candidate-pool", true],
  ["valid/candidate-validation-report.json", "candidate-validation-report", true],
  ["valid/global-comparison-stage1.json", "global-comparison-stage1", true],
  ["valid/global-comparison-stage2.json", "global-comparison-stage2", true],
  ["valid/global-comparison-stage2-empty.json", "global-comparison-stage2", true],
  ["valid/process-audit-v2.json", "process-audit-v2", true],
  ["valid/process-audit-v2-empty-pool.json", "process-audit-v2", true],
  ["invalid/candidate-pool.json", "candidate-pool", false],
  ["invalid/candidate-validation-report.json", "candidate-validation-report", false],
  ["invalid/global-comparison-stage1.json", "global-comparison-stage1", false],
  ["invalid/global-comparison-stage2.json", "global-comparison-stage2", false],
  ["invalid/process-audit-v2.json", "process-audit-v2", false],
];

for (const [fixture, schemaName, expected] of fixtureCases) {
  test(`${expected ? "accepts" : "rejects"} ${fixture}`, async () => {
    const value = JSON.parse(await readFile(new URL(`fixtures/${fixture}`, root), "utf8"));
    const valid = validators.get(schemaName)(value);
    assert.equal(valid, expected, JSON.stringify(validators.get(schemaName).errors, null, 2));
  });
}

test("all five Amendment 1 schemas compile under Ajv Draft 2020-12", () => {
  assert.equal(validators.size, 5);
});
