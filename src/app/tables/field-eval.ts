/**
 * Resolve a spec `CellBinding` against answer document(s) into display text.
 *
 * Faithful port of the value-resolution rules in the legacy
 * `tables.component.ts` (`updateCellWithSingleAnswer`, `extractNestedValue`,
 * `createCombinedDisplayValues`), unified so that the old `field` + `tableField`
 * split and the `[foreach]<div>` cell wrapper all reduce to:
 *
 *   field  = `|`-separated list of `.`-separated key paths
 *   layout = 'stack' (one value per line) | 'inline' (comma-joined)
 *
 * Path resolution: walk the dots into the answer; if a segment lands on an
 * array, map the remainder of every `|` part over each element and join that
 * element's parts with ": "; otherwise resolve each part and join with ": "
 * (first two with ": ", any remainder with ", " — matches the legacy 3-part
 * `source|language|origin` behaviour).
 */

import { CellBinding } from './table-spec.model';

const EMPTY = new Set([null, undefined, '', 'null']);

function isBlank(v: any): boolean {
  return EMPTY.has(v as any);
}

function walk(obj: any, keys: string[]): any {
  let cur = obj;
  for (const k of keys) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[k];
  }
  return cur;
}

function joinParts(values: string[]): string {
  const vals = values.filter((v) => !isBlank(v));
  if (vals.length === 0) return '';
  if (vals.length <= 2) return vals.join(': ');
  return `${vals.slice(0, 2).join(': ')}, ${vals.slice(2).join(', ')}`;
}

/** Longest common leading key-path shared by every part, e.g. ["markers"]. */
function commonPrefix(partKeys: string[][]): string[] {
  if (partKeys.length === 0) return [];
  const first = partKeys[0];
  let i = 0;
  for (; i < first.length; i++) {
    if (!partKeys.every((p) => p[i] === first[i])) break;
  }
  return first.slice(0, i);
}

/**
 * Resolve one binding against ONE answer.
 * Returns the list of display strings (length > 1 only when a path maps over an
 * array). Blank entries are dropped.
 */
export function resolveOne(answer: any, binding: CellBinding): string[] {
  if (!answer || !binding?.field) return [];
  const partKeys = binding.field.split('|').map((p) => p.trim().split('.'));

  // does a shared prefix land on an array?
  const prefix = commonPrefix(partKeys);
  for (let depth = prefix.length; depth >= 1; depth--) {
    const arr = walk(answer, prefix.slice(0, depth));
    if (Array.isArray(arr)) {
      const rest = partKeys.map((p) => p.slice(depth));
      return arr
        .map((el) => joinParts(rest.map((keys) => stringifyLeaf(walk(el, keys)))))
        .filter((s) => !isBlank(s));
    }
  }

  // no array prefix: resolve each part fully
  const values = partKeys.map((keys) => {
    const v = walk(answer, keys);
    return Array.isArray(v) ? v.filter((x) => !isBlank(x)).join(', ') : stringifyLeaf(v);
  });
  const joined = joinParts(values);
  return isBlank(joined) ? [] : [joined];
}

function stringifyLeaf(v: any): string {
  if (isBlank(v)) return '';
  if (Array.isArray(v)) return v.filter((x) => !isBlank(x)).join(', ');
  if (typeof v === 'object') return '';
  return String(v);
}

/**
 * Resolve a binding against the answers for one cell/column.
 *
 * `layout: 'stack'` keeps one value per line; `'inline'` (default) comma-joins.
 * Multiple answers are flattened together and de-duplicated, preserving first
 * occurrence order (legacy `createCombinedDisplayValues` semantics).
 */
export function resolveText(answers: any[], binding: CellBinding | null | undefined): string {
  if (!binding) return '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of answers || []) {
    for (const v of resolveOne(a, binding)) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  if (out.length === 0) return '';
  return binding.layout === 'stack' ? out.join('\n') : out.join(', ');
}
