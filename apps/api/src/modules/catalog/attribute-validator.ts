import { AppError } from '../../common/errors/app-error';
import type { AttrField } from './categories/categories.service';

/**
 * Validates & normalizes listing attribute VALUES against a category's attribute
 * SCHEMA. This is what makes categories data-driven: no code changes to support a
 * new vertical — the schema lives in the Category row, and this function enforces it.
 *
 * Rules:
 *  - required fields must be present & non-empty
 *  - unknown keys are rejected (mass-assignment / junk defense)
 *  - each value is coerced/validated to its declared type
 *  - `select` values must be one of the allowed options
 */
export function validateAttributes(
  fields: AttrField[],
  input: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const values = input ?? {};
  const allowed = new Map(fields.map((f) => [f.key, f]));
  const out: Record<string, unknown> = {};
  const errors: string[] = [];

  // Reject unknown attribute keys.
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) errors.push(`Unknown attribute "${key}"`);
  }

  for (const field of fields) {
    const raw = values[field.key];
    const present = raw !== undefined && raw !== null && raw !== '';

    if (!present) {
      if (field.required) errors.push(`"${field.label}" is required`);
      continue;
    }

    switch (field.type) {
      case 'text': {
        if (typeof raw !== 'string') {
          errors.push(`"${field.label}" must be text`);
        } else if (raw.length > 200) {
          errors.push(`"${field.label}" is too long`);
        } else {
          out[field.key] = raw.trim();
        }
        break;
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) errors.push(`"${field.label}" must be a number`);
        else out[field.key] = n;
        break;
      }
      case 'boolean': {
        if (typeof raw === 'boolean') out[field.key] = raw;
        else if (raw === 'true' || raw === 'false') out[field.key] = raw === 'true';
        else errors.push(`"${field.label}" must be true or false`);
        break;
      }
      case 'select': {
        const opts = field.options ?? [];
        if (typeof raw !== 'string' || !opts.includes(raw)) {
          errors.push(`"${field.label}" must be one of: ${opts.join(', ')}`);
        } else {
          out[field.key] = raw;
        }
        break;
      }
      default:
        errors.push(`"${field.label}" has an unsupported type`);
    }
  }

  if (errors.length) throw AppError.validation('Invalid listing attributes', errors);
  return out;
}
