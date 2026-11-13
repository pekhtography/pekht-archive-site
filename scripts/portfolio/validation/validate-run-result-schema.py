#!/usr/bin/env python3
"""Independent Draft 2020-12 checks for Portfolio standalone run-result contracts.

Uses jsonschema 4.26.0 as an independent interim validator. This is NOT an Ajv PASS.
"""
from copy import deepcopy
from pathlib import Path
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "schemas"
BASE = "https://pekhtography.local/schemas/"
def load(name):
    return __import__("json").loads((SCHEMAS / name).read_text(encoding="utf-8"))

run_schema = load("portfolio-run-result.schema.json")
run_schema["$id"] = BASE + "portfolio-run-result.schema.json"
resources = {
    "portfolio-run-result.schema.json": run_schema,
    "gemini-gallery.schema.json": load("gemini-gallery.schema.json"),
    "independent-test-response-v1.3.2.schema.json": load("independent-test-response-v1.3.2.schema.json"),
    "gemini-output.schema.json": load("gemini-output.schema.json"),
}
registry = Registry()
for filename, schema in resources.items():
    Draft202012Validator.check_schema(schema)
    uri = BASE + filename
    registry = registry.with_resource(uri, Resource.from_contents(schema))
validator = Draft202012Validator(run_schema, registry=registry, format_checker=Draft202012Validator.FORMAT_CHECKER)

snapshot = {
    "schema_version": "1.0",
    "repository_commit": "a" * 40,
    "generated_at": "2026-11-12T10:00:00Z",
    "sampled_count": 1000,
    "content_sha256": "b" * 64,
}
def gallery():
    ids = ["src-1", "src-2", "src-3", "src-4", "src-5", "src-6"]
    return {
        "source_ids": ids,
        "title": "Six ways of seeing",
        "statement": "The same light creates distinct realities.",
        "facets": ["Light", "Perception"],
        "roles": [{
            "source_id": sid, "role": "Counterpoint", "operation": "Reframe",
            "evidence": [{"quote": "Light changes everything", "interpretation": "A shift in perception"}],
            "necessity": "Provides a distinct step in the sequence"
        } for sid in ids],
        "composition_rationale": "A coherent progression from observation to transformation.",
        "alternatives_considered": ["A purely chronological sequence"],
        "doubts": [],
    }
def test_response(candidate_id, decision):
    scores = {
        "semantic_coherence": 4 if decision == "APPROVE" else 3,
        "curatorial_originality": 4 if decision == "APPROVE" else 3,
        "narrative_integrity": 4 if decision == "APPROVE" else 3,
        "visual_composition": 4 if decision == "APPROVE" else 3,
        "evidence_integrity": 5 if decision == "APPROVE" else 3,
    }
    if decision == "APPROVE":
        return {"candidate_id": candidate_id, "decision": decision, "scores": scores, "findings": [], "blocking_issues": []}
    finding = {
        "criterion": "semantic_coherence", "issue": "The sequence lacks a coherent relation.",
        "blocking": True,
        "evidence": {"kind": "SOURCE", "source_id": "src-1", "quote": "The source text does not support the proposed relation."}
    }
    return {"candidate_id": candidate_id, "decision": decision, "scores": scores, "findings": [finding], "blocking_issues": ["The sequence lacks a coherent relation."]}

def base_result(status, validation_status="PASS"):
    return {
        "status": status,
        "input_snapshot": deepcopy(snapshot),
        "gemini_output": None,
        "validation": {
            "status": validation_status,
            "structural": "PASS" if validation_status == "PASS" else "FAIL",
            "semantic": "PASS" if validation_status == "PASS" else "FAIL",
            "process": "PASS" if validation_status == "PASS" else "FAIL",
            "findings": [],
        },
        "model_used": [],
    }

def approved():
    cid = "cand_" + "a" * 64
    comp, test = gallery(), test_response(cid, "APPROVE")
    candidate = {"candidate_id": cid, "status": "APPROVED", "composition": comp, "independent_test": test, "revision_cycles": 1, "findings": []}
    result = base_result("APPROVED")
    result.update(composition=comp, independent_test=test, candidate_results=[candidate])
    return result

def no_gallery():
    cid = "cand_" + "b" * 64
    candidate = {"candidate_id": cid, "status": "REVISION_EXHAUSTED", "composition": gallery(), "independent_test": test_response(cid, "REJECT"), "revision_cycles": 2, "findings": ["The sequence lacks a coherent relation."]}
    result = base_result("NO_GALLERY")
    result.update(composition=None, independent_test=None, candidate_results=[candidate])
    return result

def incomplete():
    cid = "cand_" + "c" * 64
    candidate = {"candidate_id": cid, "status": "INCOMPLETE", "composition": None, "independent_test": None, "revision_cycles": 0, "findings": ["Provider fallback exhausted"]}
    result = base_result("INCOMPLETE", "FAIL")
    result.update(composition=None, independent_test=None, candidate_results=[candidate])
    return result

def rejected_candidate():
    cid = "cand_" + "d" * 64
    return {"candidate_id": cid, "status": "REJECTED", "composition": None, "independent_test": test_response(cid, "REJECT"), "revision_cycles": 0, "findings": ["Rejected after independent TEST"]}

def check(label, instance, expected_valid):
    errors = sorted(validator.iter_errors(instance), key=lambda e: (list(map(str, e.absolute_path)), e.message))
    valid = not errors
    if valid != expected_valid:
        print(f"FAIL {label}: expected valid={expected_valid}, got valid={valid}")
        for error in errors[:8]:
            print("  - " + "/".join(map(str, error.absolute_path)) + ": " + error.message)
        return False
    print(f"PASS {label}")
    return True

checks = []
checks.append(check("standalone APPROVED", approved(), True))
checks.append(check("standalone NO_GALLERY after REVISION_EXHAUSTED", no_gallery(), True))
checks.append(check("standalone INCOMPLETE", incomplete(), True))
ng_rejected = no_gallery()
ng_rejected["candidate_results"].append(rejected_candidate())
checks.append(check("NO_GALLERY with exhausted and rejected candidates", ng_rejected, True))

bad = approved(); bad["validation"]["semantic"] = "FAIL"
checks.append(check("reject APPROVED with failed semantic validation", bad, False))
bad = approved(); bad["candidate_results"][0]["revision_cycles"] = 3
checks.append(check("reject revision count above two", bad, False))
bad = approved(); bad["independent_test"]["scores"]["semantic_coherence"] = 3
bad["candidate_results"][0]["independent_test"]["scores"]["semantic_coherence"] = 3
checks.append(check("reject APPROVE below score threshold", bad, False))
bad = approved(); bad["composition"]["source_ids"].pop()
bad["candidate_results"][0]["composition"]["source_ids"].pop()
checks.append(check("reject composition with fewer than six source IDs", bad, False))
bad = no_gallery(); bad["candidate_results"][0]["revision_cycles"] = 1
checks.append(check("reject REVISION_EXHAUSTED before two revisions", bad, False))
bad = no_gallery(); bad["candidate_results"][0]["independent_test"]["blocking_issues"] = []
checks.append(check("reject REJECT without blocking issue", bad, False))

if not all(checks):
    raise SystemExit(1)
print(f"Independent Draft 2020-12 validation: {len(checks)} checks passed; jsonschema 4.26.0.")
print("This result is Python jsonschema PASS only; it is not an Ajv PASS.")
