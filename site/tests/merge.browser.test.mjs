const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const x={exports:{},console};vm.createContext(x);vm.runInContext(fs.readFileSync(new URL('../dist/vendor/xlsx.full.min.js',import.meta.url),'utf8'),x);const X=x.exports;
const z={module:{exports:{}},exports:{},require:createRequire(import.meta.url),Buffer,setTimeout,setImmediate,clearTimeout,console};vm.createContext(z);vm.runInContext(fs.readFileSync(new URL('../dist/vendor/jszip.min.js',import.meta.url),'utf8'),z);const Zip=z.module.exports;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'excelbomb-merge-'));
function fixture(name,matrix,dates=[]){const wb=X.utils.book_new(),sheet=X.utils.aoa_to_sheet(matrix);for(const address of dates)sheet[address].z='yyyy-mm-dd hh:mm:ss';X.utils.book_append_sheet(wb,sheet,'报表');const file=path.join(temp,name);fs.writeFileSync(file,X.write(wb,{type:'buffer',bookType:'xlsx'}));return file;}
const a=fixture('第一批报表.xlsx',[
 ['营业明细表'],['制表日期：2026-11-27'],['编号','名称','数量','金额','单价','日期','备注'],
 ['001','甲',2,100,50,46350.5,''],['001','甲',2,100,50,46350.5,''],['小计','',4,200,100,'',''],['制表人：张三'],['第1页 共2页'],
 ['营业明细表'],['制表日期：2026-11-27'],['编号','名称','数量','金额','单价','日期','备注'],
 ['002','乙',3,75,25,46350.5,'制表人：商品备注保留'],['合计','',7,275,125,'',''],['审核人：李四']
],['F4','F5','F12']);
// A real blank cached date cell, as emitted by some reporting software.
const zipped=await Zip.loadAsync(fs.readFileSync(a));let xml=await zipped.file('xl/worksheets/sheet1.xml').async('string');xml=xml.replace(/<c\b[^>]*r="F12"[^>]*>[\s\S]*?<\/c>/,'<c r="F12" t="d"></c>');zipped.file('xl/worksheets/sheet1.xml',xml);fs.writeFileSync(a,await zipped.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
const b=fixture('第二批报表.xlsx',[
 ['营业明细表'],['金 额','名称','编\n号','数量','单价','日期','备注'],
 [25,'丙','003',1,25,46351,''],[25,'丙','003',1,25,46351,''],[50,'','合计',2,50,'',''],['打印时间：2026-11-27'],['第2页 共2页']
],['F3','F4']);
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true,timezoneId:'Asia/Shanghai'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 if(process.env.EXCELBOMB_LEGACY_PROFILE==='1'){const {installLegacyProfile}=await import('../win7/test-profile.mjs');await installLegacyProfile(page);}
 const url=process.env.EXCELBOMB_TEST_URL||'http://127.0.0.1:8769/';if(url.startsWith('file:'))await context.setOffline(true);
 const idle=()=>page.waitForFunction(()=>document.querySelector('#processing').hidden),action=name=>page.locator(`[data-action="${name}"]`);
 await page.goto(url);await page.waitForFunction(()=>document.querySelector('#tab-merge'));await page.locator('#tab-merge').click();await page.locator('[data-upload=merge]').click();await page.locator('#file-picker').setInputFiles([a,b]);await idle();
 assert.equal(await page.locator('[data-header="merge-0"]').inputValue(),'3');assert.equal(await page.locator('[data-header="merge-1"]').inputValue(),'2');assert.equal(await page.locator('[data-merge-clean]').isChecked(),true);
 await action('merge-preview').click();await idle();assert.ok((await page.locator('.merge-summary').innerText()).includes('已合并 5 条明细'));assert.equal(await page.locator('.preview-panel tbody tr').count(),6);
 assert.ok((await page.locator('.preview-panel tbody').innerText()).includes('制表人：商品备注保留'));assert.ok((await page.locator('.preview-panel tbody tr').last().innerText()).includes('325'));
 const [download]=await Promise.all([page.waitForEvent('download'),action('download-merge').click()]);await idle();const result=X.read(fs.readFileSync(await download.path()),{type:'buffer',cellNF:true});const sheet=result.Sheets['数据'],rows=X.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});
 assert.equal(rows.length,7);assert.deepEqual(rows[1],rows[2]);assert.deepEqual(rows[4],rows[5]);assert.equal(rows[6][2],9);assert.equal(rows[6][3],325);assert.equal(rows[6][4],'');assert.equal(rows[6][5],'');assert.equal(sheet.F2.v,46350.5);assert.equal(sheet.F2.z,'yyyy-mm-dd hh:mm:ss');assert.equal(sheet.F4,undefined);assert.equal(sheet['!autofilter'].ref,'A1:G6');
 await action('view-merge-cleaned').click();assert.equal(await page.locator('dialog tbody tr').count(),11);assert.ok((await page.locator('dialog tbody').innerText()).includes('第一批报表.xlsx'));await page.locator('[aria-label="关闭数据预览"]').click();
 await page.locator('[data-header="merge-0"]').fill('3');await page.locator('[data-header="merge-0"]').dispatchEvent('change');assert.equal(await page.locator('[data-merge-auto="0"]').isChecked(),false);await page.locator('[data-merge-auto="0"]').check();await idle();
 await page.locator('[data-merge-totals]').selectOption('none');await action('merge-preview').click();await idle();assert.equal(await page.locator('.preview-panel tbody tr').count(),5);
 await page.locator('[data-merge-clean]').uncheck();await action('merge-preview').click();await idle();assert.equal(await page.locator('.preview-panel tbody tr').count(),16);assert.ok((await page.locator('.preview-panel tbody').innerText()).includes('第1页'));
 await page.locator('[data-merge-clean]').check();await page.locator('[data-merge-totals]').selectOption('auto');await action('merge-preview').click();await idle();
 for(const width of [1440,900,390]){await page.setViewportSize({width,height:1050});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:1440,height:1050});await page.screenshot({path:'/tmp/excelbomb-merge-cleaned.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS: real XLSX auto headers, empty-date input, repeated page cleanup, recomputed total, retained duplicates/notes/date formats, downloaded bytes, audit rows, manual header override, raw/detail modes and responsive UI.');
}finally{await browser.close();fs.rmSync(temp,{recursive:true,force:true});}
