import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideTestResult } from '../src/decide.ts';
const valid=JSON.parse(readFileSync(new URL('../fixtures/test-result.pass.valid.json',import.meta.url),'utf8'));

test('decide maps a previously validated PASS to APPROVED',()=>assert.equal(decideTestResult(valid),'APPROVED'));
test('decide maps a previously validated FAIL to REJECT',()=>assert.equal(decideTestResult({...valid,decision:'FAIL'}),'REJECT'));
