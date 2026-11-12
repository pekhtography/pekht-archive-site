import type { ValidationIssue } from './types.js';

export interface ParseSuccess<T> { success: true; data: T; issues: []; }
export interface ParseFailure { success: false; issues: ValidationIssue[]; }
export type ParseResult<T> = ParseSuccess<T> | ParseFailure;
export type InputValidator<T> = (input: unknown) => ParseResult<T>;

export function parseAndValidateInput<T>(input: unknown, validator: InputValidator<T>): ParseResult<T> {
  try {
    return validator(input);
  } catch {
    return { success: false, issues: [{ code: 'PARSE_EXCEPTION', message: 'Input validation failed unexpectedly' }] };
  }
}
