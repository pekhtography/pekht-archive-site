import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const schemaNames = [
  "candidate-pool",
  "candidate-validation-report",
  "global-comparison-stage1",
  "global-comparison-stage2",
  "process-audit-v2",
];
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const name of schemaNames) {
  const schema = JSON.parse(await readFile(new URL(`schemas/${name}.schema.json`, root), "utf8"));
  ajv.compile(schema);
  process.stdout.write(`PASS schema: ${name}\n`);
}
