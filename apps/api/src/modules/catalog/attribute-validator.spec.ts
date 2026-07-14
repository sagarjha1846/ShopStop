import { validateAttributes } from './attribute-validator';
import type { AttrField } from './categories/categories.service';
import { AppError } from '../../common/errors/app-error';

const fields: AttrField[] = [
  { key: 'brand', label: 'Brand', type: 'text', required: true },
  { key: 'year', label: 'Year', type: 'number' },
  { key: 'fuel', label: 'Fuel', type: 'select', options: ['Petrol', 'Diesel', 'Electric'] },
  { key: 'furnished', label: 'Furnished', type: 'boolean' },
];

describe('validateAttributes', () => {
  it('accepts and normalizes valid input', () => {
    const out = validateAttributes(fields, {
      brand: '  Toyota ',
      year: '2020',
      fuel: 'Diesel',
      furnished: 'true',
    });
    expect(out).toEqual({ brand: 'Toyota', year: 2020, fuel: 'Diesel', furnished: true });
  });

  it('rejects missing required fields', () => {
    expect(() => validateAttributes(fields, { year: 2020 })).toThrow(AppError);
  });

  /** Helper: capture the details[] array that carries the specific messages. */
  const detailsOf = (input: Record<string, unknown>): string[] => {
    try {
      validateAttributes(fields, input);
      throw new Error('expected validation to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      return (e as AppError).details as string[];
    }
  };

  it('rejects unknown attribute keys (mass-assignment defense)', () => {
    expect(detailsOf({ brand: 'X', hacker: 'boom' }).join(' ')).toMatch(/Unknown attribute/);
  });

  it('rejects select values outside the allowed options', () => {
    expect(() => validateAttributes(fields, { brand: 'X', fuel: 'Nuclear' })).toThrow(AppError);
  });

  it('rejects non-numeric numbers', () => {
    expect(detailsOf({ brand: 'X', year: 'abcd' }).join(' ')).toMatch(/must be a number/);
  });

  it('allows optional fields to be omitted', () => {
    expect(validateAttributes(fields, { brand: 'Honda' })).toEqual({ brand: 'Honda' });
  });

  it('treats empty string as absent', () => {
    expect(detailsOf({ brand: '' }).join(' ')).toMatch(/required/);
  });
});
