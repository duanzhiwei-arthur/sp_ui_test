import {test} from 'node:test';import assert from 'node:assert/strict';
import {failureCategory,firstFailureCategoryMessages} from './failure-category.mjs';
import {mergeRecheckResult,finalSummary,finalExitCode} from './failure-recheck.mjs';
test('原因分类不把未知故障猜成网络，不改变复核判定',()=>{
  assert.equal(failureCategory('[SITE_VERIFICATION] HTTP403'),'access-blocked');
  assert.equal(failureCategory('[ASSET_OWNERSHIP]'),'ownership-unconfirmed');
  assert.equal(failureCategory('[CART_ASSET]'),'cart-asset-mismatch');
  assert.equal(failureCategory('[GENERATION_FAILED]'),'generation-failed');
  assert.equal(failureCategory('Timeout 120000ms'),'assertion-or-unknown');
  const c={title:'TC-03',status:'failed'},s={caseResults:[c],failures:[c.title],failureDetails:[{title:c.title,reason:'[ASSET_OWNERSHIP]'}]};
  assert.equal(finalExitCode(finalSummary(mergeRecheckResult(s,{caseResults:[{...c,status:'passed'}]},[c])),1),0);
  assert.equal(finalExitCode(finalSummary(mergeRecheckResult(s,{caseResults:[c]},[c])),1),1);
});
test('没有首次失败时不增加成功报告内容；恢复后仍记录分类',()=>{
 assert.deepEqual(firstFailureCategoryMessages({}),[]);
 assert.match(firstFailureCategoryMessages({recheck:{cases:[{firstFailure:{reason:'[SITE_VERIFICATION]'},finalStatus:'passed-on-recheck'}]}})[0],/验证\/访问阻断 1条/);
});
