import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAjvValidator } from '../src/ajv-adapter.ts';
import { parseAndValidateInput } from '../src/parse.ts';
const readJson=(name)=>JSON.parse(readFileSync(new URL(`../${name}`,import.meta.url),'utf8'));
const check=(schemaName,fixtureName)=>parseAndValidateInput(readJson(fixtureName),createAjvValidator(readJson(schemaName)));

test('T-11a Candidate schema accepts valid fixture and rejects source-count failure',()=>{
  assert.equal(check('schemas/candidate.schema.json','fixtures/candidate.pass.valid.json').success,true);
  assert.equal(check('schemas/candidate.schema.json','fixtures/candidate.fail.source-count.json').success,false);
});

test('T-11b TestResult schema accepts valid fixture and rejects low-score PASS',()=>{
  assert.equal(check('schemas/test-result.schema.json','fixtures/test-result.pass.valid.json').success,true);
  assert.equal(check('schemas/test-result.schema.json','fixtures/test-result.pass.invalid-low-score.json').success,false);
});

test('T-11c Snapshot schema accepts the valid Snapshot fixture',()=>{
  assert.equal(check('schemas/snapshot.schema.json','fixtures/snapshot.valid.json').success,true);
});

test('T-11d DiscoveryRecord schema accepts the valid single-record fixture',()=>{
  assert.equal(check('schemas/discovery-record.schema.json','fixtures/discovery.valid.json').success,true);
});

test('T-11e Discovery result controls observation cardinality in Draft 2020-12 schema',()=>{
  const validate=createAjvValidator(readJson('schemas/discovery-record.schema.json'));
  const base=readJson('fixtures/discovery.valid.json');
  assert.equal(validate(base).success,true,'SIGNALS_FOUND with observations must pass');
  assert.equal(validate({...base,observations:[]}).success,false,'SIGNALS_FOUND with no observations must fail');
  assert.equal(validate({...base,result:'NO_SIGNAL',observations:[]}).success,true,'NO_SIGNAL with no observations must pass');
  assert.equal(validate({...base,result:'NO_SIGNAL'}).success,false,'NO_SIGNAL with observations must fail');
  assert.equal(validate({...base,result:'UNKNOWN'}).success,false,'unknown result must fail');
});
