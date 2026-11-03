import type { ValidationResult } from "./types.ts";
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
export function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string, errors: string[]) {
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}: unexpected field "${key}"`);
  for (const key of expected) if (!(key in value)) errors.push(`${path}: missing field "${key}"`);
}
export function result(errors: string[]): ValidationResult {
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}
export function isStatus(value: unknown): value is "PASS" | "FAIL" | "NOT_RUN" {
  return value === "PASS" || value === "FAIL" || value === "NOT_RUN";
}
