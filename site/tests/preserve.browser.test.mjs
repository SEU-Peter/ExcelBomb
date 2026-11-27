import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {X,formatFixture,kids,kid,text} from './format-fixture.mjs';import {readFormatSource} from '../dist/preserve.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'excelbomb-format-')),files=[];
for(let i=0;i<2;i++){const file=path.join(temp,`原格式-${i+1}.xlsx`);fs.writeFileSync(file,await formatFixture(i===1));files.push(file);}
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true,timezoneId:'Asia/Shanghai'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 if(process.env.EXCELBOMB_LEGACY_PROFILE==='1'){const {installLegacyProfile}=await import('../win7/test-profile.mjs');await installLegacyProfile(page);}
 const url=process.env.EXCELBOMB_TEST_URL||'http://127.0.0.1:8769/';if(url.startsWith('file:'))await context.setOffline(true);
 const idle=()=>page.waitForFunction(()=>document.querySelector('#processing').hidden),action=name=>page.locator(`[data-action="${name}"]`);
 await page.goto(url);await page.locator('#tab-merge').click();await page.locator('[data-upload=merge]').click();await page.locator('#file-picker').setInputFiles(files);await idle();assert.equal(await page.locator('[data-merge-style]').isChecked(),true);
 await page.locator('[data-bulk-header]').fill('2');await page.locator('[data-bulk-start]').fill('4');await action('merge-apply-all').click();
 assert.deepEqual(await page.locator('[data-data-start]').evaluateAll(nodes=>nodes.map(n=>n.value)),['4','4']);assert.equal(await page.locator('[data-merge-auto="0"]').isChecked(),false);
 await page.locator('[data-data-start="merge-1"]').fill('5');await page.locator('[data-data-start="merge-1"]').dispatchEvent('change');assert.equal(await page.locator('[data-data-start="merge-0"]').inputValue(),'4');
 await action('merge-preview').click();await idle();assert.ok((await page.locator('.merge-summary').innerText()).includes('3 条明细'));
 await page.locator('[data-data-start="merge-1"]').fill('4');await page.locator('[data-data-start="merge-1"]').dispatchEvent('change');await page.locator('[data-footer-note="1"]').selectOption('last');
 await action('merge-preview').click();await idle();assert.ok((await page.locator('.merge-summary').innerText()).includes('4 条明细'));assert.ok((await page.locator('.merge-summary').innerText()).includes('1 条备注'));
 const [download]=await Promise.all([page.waitForEvent('download'),action('download-merge').click()]);await idle();const bytes=fs.readFileSync(await download.path()),wb=X.read(bytes,{type:'buffer',cellNF:true});assert.equal(wb.Sheets['数据'].A1.v,'设备清单');assert.equal(wb.Sheets['数据'].A3.v,'001');assert.equal(wb.Sheets['数据'].D7.v,120);assert.equal(wb.Sheets['数据'].A8.v,'备注：本表为测试，金额含税。');assert.equal(wb.Sheets['数据'].A9,undefined);
 const format=await readFormatSource(bytes,'数据'),cell=kids(format.rows.get(1),'c')[0],style=kids(kid(format.styles,'cellXfs'))[Number(cell.attrs.s)],font=kids(kid(format.styles,'fonts'))[Number(style.attrs.fontId)];assert.equal(kid(font,'sz').attrs.val,'20');assert.equal(format.rows.get(3).attrs.ht,'31');assert.equal(format.cols[1].attrs.width,'25');
 assert.ok(format.merges.some(m=>X.utils.encode_range(m)==='A8:D8'));assert.equal(kid(format.sheet,'pageSetup').attrs.orientation,'landscape');
 // Replacing an unrelated split file must not expire an existing merge export.
 await page.locator('#tab-split').click();await action('sample').click();await action('sample').click();await page.locator('#tab-merge').click();const [again]=await Promise.all([page.waitForEvent('download'),action('download-merge').click()]);await idle();assert.equal(X.read(fs.readFileSync(await again.path()),{type:'buffer'}).Sheets['数据'].D7.v,120);
 for(const width of [1440,900,390]){await page.setViewportSize({width,height:1050});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.setViewportSize({width:1440,height:1050});await page.screenshot({path:'/tmp/excelbomb-format-settings.png',fullPage:true});assert.deepEqual(errors,[]);
 console.log('PASS: bulk header/data-start settings, individual override, last-row note, styled XLSX download, preserved title/font/row/column/merges/page layout, cached export survives unrelated changes, responsive and offline/legacy paths.');
}finally{await browser.close();fs.rmSync(temp,{recursive:true,force:true});}
