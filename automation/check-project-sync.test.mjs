import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';import path from 'node:path';import {tmpdir} from 'node:os';
import {checkProjectSync} from './check-project-sync.mjs';
test('同步检查只比较提交，不受脏工作区影响；共享代码差异可发现，专用发布配置保留',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'qa-sync-'));
 const git=(root,args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
 try{
  const a=path.join(dir,'source'),b=path.join(dir,'copy');
  for(const root of [a,b]){await mkdir(root);git(root,['init','-q']);}
  await mkdir(path.join(a,'tests'));await writeFile(path.join(a,'tests/a.ts'),'same\n');
  await mkdir(path.join(b,'projects/sp_ui_test/tests'),{recursive:true});await writeFile(path.join(b,'projects/sp_ui_test/tests/a.ts'),'same\n');
  await writeFile(path.join(b,'projects/sp_ui_test/playwright.release.config.ts'),'project specific');
  const commit=root=>{git(root,['add','.']);git(root,['-c','user.name=QA','-c','user.email=qa@example.invalid','commit','-qm','fixture']);};
  commit(a);commit(b);assert.deepEqual(checkProjectSync(a,b).differences,[]);
  await writeFile(path.join(a,'tests/a.ts'),'dirty');assert.deepEqual(checkProjectSync(a,b).differences,[]);
  commit(a);assert.deepEqual(checkProjectSync(a,b).differences,[{file:'tests/a.ts',reason:'content-differs'}]);
  await writeFile(path.join(a,'tests/new.ts'),'new');commit(a);
  assert.equal(checkProjectSync(a,b).differences.find(x=>x.file==='tests/new.ts').reason,'missing-in-copy');
  await writeFile(path.join(b,'projects/sp_ui_test/tests/extra.ts'),'extra');commit(b);
  assert.equal(checkProjectSync(a,b).differences.find(x=>x.file==='tests/extra.ts').reason,'copy-only');
  assert.throws(()=>checkProjectSync(a,b,'--bad-ref'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
