#!/usr/bin/env node
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export function intervalFromHexNibble(nibble) {
  const value = String(nibble).toLowerCase();
  if (!/^[0-9a-f]$/.test(value)) throw new Error(`Invalid SHA-256 hex nibble: ${nibble}`);
  const number = parseInt(value, 16);
  if (number <= 4) return 5;
  if (number <= 10) return 6;
  return 7;
}

export function intervalDaysForRunId(runId) {
  const firstHex = createHash("sha256").update(String(runId)).digest("hex")[0];
  return intervalFromHexNibble(firstHex);
}

export function evaluateScheduler(runsPayload, nowEpoch = Math.floor(Date.now() / 1000)) {
  const runs = Array.isArray(runsPayload?.workflow_runs) ? runsPayload.workflow_runs : [];
  const latest = runs
    .filter((run) => run && run.head_branch === "main")
    .sort((a, b) => Number(a.run_number) - Number(b.run_number))
    .at(-1);

  if (!latest) return { action: "skip", reason: "no-main-run" };

  const runId = latest.id;
  const runNumber = latest.run_number;
  if (latest.status !== "completed") {
    return { action: "skip", reason: "latest-run-not-completed", run_id: runId, run_number: runNumber };
  }

  // GitHub workflow-run payloads may omit completed_at; updated_at is the
  // completion timestamp for a completed run and is the safe fallback.
  const completedAt = latest.completed_at ?? latest.updated_at;
  if (!completedAt) {
    return { action: "skip", reason: "latest-run-not-completed", run_id: runId, run_number: runNumber };
  }

  const completedEpoch = Math.floor(Date.parse(completedAt) / 1000);
  if (!Number.isFinite(completedEpoch)) {
    return { action: "skip", reason: "invalid-completed-at", run_id: runId, run_number: runNumber };
  }

  const intervalDays = intervalDaysForRunId(runId);
  const dueEpoch = completedEpoch + intervalDays * 86400;
  const common = { run_id: runId, run_number: runNumber, interval_days: intervalDays, due_epoch: dueEpoch };
  if (nowEpoch < dueEpoch) return { action: "wait", reason: "interval-not-elapsed", ...common };
  return { action: "dispatch", reason: "interval-elapsed", ...common };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    const payload = JSON.parse(input);
    const nowEpoch = process.env.SCHEDULER_NOW_EPOCH === undefined
      ? Math.floor(Date.now() / 1000)
      : Number(process.env.SCHEDULER_NOW_EPOCH);
    if (!Number.isFinite(nowEpoch)) throw new Error("SCHEDULER_NOW_EPOCH must be a finite Unix timestamp");
    process.stdout.write(JSON.stringify(evaluateScheduler(payload, nowEpoch)) + "\n");
  } catch (error) {
    process.stderr.write(`Journal scheduler error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
