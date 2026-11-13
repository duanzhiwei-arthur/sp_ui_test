export const CANVAS_CONTROL_CASE_IDS = Object.freeze(Array.from({ length: 6 }, (_, i) => `TC-0${i}`));
export const CANVAS_TREATMENT_CASE_IDS = Object.freeze(['EXP-TC-01']);
export const CANVAS_CASE_IDS = Object.freeze([...CANVAS_CONTROL_CASE_IDS, ...CANVAS_TREATMENT_CASE_IDS]);
export const CANVAS_MAX_GENERATIONS_PER_RUN = 8; // 3 control + 1 treatment, each rechecked at most once
const caseId = title => String(title ?? '').split(/[：:]/u)[0];
export const isCanvasTreatment = title => CANVAS_TREATMENT_CASE_IDS.includes(caseId(title));
export const isCanvasControl = title => CANVAS_CONTROL_CASE_IDS.includes(caseId(title));
export const hasCompleteCanvasScope = cases => cases.length === CANVAS_CASE_IDS.length
  && CANVAS_CASE_IDS.every(id => cases.filter(row => caseId(row.title) === id).length === 1);
