import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema, ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { InputValidator, ParseResult } from './parse.js';
import type { ValidationIssue } from './types.js';

function toIssues(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((error) => ({
    code: `SCHEMA_${error.keyword.toUpperCase()}`,
    message: `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`.trim(),
  }));
}

export function createAjvValidator<T>(schema: AnySchema): InputValidator<T> {
  // Each validator owns its Ajv registry. This avoids duplicate-$id errors
  // when callers compile the same schema more than once.
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  return (input: unknown): ParseResult<T> => {
    if (validate(input)) return { success: true, data: input as T, issues: [] };
    return { success: false, issues: toIssues(validate.errors) };
  };
}
