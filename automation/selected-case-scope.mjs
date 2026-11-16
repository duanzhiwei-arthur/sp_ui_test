import { ALL_CASE_IDS } from './canvas-scope.mjs';
export function selectedCaseIds(raw) {
  const ids = String(raw ?? '').split(',').map(id => id.trim());
  if (!ids.length || ids.length > ALL_CASE_IDS.length || ids.some(id => !ALL_CASE_IDS.includes(id)) || new Set(ids).size !== ids.length) throw Error('case_ids必须是现有用例ID的非空唯一清单');
  return ids;
}
export const selectedGrep = ids => `(?:^|\\s)(?:${ids.join('|')})[：:]`;
export const completeSelectedScope = (rows, ids) => rows.length === ids.length && ids.every(id => rows.filter(row => String(row.title).split(/[：:]/u)[0] === id).length === 1);
