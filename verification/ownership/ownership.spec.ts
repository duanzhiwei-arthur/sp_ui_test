import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { RunAssets, registerRunAssets } from '../../tests/fixtures/run-assets.js';
import { CreatePage } from '../../tests/pages/create.page.js';
import { CartDrawer } from '../../tests/pages/cart-drawer.page.js';

let server: Server, origin: string, deletes: string[], adds: number;
const stream = 'event: task_start\ndata: {"taskId":"task-new"}\n\nevent: asset_start\ndata: {"assetId":"asset-new"}\n\nevent: asset_done\ndata: {"assetId":"asset-new","extra":{"imageUrl":"https://fixture.invalid/new.png"}}\n\nevent: task_done\ndata: {"taskId":"task-new"}\n\n';
test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (req.method==='DELETE' && req.headers.referer?.includes('redirect-delete') && !url.pathname.endsWith('/old')) {deletes.push(url.pathname);res.writeHead(307,{Location:'/apps/ai/activity/assets/old'});res.end();return;}
    if (req.method === 'DELETE') { deletes.push(url.pathname); res.setHeader('Content-Type','application/json'); res.end('{"success":true}'); return; }
    if (url.pathname === '/apps/ai/activity/tasks') { res.setHeader('Content-Type','text/event-stream'); if(req.headers.referer?.includes('open-stream')){res.write(stream.replaceAll('\n','\r\n'));return;}res.end(stream); return; }
    if (url.pathname === '/cart/add.js' || url.pathname === '/cart.js') {
      if (req.method === 'POST') adds++;
      const wrong = req.headers.referer?.includes('wrong-cart');
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({items:[{key:'line-key',quantity:1,properties:{'_Record ID':wrong?'old':'asset-new'}}]}));return;
    }
    const wrongDelete=url.pathname==='/wrong-delete';
    res.setHeader('Content-Type','text/html');res.end(`<section><div>History (2)</div>
      <article><img src="https://fixture.invalid/old.png"><button aria-label="delete record">old</button></article>
      <article id="owned"><img src="https://fixture.invalid/new.png"><button aria-label="delete record" onclick="if(confirm('Delete this history record?'))fetch('/apps/ai/activity/assets/${wrongDelete?'old':'asset-new'}',{method:'DELETE'}).then(r=>{if(r.ok){document.querySelector('#owned').remove();document.querySelector('section div').textContent='History (1)'}}).catch(()=>{})">new</button></article></section>
      <button id="generate" onclick="fetch('/apps/ai/activity/tasks',{method:'POST'}).then(r=>r.text()).then(()=>document.querySelector('#state').textContent='generated')">Generate</button>
      <button id="add" onclick="fetch('/cart/add.js',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})">Add</button><p id="state"></p>`);
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r)); const address=server.address();
  if(!address||typeof address==='string')throw Error('server unavailable');origin=`http://127.0.0.1:${address.port}`;
});
test.beforeEach(()=>{deletes=[];adds=0;});
test.afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});

async function generate(page: import('@playwright/test').Page, pathname='/') {
  const tracker=new RunAssets(page);registerRunAssets(page,tracker);await tracker.install();
  await page.goto(origin+pathname);tracker.beginGeneration();await page.locator('#generate').click();
  await expect(page.locator('#state')).toHaveText('generated');tracker.endGenerationAction();
  await tracker.requireSingleAsset(2000);return tracker;
}

test('只从已授权生成响应建立本轮归属，报告不保存图片URL',async({page})=>{
  const tracker=await generate(page);
  try{expect(tracker.assets.has('asset-new')).toBe(true);const s=tracker.snapshot();expect(s.generationRequests).toHaveLength(1);expect(s.assets[0].taskId).toBe('task-new');expect(JSON.stringify(s)).not.toContain('https://fixture');}
  finally{await tracker.dispose();}
});
test('未点击生成及新会话不得继承旧资产',async({page})=>{
  const tracker=new RunAssets(page);await tracker.install();
  try{await page.goto(origin);await page.locator('#generate').click();await expect(page.locator('#state')).toHaveText('generated');expect(tracker.assets.size).toBe(0);await expect(tracker.authorizeDelete('asset-new')).rejects.toThrow(/拒绝删除/);expect(deletes).toEqual([]);}
  finally{await tracker.dispose();}
});
test('History顺序变化只删除本轮映射卡片，不删除第一条旧记录',async({page})=>{
  const tracker=await generate(page);try{await new CreatePage(page).deleteLatestHistoryRecord(1);expect(deletes).toEqual(['/apps/ai/activity/assets/asset-new']);expect(await page.locator('article').innerText()).toBe('old');expect(tracker.snapshot().assets[0].deleted).toBe(true);}finally{await tracker.dispose();}
});
test('出站DELETE与本轮授权不符时网络层阻止，旧资产未被删除',async({page})=>{
  const tracker=await generate(page,'/wrong-delete');try{await tracker.authorizeDelete('asset-new');const failed=await page.evaluate(()=>fetch('/apps/ai/activity/assets/old',{method:'DELETE'}).then(()=>false,()=>true));expect(failed).toBe(true);expect(tracker.wasDeleteBlocked()).toBe(true);expect(deletes).toEqual([]);}finally{await tracker.dispose();}
});
test('归属图片重复时不猜测卡片，不发送DELETE',async({page})=>{
  const tracker=await generate(page);try{await page.locator('article').first().locator('img').evaluate(e=>e.setAttribute('src','https://fixture.invalid/new.png'));await expect(new CreatePage(page).deleteLatestHistoryRecord(1)).rejects.toThrow(/History必须唯一/);expect(deletes).toEqual([]);}finally{await tracker.dispose();}
});
test('本轮资产加购响应与购物车GET一致才通过，POST只发一次',async({page})=>{
  const tracker=await generate(page);try{await new CartDrawer(page).addCurrentAsset(()=>page.locator('#add').click(),tracker);expect(adds).toBe(1);expect(tracker.snapshot().cartLines).toEqual([{assetId:'asset-new',key:'line-key'}]);}finally{await tracker.dispose();}
});
test('旧商品不能抵充本轮加购成功，不自动补发加购',async({page})=>{
  const tracker=await generate(page,'/wrong-cart');try{await expect(new CartDrawer(page).addCurrentAsset(()=>page.locator('#add').click(),tracker)).rejects.toThrow(/本轮Asset ID/);expect(adds).toBe(1);}finally{await tracker.dispose();}
});
test('加购后GET一次503只重查购物车，不重复POST加购',async({page})=>{
 const tracker=await generate(page);let reads=0;
 try{
  await page.route(origin+'/cart.js',route=>{
   reads++;return route.fulfill({status:reads===1?503:200,contentType:'application/json',body:JSON.stringify({items:[{key:'line-key',quantity:1,properties:{'_Record ID':'asset-new'}}]})});
  });
  await new CartDrawer(page).addCurrentAsset(()=>page.locator('#add').click(),tracker);
  expect(adds).toBe(1);expect(reads).toBe(2);expect(tracker.snapshot().cartLines).toHaveLength(1);
 }finally{await tracker.dispose();}
});
test('DELETE重定向不能重放到旧资产',async({page})=>{
 const tracker=await generate(page,'/redirect-delete');try{await tracker.authorizeDelete('asset-new');const failed=await page.evaluate(()=>fetch('/apps/ai/activity/assets/asset-new',{method:'DELETE'}).then(()=>false,()=>true));expect(failed).toBe(true);expect(deletes).toEqual(['/apps/ai/activity/assets/asset-new']);expect(tracker.wasDeleteBlocked()).toBe(true);}finally{await tracker.dispose();}
});
test('生成前上传异步延迟不丢失归属；只认点击后第一条生成POST',async({page})=>{
 const tracker=new RunAssets(page);await tracker.install();try{
  await page.goto(origin);tracker.beginGeneration();
  await page.evaluate(()=>{setTimeout(()=>fetch('/apps/ai/activity/tasks',{method:'POST'}),250);});
  await tracker.requireSingleAsset(2000);
  await page.evaluate(()=>fetch('/apps/ai/activity/tasks',{method:'POST'}).then(r=>r.text()));
  expect(tracker.snapshot().generationRequests).toHaveLength(1);
 }finally{await tracker.dispose();}
});
test('请求中断不阻塞页面操作，记录未完成而不猜后台已取消',async({page})=>{
 const tracker=new RunAssets(page);await tracker.install();try{
  await page.route('**/apps/ai/activity/tasks',route=>route.abort());
  await page.goto(origin);tracker.beginGeneration();await page.locator('#generate').click();
  await expect.poll(()=>tracker.snapshot().generationRequests.length).toBe(1);
  expect(tracker.snapshot().unfinishedRequests).toBe(1);expect(tracker.assets.size).toBe(0);
  expect(await page.locator('#add').isVisible()).toBe(true);
 }finally{await tracker.dispose();}
});
test('原实验fixture未启用资产审计时，Generate操作仍按原路径执行',async({page})=>{
 await page.goto(origin);await page.locator('#generate').evaluate(e=>{const d=document.createElement('div');d.id='jjb-create-canvas';e.before(d);d.append(e);});
 await new CreatePage(page).startGeneration();await expect(page.locator('#state')).toHaveText('generated');
});
test('SSE连接未关闭也能取得已到达的资产ID，不缓冲或重发生成',async({page})=>{
 const tracker=new RunAssets(page);await tracker.install();try{
  await page.goto(origin+'/open-stream');tracker.beginGeneration();await page.locator('#generate').click();
  const asset=await tracker.requireSingleAsset(3000);expect(asset.assetId).toBe('asset-new');expect(asset.terminal).toBe(true);
  expect(tracker.snapshot().unfinishedRequests).toBe(1);
 }finally{await tracker.dispose();}
});
