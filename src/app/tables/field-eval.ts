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
/** Narrows `answers` to those matching every key/value pair in `filter`
 *  (string equality). No filter -> every answer is a candidate. Used when a
 *  questionId has more than one Answer doc and the spec needs to pick a
 *  specific one per column (e.g. an Adjective-form vs an Adverb-form answer
 *  recorded under the same research question). */
function matchesFilter(answers: any[], filter: Record<string, string> | undefined): any[] {
  if (!filter) return answers;
  const entries = Object.entries(filter);
  return answers.filter((a) => entries.every(([k, v]) => a?.[k] === v));
}

export function resolveText(answers: any[], binding: CellBinding | null | undefined): string {
  if (!binding) return '';
  const candidates = matchesFilter(answers || [], binding.filter);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of candidates) {
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

// --- edit-mode read/write paths --------------------------------------------
//
// A `CellBinding.field` is a `|`-combined list of `.`-nested key paths (see
// above). Editing needs each combined part as its own leaf field, and needs
// to read/write it correctly even when nested (`origin.source`) — unlike the
// legacy edit path, which only ever pipe-split (`splitCombinedField`) and
// then treated the result as a literal top-level answer key, silently
// corrupting any dotted field on save (reads `undefined`, writes a bogus
// flat `"origin.source"` key instead of updating `origin.source`).

/** Split a `|`-combined field spec into its component leaf paths. Each part
 *  may itself be `.`-nested (e.g. "source|language" -> ["source","language"],
 *  "origin.source" -> ["origin.source"]). */
export function splitFieldNames(fieldSpec: string): string[] {
  return fieldSpec.split('|').map((f) => f.trim()).filter((f) => f.length > 0);
}

/** Reads a `.`-nested path off an object (e.g. "origin.source"). */
export function getByPath(obj: any, path: string): any {
  if (obj == null) return undefined;
  return path.split('.').reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

/** Writes `value` at a `.`-nested path inside `target`, creating
 *  intermediate objects as needed. Mutates `target` in place so multiple
 *  calls sharing a prefix (e.g. "origin.source" then "origin.language")
 *  accumulate into the same nested object rather than clobbering it. */
export function setByPath(target: Record<string, any>, path: string, value: any): void {
  const parts = path.split('.');
  let cur: any = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (typeof cur[key] !== 'object' || cur[key] === null) {
      cur[key] = {};
    }
    cur = cur[key];
  }
  cur[parts[parts.length - 1]] = value;
}
