/**
 * Answer field values aren't always flat strings — some (e.g. `origin`,
 * `base_origin`) are `{source, language}` objects, and some (e.g. `markers`)
 * are arrays of such objects. Recursively flattens to display text instead of
 * letting `{{ }}` interpolation stringify a raw object to "[object Object]".
 *
 * Shared by every place that renders a raw answer record field-by-field
 * (search results, the comparison view, the phrases modal) — previously
 * three separate, all equally unformatted, copies of the same `{{ field.value }}`.
 */
export function formatFieldValue(value: any): string {
  if (value === null || value === undefined || value === 'null') return '';
  if (Array.isArray(value)) {
    return value.map(formatFieldValue).filter(v => v !== '').join(', ');
  }
  if (typeof value === 'object') {
    return Object.values(value).map(formatFieldValue).filter(v => v !== '').join(': ');
  }
  return String(value);
}
