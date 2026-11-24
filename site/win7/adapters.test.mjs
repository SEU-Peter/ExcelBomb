const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const base=process.env.EXCELBOMB_WIN7_TEST_URL||'http://127.0.0.1:18769/';
try{
 for(const blocked of [false,true]){
  const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{Object.defineProperty(document,'documentMode',{value:11});window.ExcelBombForceLegacyDOM=true;});
  if(blocked)await page.route('**/worker.js',route=>route.abort());
  await page.goto(base);await page.locator('[data-action=sample]').click();await page.locator('[data-action=extract]').click();await page.waitForFunction(()=>document.querySelector('#processing').hidden);
  assert.equal(await page.locator('[data-action=split-col]').count(),4);assert.equal(await page.evaluate(()=>window.ExcelBombWin7.processing),blocked?'兼容处理模式':'后台线程');
  await page.getByRole('button',{name:'使用说明',exact:true}).click();assert.equal(await page.locator('.guide-step').count(),3);await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').isVisible(),false);
  const saves=await page.evaluate(()=>{window.__saveCalls=[];Object.defineProperty(navigator,'msSaveOrOpenBlob',{configurable:true,value:function(blob,name){window.__saveCalls.push(['open',name,blob.size]);return true;}});Object.defineProperty(navigator,'msSaveBlob',{configurable:true,value:function(blob,name){window.__saveCalls.push(['save',name,blob.size]);return true;}});window.ExcelBombLegacySave(new Blob(['abc']),'中文文件.xlsx');Object.defineProperty(navigator,'msSaveOrOpenBlob',{configurable:true,value:undefined});window.ExcelBombLegacySave(new Blob(['abcd']),'blank.xlsx');return window.__saveCalls;});
  assert.deepEqual(saves,[['open','中文文件.xlsx',3],['save','blank.xlsx',4]]);
  const limit=await page.evaluate(()=>new Promise(resolve=>{const worker=window.ExcelBombLegacyCreateWorker();worker.onmessage=e=>{if(!e.data.progress){resolve(e.data.error);worker.terminate();}};worker.postMessage({id:9001,kind:'zip',payload:{groups:Array(501).fill({}),data:{headers:[],rows:[]}}});}));assert.ok(limit.includes('500'));
  assert.deepEqual(errors,[]);await page.close();
 }
 const unsupported=await browser.newPage();await unsupported.addInitScript(()=>Object.defineProperty(document,'documentMode',{value:9}));await unsupported.goto(base);assert.equal(await unsupported.locator('#unsupported-browser').isVisible(),true);assert.equal(await unsupported.locator('main').isVisible(),false);await unsupported.close();
 console.log('PASS: IE-style HTTP worker, blocked-worker recovery, modal ESC, both MS save APIs, ZIP file limit, unsupported-browser message');
}finally{await browser.close();}
