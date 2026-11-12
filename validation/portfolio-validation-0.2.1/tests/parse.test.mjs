import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAndValidateInput } from '../src/parse.ts';

test('parse layer returns validator success without coupling to Ajv', () => {
  const validator=(input)=>typeof input==='string'?{success:true,data:input,issues:[]}:{success:false,issues:[{code:'TYPE',message:'string required'}]};
  assert.deepEqual(parseAndValidateInput('ok',validator),{success:true,data:'ok',issues:[]});
  assert.equal(parseAndValidateInput(4,validator).success,false);
});

test('parse layer converts unexpected validator exceptions to PARSE_EXCEPTION', () => {
  const result=parseAndValidateInput({},()=>{throw new Error('secret internals');});
  assert.deepEqual(result,{success:false,issues:[{code:'PARSE_EXCEPTION',message:'Input validation failed unexpectedly'}]});
});
