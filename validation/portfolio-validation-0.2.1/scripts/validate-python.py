#!/usr/bin/env python3
"""Validate the same four Draft 2020-12 schemas and nine fixtures as Ajv."""
from __future__ import annotations
import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
except ImportError:
    print('BLOCKED: install pinned requirements from requirements-validation.txt', file=sys.stderr)
    raise SystemExit(2)

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ['candidate.schema.json', 'test-result.schema.json', 'snapshot.schema.json', 'discovery-record.schema.json']
FIXTURES = [
    ('test-result.schema.json', 'test-result.pass.valid.json', True),
    ('test-result.schema.json', 'test-result.pass.invalid-low-score.json', False),
    ('test-result.schema.json', 'test-result.pass.invalid-blocking.json', False),
    ('candidate.schema.json', 'candidate.pass.valid.json', True),
    ('candidate.schema.json', 'candidate.fail.source-count.json', False),
    ('candidate.schema.json', 'candidate.fail.duplicate-source.json', False),
    ('candidate.schema.json', 'candidate.fail.candidate-id.json', True),
    ('snapshot.schema.json', 'snapshot.valid.json', True),
    ('discovery-record.schema.json', 'discovery.valid.json', True),
]

def load(path: Path):
    with path.open(encoding='utf-8') as stream:
        return json.load(stream)

validators = {}
for filename in SCHEMAS:
    schema = load(ROOT / 'schemas' / filename)
    Draft202012Validator.check_schema(schema)
    validators[filename] = Draft202012Validator(schema)
    print(f'SCHEMA OK {filename}')

for schema_name, fixture_name, expected in FIXTURES:
    instance = load(ROOT / 'fixtures' / fixture_name)
    errors = list(validators[schema_name].iter_errors(instance))
    actual = not errors
    if actual != expected:
        details = '; '.join(error.message for error in errors[:5])
        print(f'FAIL {fixture_name}: expected {expected}, got {actual}: {details}', file=sys.stderr)
        raise SystemExit(1)
    print(f"FIXTURE {'VALID' if actual else 'INVALID AS EXPECTED'} {fixture_name}")
print(f'PYTHON VALIDATION PASS ({len(SCHEMAS)} schemas, {len(FIXTURES)} fixtures)')
