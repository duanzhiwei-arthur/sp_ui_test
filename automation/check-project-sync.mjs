import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 只读比较git提交，不fetch、不复制、不覆盖工作区；两种仓库均可执行。
export function checkProjectSync(source, destination, sourceRef='HEAD', destinationRef='HEAD') {
  const git=(root,args)=>execFileSync('git',['-C',root,...args],{maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
  const revision=(root,ref)=>git(root,['rev-parse','--verify',`${ref}^{commit}`]).toString().trim();
  const a=revision(source,sourceRef), b=revision(destination,destinationRef);
  const shared=f=>/^(tests|automation|verification|experiments)\//.test(f)||['package.json','package-lock.json','tsconfig.json','playwright.config.ts'].includes(f);
  const paths=(root,rev,prefix='')=>git(root,['ls-tree','-r','--name-only',rev]).toString().trim().split('\n')
    .filter(f=>f.startsWith(prefix)).map(f=>f.slice(prefix.length)).filter(shared);
  const src=paths(source,a), dst=paths(destination,b,'projects/sp_ui_test/');
  const s=new Set(src),d=new Set(dst), differences=[];
  for(const file of new Set([...src,...dst])) {
    if(!s.has(file)||!d.has(file)){differences.push({file,reason:s.has(file)?'missing-in-copy':'copy-only'});continue;}
    if(!git(source,['show',`${a}:${file}`]).equals(git(destination,['show',`${b}:projects/sp_ui_test/${file}`])))differences.push({file,reason:'content-differs'});
  }
  return {sourceRevision:a,destinationRevision:b,compared:src.length,differences};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [source,destination,sourceRef,destinationRef]=process.argv.slice(2);
  if(!source||!destination)throw Error('用法：node automation/check-project-sync.mjs <原仓库> <合并仓库> [sourceRef] [destinationRef]');
  // 明确拒绝把私有配置当作参数文件；所有参数仅作git路径/revision，不执行shell。
  const result=checkProjectSync(source,destination,sourceRef,destinationRef);
  console.log(JSON.stringify(result,null,2));process.exitCode=result.differences.length?1:0;
}
