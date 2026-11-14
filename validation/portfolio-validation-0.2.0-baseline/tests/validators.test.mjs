import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCandidateId, validateCandidateGraph, validateDistinctEdges, validateEvidenceAgainstSnapshot, validateSetEquality, validateTestDecision } from '../src/validators.ts';

const ids = ['305','355','655','805','749','524'];
const connected = { candidate_id: '', source_ids: ids, observation_ids: [], relationships: [
  {source_a:'305',source_b:'355'}, {source_a:'355',source_b:'655'}, {source_a:'655',source_b:'805'}, {source_a:'805',source_b:'749'}, {source_a:'749',source_b:'524'}
] };

test('candidate ID is order-independent and bound to snapshot identity', () => {
  const hash = 'a'.repeat(64);
  assert.equal(computeCandidateId(hash, ids), computeCandidateId(hash, [...ids].reverse()));
  assert.notEqual(computeCandidateId(hash, ids), computeCandidateId('b'.repeat(64), ids));
});

test('candidate graph accepts a connected six-node chain', () => assert.deepEqual(validateCandidateGraph(connected), []));

test('candidate graph rejects disconnected nodes', () => {
  const c = {...connected, relationships: connected.relationships.slice(0, 3)};
  assert.equal(validateCandidateGraph(c)[0].code, 'GRAPH_DISCONNECTED');
});

test('parallel relationship types do not inflate distinct publication edges', () => {
  const c = {...connected, relationships: [...connected.relationships, {source_a:'305',source_b:'355',type:'another'}]};
  assert.deepEqual(validateDistinctEdges(c), []);
  const duplicateOnly = {...connected, relationships: Array.from({length:5}, () => ({source_a:'305',source_b:'355'}))};
  assert.equal(validateDistinctEdges(duplicateOnly)[0].code, 'DISTINCT_EDGE_COUNT');
});

test('set equality is order-independent but requires six unique IDs', () => {
  assert.deepEqual(validateSetEquality(ids, [...ids].reverse()), []);
  assert.equal(validateSetEquality(ids, ['305','355','655','805','749','749'])[0].code, 'SET_DUPLICATE');
});

test('evidence must be an exact substring in its declared source', () => {
  const snapshot = {content_sha256:'a'.repeat(64), posts:[{source_id:'305',body:'blue bridge at dusk',original_markdown:'# Blue bridge at dusk'}]};
  const good = [{source_id:'305',result:'SIGNALS_FOUND',observations:[{prism:'Light',signal:'blue',interpretation:'colour',evidence:[{source:'BODY',quote:'blue bridge'}]}]}];
  const bad = [{source_id:'305',result:'SIGNALS_FOUND',observations:[{prism:'Light',signal:'blue',interpretation:'colour',evidence:[{source:'BODY',quote:'Blue bridge'}]}]}];
  assert.deepEqual(validateEvidenceAgainstSnapshot(good, snapshot), []);
  assert.equal(validateEvidenceAgainstSnapshot(bad, snapshot)[0].code, 'EVIDENCE_NOT_FOUND');
});

test('PASS requires all thresholds and no blocking issues', () => {
  const result = {candidate_id:'cand_'+'a'.repeat(64),decision:'PASS',scores:{semantic_coherence:4,curatorial_originality:4,narrative_integrity:4,visual_composition:4,evidence_integrity:5},blocking_issues:[]};
  assert.deepEqual(validateTestDecision(result), []);
  assert.equal(validateTestDecision({...result,scores:{...result.scores,visual_composition:3}})[0].code, 'PASS_SCORE_THRESHOLD');
  assert.equal(validateTestDecision({...result,blocking_issues:['evidence mismatch']})[0].code, 'PASS_BLOCKING_ISSUES');
});
