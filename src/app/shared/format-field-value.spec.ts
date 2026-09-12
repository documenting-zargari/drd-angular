import { formatFieldValue } from './format-field-value';

describe('formatFieldValue', () => {
  it('passes through plain strings/numbers', () => {
    expect(formatFieldValue('sar tǝ ovel')).toBe('sar tǝ ovel');
    expect(formatFieldValue(5)).toBe('5');
  });

  it('returns "" for null/undefined/"null"', () => {
    expect(formatFieldValue(null)).toBe('');
    expect(formatFieldValue(undefined)).toBe('');
    expect(formatFieldValue('null')).toBe('');
  });

  // regression: base_origin/origin answer fields are {source, language}
  // objects — used to render as the literal string "[object Object]" on the
  // /search results page and the comparison view (views.component).
  it('flattens a {source, language} object, dropping null members', () => {
    expect(formatFieldValue({ source: 'Inherited', language: null })).toBe('Inherited');
    expect(formatFieldValue({ source: 'Current-L2', language: 'Bulgarian' }))
      .toBe('Current-L2: Bulgarian');
  });

  // regression: the `markers` answer field is an array of such objects.
  it('flattens an array of nested objects (e.g. markers)', () => {
    const markers = [
      { marker: 'sar', inheritance: 'sar', origin: { source: 'Inherited', language: null } },
    ];
    expect(formatFieldValue(markers)).toBe('sar: sar: Inherited');
    expect(formatFieldValue(markers)).not.toContain('[object Object]');
  });
});
