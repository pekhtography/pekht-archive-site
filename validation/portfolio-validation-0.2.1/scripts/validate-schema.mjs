import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root=process.cwd();
const ajv=new Ajv2020({allErrors:true,strict:true});
addFormats(ajv);
const schemaFiles=[
  {name:'candidate.schema.json',fullPath:path.join(root,'schemas','candidate.schema.json')},
  {name:'test-result.schema.json',fullPath:path.join(root,'schemas','test-result.schema.json')},
  {name:'snapshot.schema.json',fullPath:path.join(root,'schemas','snapshot.schema.json')},
  {name:'discovery-record.schema.json',fullPath:path.join(root,'schemas','discovery-record.schema.json')},
  {name:'independent-test-response.schema.json',fullPath:path.resolve(root,'../../scripts/portfolio/schemas/independent-test-response.schema.json')},
];
const fixtureExpectations=[
  ['test-result','test-result.pass.valid.json',true],
  ['test-result','test-result.pass.invalid-low-score.json',false],
  ['test-result','test-result.pass.invalid-blocking.json',false],
  ['candidate','candidate.pass.valid.json',true],
  ['candidate','candidate.fail.source-count.json',false],
  ['candidate','candidate.fail.duplicate-source.json',false],
  ['candidate','candidate.fail.candidate-id.json',true],
  ['snapshot','snapshot.valid.json',true],
  ['discovery-record','discovery.valid.json',true],
  ['independent-test-response','independent-test-response.approve.valid.json',true],
  ['independent-test-response','independent-test-response.approve.invalid-low-score.json',false],
  ['independent-test-response','independent-test-response.approve.invalid-evidence.json',false],
  ['independent-test-response','independent-test-response.reject.valid.json',true],
  ['independent-test-response','independent-test-response.reject.invalid-no-blocking.json',false],
];
const validators=new Map();
for(const {name,fullPath} of schemaFiles){
  if(!fs.existsSync(fullPath)) throw new Error(`Missing required schema: ${name} at ${fullPath}`);
  const schema=JSON.parse(fs.readFileSync(fullPath,'utf8'));
  if(!ajv.validateSchema(schema)) throw new Error(`${name}: ${ajv.errorsText()}`);
  validators.set(name.replace('.schema.json',''),ajv.compile(schema));
  process.stdout.write(`SCHEMA OK ${name}\n`);
}
for(const [schemaName,fixtureName,expected] of fixtureExpectations){
  const validate=validators.get(schemaName);
  const full=path.join(root,'fixtures',fixtureName);
  if(!fs.existsSync(full)) throw new Error(`Missing required fixture: ${fixtureName}`);
  const data=JSON.parse(fs.readFileSync(full,'utf8'));
  const actual=Boolean(validate(data));
  if(actual!==expected) throw new Error(`${fixtureName}: expected ${expected?'VALID':'INVALID'}; ${ajv.errorsText(validate.errors)}`);
  process.stdout.write(`FIXTURE ${actual?'VALID': 'INVALID AS EXPECTED'} ${fixtureName}\n`);
}
const discoveryValidator=validators.get('discovery-record');
const discoveryFixture=JSON.parse(fs.readFileSync(path.join(root,'fixtures','discovery.valid.json'),'utf8'));
const discoveryCases=[
  ['SIGNALS_FOUND with observations',discoveryFixture,true],
  ['SIGNALS_FOUND without observations',{...discoveryFixture,observations:[]},false],
  ['NO_SIGNAL without observations',{...discoveryFixture,result:'NO_SIGNAL',observations:[]},true],
  ['NO_SIGNAL with observations',{...discoveryFixture,result:'NO_SIGNAL'},false],
  ['unknown result',{...discoveryFixture,result:'UNKNOWN'},false],
];
for(const [label,data,expected] of discoveryCases){
  const actual=Boolean(discoveryValidator(data));
  if(actual!==expected) throw new Error(`Discovery conditional: ${label}; expected ${expected?'VALID':'INVALID'}; ${ajv.errorsText(discoveryValidator.errors)}`);
  process.stdout.write(`DISCOVERY CONDITIONAL ${actual?'VALID':'INVALID AS EXPECTED'} ${label}\n`);
}
process.stdout.write(`SCHEMA VALIDATION PASS (${schemaFiles.length} schemas, ${fixtureExpectations.length} fixtures, ${discoveryCases.length} conditional cases)\n`);
