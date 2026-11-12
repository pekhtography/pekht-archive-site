import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeCandidateId, validateCandidate, validateCandidateGraph, validateCandidateSourcesPresent, validateDistinctEdges, validateDiscoveryCoverage, validateDiscoveryRecords, validateEvidenceAgainstSnapshot, validateObservationRefs, validateSetEquality, validateTestDecision, buildUnambiguousDiscoveryRecords } from '../src/validators.ts';
const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const candidate = fixture('candidate.pass.valid.json'); const snapshot = fixture('snapshot.valid.json'); const records = [fixture('discovery.valid.json'), ...fixture('candidate.pass.valid.json').source_ids.slice(1).map((sourceId) => ({source_id:sourceId,result:'SIGNALS_FOUND',observations:[{prism:'Material',signal:'blue detail',interpretation:`A textual blue detail in source ${sourceId}`,evidence:[{source:'BODY',quote:'distinctive blue detail'}]}]}))];
const ids = candidate.source_ids;


test('COV-01 Snapshot and Discovery coverage accepts the same complete set in any order', () => {
  assert.deepEqual(validateDiscoveryCoverage(snapshot, [...records].reverse()), []);
});

test('COV-02 missing Snapshot source is rejected', () => {
  assert.equal(validateDiscoveryCoverage(snapshot, records.slice(1)).some(x => x.code === 'DISCOVERY_SOURCE_MISSING'), true);
});

test('COV-03 duplicate Discovery record is rejected', () => {
  const issues = validateDiscoveryCoverage(snapshot, [...records, structuredClone(records[0])]);
  assert.equal(issues.some(x => x.code === 'DISCOVERY_SOURCE_DUPLICATE'), true);
  assert.equal(issues.some(x => x.code === 'DISCOVERY_COVERAGE_INCOMPLETE'), true);
});

test('COV-04 unexpected Discovery source is rejected', () => {
  const extra = { source_id: 'outside-snapshot', result: 'NO_SIGNAL', observations: [] };
  assert.equal(validateDiscoveryCoverage(snapshot, [...records, extra]).some(x => x.code === 'DISCOVERY_SOURCE_UNEXPECTED'), true);
});

test('COV-05 duplicate and empty Snapshot source IDs are rejected', () => {
  const duplicate = { ...snapshot, posts: [...snapshot.posts, structuredClone(snapshot.posts[0])] };
  assert.equal(validateDiscoveryCoverage(duplicate, records).some(x => x.code === 'SNAPSHOT_SOURCE_DUPLICATE'), true);
  const empty = { ...snapshot, posts: [...snapshot.posts, { ...snapshot.posts[0], source_id: '  ' }] };
  assert.equal(validateDiscoveryCoverage(empty, records).some(x => x.code === 'SNAPSHOT_SOURCE_INVALID'), true);
});

test('COV-06 full-size 3,240-to-3,239 coverage gap is rejected', () => {
  const largeSnapshot = { ...snapshot, posts: Array.from({ length: 3240 }, (_, i) => ({ source_id: String(i), body: '', original_markdown: '' })) };
  const almostComplete = Array.from({ length: 3239 }, (_, i) => ({ source_id: String(i), result: 'NO_SIGNAL', observations: [] }));
  assert.equal(validateDiscoveryCoverage(largeSnapshot, almostComplete).some(x => x.code === 'DISCOVERY_SOURCE_MISSING'), true);
});

test('COV-07 malformed Discovery records do not satisfy coverage', () => {
  const malformed = records.map(record => ({ ...record }));
  malformed[0] = { ...malformed[0], result: 'SIGNALS_FOUND', observations: [] };
  const issues = validateDiscoveryCoverage(snapshot, malformed);
  assert.equal(issues.some(x => x.code === 'DISCOVERY_RESULT_OBSERVATION_MISMATCH'), true);
  assert.equal(issues.some(x => x.code === 'DISCOVERY_SOURCE_MISSING'), true);
});

test('DISC-01 to DISC-05 Discovery result and observations are consistent', () => {
  const validSignals = { source_id: 'a', result: 'SIGNALS_FOUND', observations: [{ prism: 'Motif', signal: 'signal', interpretation: 'meaning', evidence: [{ source: 'BODY', quote: 'quote' }] }] };
  const validNone = { source_id: 'b', result: 'NO_SIGNAL', observations: [] };
  assert.deepEqual(validateDiscoveryRecords([validSignals]), []);
  assert.deepEqual(validateDiscoveryRecords([validNone]), []);
  assert.equal(validateDiscoveryRecords([{ ...validSignals, observations: [] }]).some(x => x.code === 'DISCOVERY_RESULT_OBSERVATION_MISMATCH'), true);
  assert.equal(validateDiscoveryRecords([{ ...validNone, observations: [validSignals.observations[0]] }]).some(x => x.code === 'DISCOVERY_RESULT_OBSERVATION_MISMATCH'), true);
  assert.equal(validateDiscoveryRecords([{ ...validNone, result: 'UNKNOWN' }]).some(x => x.code === 'DISCOVERY_RESULT_INVALID'), true);
});

test('CANDIDATE observation ownership rejects an observation from a seventh source', () => {
  const outside = { source_id: 'seventh', result: 'SIGNALS_FOUND', observations: [{ prism: 'Motif', signal: 'signal', interpretation: 'meaning', evidence: [{ source: 'BODY', quote: 'quote' }] }] };
  const altered = { ...candidate, observation_ids: [...candidate.observation_ids, 'seventh:0'] };
  assert.equal(validateObservationRefs(altered, [...records, outside]).some(x => x.code === 'CANDIDATE_OBSERVATION_SOURCE_MISMATCH'), true);
});

test('T-01 candidate source coverage requires exactly six unique sources present once', () => {
  assert.deepEqual(validateCandidateSourcesPresent(candidate, records), []);
  assert.equal(validateCandidateSourcesPresent({...candidate,source_ids:ids.slice(0,5)},records)[0].code,'CANDIDATE_SOURCE_COUNT');
  assert.equal(validateCandidateSourcesPresent({...candidate,source_ids:[...ids.slice(0,5),ids[0]]},records).some(x=>x.code==='CANDIDATE_SOURCE_DUPLICATE'),true);
  assert.equal(validateCandidateSourcesPresent(candidate,records.slice(1)).some(x=>x.code==='CANDIDATE_SOURCE_MISSING'),true);
});

test('T-02 set equality remains a separate exact-six utility', () => {
  assert.deepEqual(validateSetEquality(ids,[...ids].reverse()),[]);
  assert.equal(validateSetEquality(ids,['305','355','655','805','749','749'])[0].code,'SET_DUPLICATE');
});

test('T-03 observation references resolve using source_id:index', () => {
  assert.deepEqual(validateObservationRefs(candidate,records),[]);
  assert.equal(validateObservationRefs({...candidate,observation_ids:['missing:0']},records)[0].code,'UNKNOWN_OBSERVATION');
});

test('T-04 evidence is exact, source-restricted, and limited to Candidate observations', () => {
  assert.deepEqual(validateEvidenceAgainstSnapshot(candidate,snapshot,records),[]);
  const bad = structuredClone(records); bad[0].observations[0].evidence[0].quote='not present';
  assert.equal(validateEvidenceAgainstSnapshot(candidate,snapshot,bad)[0].code,'EVIDENCE_NOT_FOUND');
  const unrelated = structuredClone(records); unrelated.push({source_id:'outside',result:'SIGNALS_FOUND',observations:[{prism:'x',signal:'y',interpretation:'z',evidence:[{source:'BODY',quote:'not in snapshot'}]}]});
  assert.deepEqual(validateEvidenceAgainstSnapshot(candidate,snapshot,unrelated),[]);
  const invalidSource = structuredClone(records); invalidSource[0].observations[0].evidence[0].source='IMAGE';
  assert.equal(validateEvidenceAgainstSnapshot(candidate,snapshot,invalidSource)[0].code,'INVALID_EVIDENCE_SOURCE');
});

test('T-05 Discovery validation reports duplicate source and duplicate observation diagnostics', () => {
  const duplicated = [...records, structuredClone(records[0])];
  assert.equal(validateDiscoveryRecords(duplicated).some(x=>x.code==='DISCOVERY_SOURCE_DUPLICATE'),true);
  const repeatedObservation = [{...records[0],observations:[records[0].observations[0],structuredClone(records[0].observations[0])]}];
  assert.equal(validateDiscoveryRecords(repeatedObservation).some(x=>x.code==='DISCOVERY_OBSERVATION_DUPLICATE'),true);
  assert.equal(validateDiscoveryRecords([{...records[0],source_id:''}]).some(x=>x.code==='DISCOVERY_SOURCE_INVALID'),true);
  assert.equal(validateDiscoveryRecords([{...records[0],observations:[{prism:'',signal:'x',interpretation:'y',evidence:[]}]}]).some(x=>x.code==='DISCOVERY_OBSERVATION_STRUCTURE'),true);
});

test('T-05 duplicate source records are all excluded from unambiguous lookup', () => {
  const duplicated=[...records,structuredClone(records[0])];
  const safe=buildUnambiguousDiscoveryRecords(duplicated);
  assert.equal(safe.some(x=>x.source_id==='305'),false);
  assert.equal(safe.length,5);
});

test('T-06 distinct edges count unordered endpoint pairs, not relationship types', () => {
  const parallel={...candidate,relationships:[...candidate.relationships,{...candidate.relationships[0],type:'different'}]};
  assert.deepEqual(validateDistinctEdges(parallel),[]);
  assert.equal(validateDistinctEdges({...candidate,relationships:Array(5).fill(candidate.relationships[0])})[0].code,'DISTINCT_EDGE_COUNT');
});

test('T-07 graph connectivity requires all six nodes', () => {
  assert.deepEqual(validateCandidateGraph(candidate),[]);
  assert.equal(validateCandidateGraph({...candidate,relationships:candidate.relationships.slice(0,3)})[0].code,'GRAPH_DISCONNECTED');
});

test('T-08 integration applies discovery, safe lookup, source coverage, refs, edges, graph, evidence, ID', () => {
  assert.deepEqual(validateCandidate(candidate,snapshot,records),[]);
  const dup=[...records,structuredClone(records[0])];
  const issues=validateCandidate(candidate,snapshot,dup);
  assert.equal(issues.some(x=>x.code==='DISCOVERY_SOURCE_DUPLICATE'),true);
  assert.equal(issues.some(x=>x.code==='DISCOVERY_SOURCE_MISSING'),true);
});

test('T-09 PASS decision invariants remain enforced', () => {
  const result=fixture('test-result.pass.valid.json');
  assert.deepEqual(validateTestDecision(result),[]);
  assert.equal(validateTestDecision({...result,scores:{...result.scores,visual_composition:3}})[0].code,'PASS_SCORE_THRESHOLD');
});

test('T-10 canonical Candidate ID matches the frozen vector', () => {
  assert.equal(computeCandidateId('a'.repeat(64),['305','355','655','805','749','524']), 'cand_4842d793284c56fc53a1e8453133677bc9c85c7e351732a8f13ff9cba87edea1');
  assert.equal(candidate.candidate_id,computeCandidateId(snapshot.content_sha256,candidate.source_ids));
  const wrongId=fixture('candidate.fail.candidate-id.json');
  assert.equal(validateCandidate(wrongId,snapshot,records).some(x=>x.code==='CANDIDATE_ID_MISMATCH'),true);
});
