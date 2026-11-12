import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = process.cwd();
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const schemaDir = path.join(root, 'schemas');
const schemaFiles = fs.readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json'));
if (schemaFiles.length === 0) throw new Error('No JSON schemas found');
const validators = new Map();
for (const file of schemaFiles) {
  const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, file), 'utf8'));
  if (!ajv.validateSchema(schema)) throw new Error(`${file}: ${ajv.errorsText()}`);
  validators.set(file.replace('.schema.json', ''), ajv.compile(schema));
  process.stdout.write(`SCHEMA OK ${file}\n`);
}

const fixtureExpectations = [
  ['test-result', 'test-result.pass.valid.json', true],
  ['test-result', 'test-result.pass.invalid-low-score.json', false],
  ['test-result', 'test-result.pass.invalid-blocking.json', false]
];
for (const [schemaName, fixtureName, expected] of fixtureExpectations) {
  const validate = validators.get(schemaName);
  const data = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', fixtureName), 'utf8'));
  const actual = Boolean(validate(data));
  if (actual !== expected) throw new Error(`${fixtureName}: expected ${expected ? 'VALID' : 'INVALID'}; ${ajv.errorsText(validate.errors)}`);
  process.stdout.write(`FIXTURE ${actual ? 'VALID' : 'INVALID AS EXPECTED'} ${fixtureName}\n`);
}
