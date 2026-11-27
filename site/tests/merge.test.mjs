import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const sandbox={exports:{},console};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../dist/vendor/xlsx.full.min.js',import.meta.url),'utf8'),sandbox);const X=globalThis.XLSX=sandbox.exports;
const {getData,getMergeData,mergeTables,makeWorkbook}=await import('../dist/core.js');
function source(matrix,name='报表.xlsx'){const wb=X.utils.book_new();X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(matrix),'数据');return {wb,name,sheet:'数据',header:1,autoHeader:true};}
function roundtrip(data){const bytes=X.write(makeWorkbook(data),{type:'buffer',bookType:'xlsx'});const wb=X.read(bytes,{type:'buffer',cellNF:true});return {wb,rows:X.utils.sheet_to_json(wb.Sheets['数据'],{header:1,defval:'',raw:true})};}

// Reproduce the exact library error, then verify sanitized merging and export.
const unsafe=X.utils.book_new();X.utils.book_append_sheet(unsafe,X.utils.aoa_to_sheet([['日期'],[{t:'d',v:null}]],{cellDates:true}),'数据');assert.throws(()=>X.write(unsafe,{type:'buffer',bookType:'xlsx'}),/match/);
const invalidDate=vm.runInContext('new Date(NaN)',sandbox);
const repaired=mergeTables([{headers:['编号','日期','零','布尔'],rows:[['001',{t:'d',v:null},0,false],null,['002',invalidDate,0,false]],formats:[null,[null]]},{headers:['编号','日期','零','布尔'],rows:[['003',null,0,false]]}]);
assert.equal(repaired.rows.length,3);const safe=roundtrip(repaired);assert.equal(safe.rows[1][1],'');assert.equal(safe.rows[2][1],'');assert.equal(safe.rows[1][2],0);assert.equal(safe.rows[1][3],false);
const missingRef=source([['编号'],['001']]);missingRef.wb.Sheets['数据']['!ref']=null;assert.deepEqual(getData(missingRef).rows,[['001']]);

const a=source([
 ['营业明细表'],['制表日期：2026-11-27'],['编号','名称','数量','金额','单价','备注'],
 ['001','甲',2,100,50,''],['001','甲',2,100,50,''],['小计','',4,200,100,''],['制表人：张三'],['第1页 共2页'],
 ['营业明细表'],['制表日期：2026-11-27'],['编号','名称','数量','金额','单价','备注'],
 ['002','乙',3,75,25,'制表人：商品备注保留'],['合计','',7,275,125,''],['审核人：李四']
],'第一批.xlsx');
const b=source([
 ['营业明细表'],['金 额','名称','编\n号','数量','单价','备注'],
 [25,'丙','003',1,25,''],[25,'丙','003',1,25,''],[50,'','合计',2,50,''],['打印时间：2026-11-27'],['第2页 共2页']
],'第二批.xlsx');
const first=getMergeData(a),second=getMergeData(b);assert.equal(first.headerRow,3);assert.equal(second.headerRow,2);
const merged=mergeTables([first,second]);assert.deepEqual(merged.headers,['编号','名称','数量','金额','单价','备注']);
assert.equal(merged.mergeReport.dataRows,5);assert.equal(merged.rows.length,6);assert.deepEqual(merged.rows.at(-1),['合计','',9,325,'','']);assert.equal(merged.rows[2][5],'制表人：商品备注保留');
assert.deepEqual(merged.rows[0],merged.rows[1]);assert.deepEqual(merged.rows[3],merged.rows[4]);
assert.equal(merged.mergeReport.summariesRemoved,3);assert.equal(merged.mergeReport.footersRemoved,6);assert.equal(merged.mergeReport.headersRemoved,2);assert.equal(merged.mergeReport.files[0].header,3);
const exported=roundtrip(merged);assert.equal(exported.rows.length,7);assert.equal(exported.rows.at(-1)[3],325);assert.equal(exported.wb.Sheets['数据']['!autofilter'].ref,'A1:F6');
const raw=mergeTables([first,second],{clean:false});assert.ok(raw.rows.length>merged.rows.length);assert.equal(raw.summaryRowCount,0);assert.equal(raw.mergeReport.removedData.rows.length,0);
const detail=mergeTables([first,second],{totals:'none'});assert.equal(detail.rows.length,5);assert.equal(detail.summaryRowCount,0);

const multi=source([['工资报表'],['序号','人员信息','','绩效',''],['','姓名','部门','数量','金额'],[1,'张三','研发',2,60],[2,'李四','销售',3,90],['合计','','',5,150],['制表人：测试']]);
multi.wb.Sheets['数据']['!merges']=[{s:{r:1,c:0},e:{r:2,c:0}},{s:{r:1,c:1},e:{r:1,c:2}},{s:{r:1,c:3},e:{r:1,c:4}}];
const multiData=getMergeData(multi);assert.equal(multiData.headerRow,2);assert.deepEqual(multiData.headers,['序号','姓名','部门','数量','金额']);assert.equal(multiData.rows[0][1],'张三');
const multiResult=mergeTables([multiData,getMergeData(source([['序号','姓名','部门','数量','金额'],[3,'王五','研发',1,30],['合计','','',1,30]]))]);assert.equal(multiResult.mergeReport.dataRows,3);assert.deepEqual(multiResult.rows.at(-1),['合计','','',6,180]);

const names=mergeTables([{headers:['名称','编号','金额'],rows:[['合计',123,9],['制表人：业务记录','004',11]]},{headers:['名称','编号','金额'],rows:[['正常','005',0]]}]);assert.equal(names.rows.length,3);assert.equal(names.rows[0][0],'合计');
const ambiguous=mergeTables([{headers:['A','a'],rows:[[1,2]]},{headers:['A','a'],rows:[[3,4]]}]);assert.equal(ambiguous.headers.length,2);assert.deepEqual(ambiguous.rows,[[1,2],[3,4]]);
const tail=mergeTables([{headers:['编号','说明'],rows:[['A001','有效记录'],['以上信息已经相关单位确认无误','']]},{headers:['编号','说明'],rows:[['B002','有效记录'],['以上信息已经相关单位确认无误','']]}]);assert.equal(tail.rows.length,2);assert.equal(tail.mergeReport.footersRemoved,2);
const textRecords=mergeTables([{headers:['编号','说明'],rows:[['A001','首条'],['BETA','重复业务']]},{headers:['编号','说明'],rows:[['BETA','重复业务']]}]);assert.equal(textRecords.rows.length,3);
const uncached=source([['编号','金额'],['001',2],['002',3],['合计','']]);uncached.wb.Sheets['数据'].B4={t:'n',v:null,f:'SUM(B2:B3)'};const recomputed=mergeTables([getMergeData(uncached),getMergeData(source([['编号','金额'],['003',4]]))]);assert.deepEqual(recomputed.rows.at(-1),['合计',9]);
const rates=mergeTables([{headers:['编号','数量','比例','日期'],rows:[['001',0,.1,46350],['合计',0,.1,46350]],formats:[['','','0%','yyyy-mm-dd'],['','','0%','yyyy-mm-dd']]},{headers:['编号','数量','比例','日期'],rows:[['002',0,.2,46351],['合计',0,.2,46351]],formats:[['','','0%','yyyy-mm-dd'],['','','0%','yyyy-mm-dd']]}]);assert.deepEqual(rates.rows.at(-1),['合计',0,'','']);
console.log('PASS: exact null-date writer regression, repaired ranges, automatic/multilevel headers, reordered columns, repeated page structure, totals, preserved business duplicates, cleanup audit, raw/detail modes, protected identifiers/rates/dates and XLSX roundtrip.');
