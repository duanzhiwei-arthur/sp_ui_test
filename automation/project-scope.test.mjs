import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('远端case和三个workflow保留，埋点及退役旧画板入口移除',()=>{
 for(const file of ['tests/00-safe-cases.spec.ts','tests/home-clickable.spec.ts','tests/full-flow-inventory.spec.ts','tests/generation.spec.ts','tests/zz-experiments/membership-banner.spec.ts','.github/workflows/ui-regression.yml','.github/workflows/homepage-clickable.yml','.github/workflows/feishu-failure-video.yml']) {
   // 合并仓库副本不复制.github；仍检查原有case。
   if(file.startsWith('.github/')&&!fs.existsSync('.github'))continue;
   assert.ok(fs.existsSync(file),file);
 }
 const hasFiles=p=>fs.existsSync(p)&&(fs.statSync(p).isDirectory()?fs.readdirSync(p).some(n=>hasFiles(`${p}/${n}`)):true);
 for(const file of ['tests/tracking','playwright.tracking.config.ts','tests/zz-experiments/canvas-template.spec.ts'])assert.equal(hasFiles(file),false,file);
 const pkg=JSON.parse(fs.readFileSync('package.json'));assert.ok(pkg.scripts['test:homepage-clickable:scheduled']);assert.ok(pkg.scripts['test:canvas']);
 assert.equal(Object.keys(pkg.scripts).some(s=>s.includes('tracking')),false);
 const spec=fs.readFileSync('experiments/canvas-v3/daily-parity.spec.ts','utf8');for(let i=1;i<=5;i++)assert.match(spec,new RegExp(`EXP-TC-0${i}`));
 assert.match(fs.readFileSync('experiments/canvas-v3/board.ts','utf8'),/runtime-diagnostics/);
 assert.match(fs.readFileSync('tests/fixtures/automation-identity.ts','utf8'),/SDK_ANONYMOUS_ID_KEY = 'sdk_anonymous_id'/);
});
