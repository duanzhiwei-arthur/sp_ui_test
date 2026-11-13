export function canvasRunOptions(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv) {
  const delay = env.UI_ACTION_DELAY_MS?.trim();
  const slowMo = delay ? Number(delay) : argv.includes('--headed') && env.CI !== 'true' ? 1_500 : 0;
  if ((delay && !/^\d+$/.test(delay)) || !Number.isInteger(slowMo) || slowMo < 0 || slowMo > 5_000) {
    throw new Error('UI_ACTION_DELAY_MS必须为0～5000的整数毫秒；0关闭演示减速');
  }
  const parallel = env.CANVAS_PARALLEL_GROUPS?.trim();
  if (parallel && !['true', 'false'].includes(parallel)) throw new Error('CANVAS_PARALLEL_GROUPS仅支持true或false');
  if (parallel === 'true' && (env.CI === 'true' || env.GITHUB_ACTIONS === 'true')) throw new Error('远端/CI保持串行；CANVAS_PARALLEL_GROUPS仅用于本地对比');
  return { slowMo, workers: parallel === 'true' ? 2 : 1 };
}
