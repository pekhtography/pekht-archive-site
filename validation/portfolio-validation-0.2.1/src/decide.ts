import type { TestDecision, TestResult } from './types.js';

// Call only after validateTestDecision (and structural schema validation) succeeds.
// This function intentionally does not duplicate validation.
export function decideTestResult(testResult: TestResult): TestDecision {
  return testResult.decision === 'PASS' ? 'APPROVED' : 'REJECT';
}
