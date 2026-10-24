import test from "node:test";
import assert from "node:assert/strict";
import {
  intervalFromHexNibble,
  intervalDaysForRunId,
  evaluateScheduler,
} from "./journal-scheduler.js";

const completedAt = "2026-01-01T00:00:00Z";
const completedEpoch = Date.parse(completedAt) / 1000;
const run = (overrides = {}) => ({
  id: 12345,
  run_number: 12,
  head_branch: "main",
  status: "completed",
  completed_at: completedAt,
  ...overrides,
});

test("maps all SHA-256 hex nibbles to intervals 4–7 with an equal 4/4/4/4 split", () => {
  const expected = "4444555566667777";
  const counts = { 4: 0, 5: 0, 6: 0, 7: 0 };
  for (let i = 0; i < 16; i += 1) {
    const interval = intervalFromHexNibble(i.toString(16));
    assert.equal(interval, Number(expected[i]));
    counts[interval] += 1;
  }
  assert.deepEqual(counts, { 4: 4, 5: 4, 6: 4, 7: 4 });
});

test("rejects invalid hash nibbles", () => {
  assert.throws(() => intervalFromHexNibble("g"), /Invalid SHA-256 hex nibble/);
});

test("skips when no Journal run on main exists", () => {
  assert.deepEqual(evaluateScheduler({ workflow_runs: [run({ head_branch: "feature" })] }, completedEpoch), {
    action: "skip",
    reason: "no-main-run",
  });
});

test("skips while the latest main run is still active", () => {
  const result = evaluateScheduler({ workflow_runs: [run({ status: "in_progress", completed_at: null })] }, completedEpoch + 999999);
  assert.equal(result.action, "skip");
  assert.equal(result.reason, "latest-run-not-completed");
});

test("uses updated_at when a completed GitHub run omits completed_at", () => {
  const updatedAt = "2026-01-02T03:04:05Z";
  const updatedEpoch = Date.parse(updatedAt) / 1000;
  const apiRun = run({ completed_at: undefined, updated_at: updatedAt });
  delete apiRun.completed_at;

  const interval = intervalDaysForRunId(apiRun.id);
  const result = evaluateScheduler(
    { workflow_runs: [apiRun] },
    updatedEpoch + interval * 86400 - 1,
  );

  assert.equal(result.action, "wait");
  assert.equal(result.reason, "interval-not-elapsed");
  assert.equal(result.interval_days, interval);
  assert.equal(result.due_epoch, updatedEpoch + interval * 86400);
});

test("waits until the full selected interval has elapsed", () => {
  const interval = intervalDaysForRunId(12345);
  const result = evaluateScheduler({ workflow_runs: [run()] }, completedEpoch + interval * 86400 - 1);
  assert.equal(result.action, "wait");
  assert.equal(result.reason, "interval-not-elapsed");
  assert.equal(result.interval_days, interval);
  assert.equal(result.due_epoch, completedEpoch + interval * 86400);
});

test("dispatches only at or after the due timestamp and selects the latest main run", () => {
  const older = run({ id: 100, run_number: 11 });
  const latest = run({ id: 12345, run_number: 12 });
  const unrelatedNewer = run({ id: 999, run_number: 99, head_branch: "feature" });
  const interval = intervalDaysForRunId(latest.id);
  const result = evaluateScheduler({ workflow_runs: [older, unrelatedNewer, latest] }, completedEpoch + interval * 86400);
  assert.equal(result.action, "dispatch");
  assert.equal(result.reason, "interval-elapsed");
  assert.equal(result.run_number, 12);
  assert.equal(result.interval_days, interval);
});
