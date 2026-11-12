# Independent TEST Contract — Portfolio v1.3.1

**Status:** Implemented contract/schema foundation; no provider integration in this stage.

## Decision
TEST is a separate model invocation. The same model/provider is permitted, but a distinct invocation and isolated evaluation context are mandatory. A different model is preferred only when available and cost-effective.

## Context boundary
TEST receives the composed gallery, its six source publications with complete author text, source IDs, Snapshot identity, contract version, and formal scoring criteria. It must not receive COMPOSE private reasoning, Candidate Generation/Global Comparison scores, or COMPOSE self-assessment. A revised composition is evaluated afresh; previous TEST scores and findings are not supplied as evaluation evidence.

## Response
IndependentTestResponse contains candidate_id, decision (APPROVE/REJECT), five scores, findings, and blocking_issues. Scores are integers 1–5. APPROVE requires at least 4 in semantic_coherence, curatorial_originality, narrative_integrity, and visual_composition; evidence_integrity must equal 5; blocking_issues must be empty. **Evidence integrity is an approval hard gate, not a response-validity gate:** a score below 5 must prevent APPROVE and may be reported in a valid REJECT, provided at least one non-empty blocking issue explains the rejection. REJECT requires at least one blocking issue.

## Result semantics
Model decision APPROVE/REJECT is the evaluator decision. Existing normalized TestResult PASS/FAIL is a separate validation representation; do not conflate them. Technical inability to obtain or validate a response is Orchestrator INCOMPLETE, never REJECT, and must not trigger REVISION.

## Revision and audit
REVISION occurs only after a valid REJECT; maximum two attempts. Every revised composition receives a new independent TEST invocation. Each actual TEST provider invocation must be recorded in model_used with call_id, stage TEST, candidate_id, model, fallback_index, attempts, and outcome. Process Audit must verify actual invocation sequence and fresh TEST calls after revisions.

## Scope
This stage adds response types, JSON Schema, runtime structural/decision validation, and deterministic tests. It does not integrate a live provider, change Orchestrator execution, run Gemini, read live archive data, or alter target/main.