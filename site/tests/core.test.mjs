import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const sandbox={exports:{},console};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../dist/vendor/xlsx.full.min.js',import.meta.url),'utf8'),sandbox);globalThis.XLSX=sandbox.exports;
const {getData,splitData,mergeGroups,mergeTables,lookupTables,uniqueFilenames,uniqueHeaders,makeWorkbook,splitFilenames,groupData,subsetData}=await import('../dist/core.js');
function source(matrix,header=1){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(matrix),'Data');return {wb,sheet:'Data',header};}
const s=source([['说明'],['编号','部门','金额'],['001','产品',10],['002','设计',20],['003','产品',0],['004','',false],[],['005','设计',30]],2);
const d=getData(s);assert.equal(d.rows.length,5);assert.equal(d.rows[0][0],'001');assert.equal(d.rows[3][2],false);
const groups=splitData(d,1);assert.equal(groups.length,3);assert.equal(groups[0].items.length,2);assert.equal(groups[2].name,'空白');
const combined=mergeGroups(groups,[groups[0].id,groups[1].id],'新分组');assert.equal(combined.length,2);assert.deepEqual(combined[0].items.map(x=>x.index),[0,1,2,4]);
const merged=mergeTables([{headers:['编号','姓名'],rows:[['001','林']]},{headers:['城市','编号'],rows:[['上海','002']]}]);assert.deepEqual(merged.headers,['编号','姓名','城市']);assert.deepEqual(merged.rows,[['001','林',''],['002','','上海']]);
const main={headers:['编号'],rows:[['001'],['002'],['003'],[''],[123],['00123'],[' ABC ']]};const ref={headers:['ID','名称'],rows:[['001','首条'],['001','末条'],['002','乙'],['','不能匹配'],['123','数字文本'],['abc','大小写']]};
let result=lookupTables(main,ref,{mainKey:0,refKey:0,returns:[1],ignoreCase:true});assert.equal(result.matched,4);assert.equal(result.unmatched,3);assert.equal(result.duplicates,1);assert.equal(result.rows[0][1],'首条');assert.equal(result.rows[3][1],'');assert.equal(result.rows[5][1],'');assert.deepEqual(result.matchedRows,[true,true,false,false,true,false,true]);assert.equal(result.duplicateData.rows.length,2);
assert.equal(makeWorkbook(result).Sheets['数据'].B5,undefined);
result=lookupTables(main,ref,{mainKey:0,refKey:0,returns:[1],duplicate:'last'});assert.equal(result.rows[0][1],'末条');assert.throws(()=>lookupTables(main,ref,{mainKey:0,refKey:0,returns:[1],duplicate:'error'}),/重复/);
assert.throws(()=>lookupTables(main,ref,{mainKey:0,refKey:0,returns:[]}),/返回字段/);
assert.deepEqual(uniqueHeaders(['A','A','A (2)','']),['A','A (2)','A (2) (2)','未命名列 4']);
const names=uniqueFilenames(['设计/产品','设计\\产品','CON','a','A','']);assert.equal(new Set(names.map(n=>n.toLowerCase())).size,6);assert.equal(names[2],'_CON.xlsx');
// Real OOXML write/read verifies a genuine workbook and type preservation.
for(const g of groups){const wb=makeWorkbook({headers:d.headers,rows:g.items.map(x=>x.row)});const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b);const read=XLSX.read(bytes,{type:'buffer'});const back=getData({wb:read,sheet:'数据',header:1});assert.equal(back.rows.length,g.items.length);assert.deepEqual(JSON.parse(JSON.stringify(back.rows)),JSON.parse(JSON.stringify(g.items.map(x=>x.row))));}
assert.throws(()=>getData({...s,header:100}),/表头行/);assert.throws(()=>getData(source([[''],['data']],1)),/表头行为空/);
const padded=source([['编号','金额'],[1,12.5]]);padded.wb.Sheets.Data.A2.z='00000';padded.wb.Sheets.Data.B2.z='#,##0.00';
const protectedData=getData(padded);assert.equal(protectedData.rows[0][0],'00001');assert.equal(protectedData.rows[0][1],12.5);assert.equal(protectedData.protectedIdentifiers,1);assert.equal(getData({...padded,preserveIdentifiers:false}).rows[0][0],1);
const protectedWb=makeWorkbook(protectedData);assert.equal(protectedWb.Sheets['数据'].A2.t,'s');assert.equal(protectedWb.Sheets['数据'].B2.z,'#,##0.00');
assert.deepEqual(splitFilenames([{name:'一室',items:Array(23)},{name:'二室',items:Array(34)}]),['一室-23.xlsx','二室-34.xlsx']);
assert.deepEqual(splitFilenames([{name:'华东/一组',items:Array(2)},{name:'华东\\一组',items:Array(2)}]),['华东_一组-2.xlsx','华东_一组-2 (2).xlsx']);
const sparse=source([['字段'],['数据']]);sparse.wb.Sheets.Data['!ref']='A1:ZZ200000';assert.throws(()=>getData(sparse),/范围过大/);
const grouped=groupData(d,groups[0]);assert.deepEqual(grouped.rowNumbers,[3,5]);assert.equal(grouped.rows.length,2);assert.equal(subsetData(d,[3]).rows[0][2],false);
try{lookupTables(main,ref,{mainKey:0,refKey:0,returns:[1],duplicate:'error'});assert.fail('expected duplicate error');}catch(e){assert.equal(e.duplicateData.rows.length,2);assert.equal(e.duplicateData.rows[0][1],'待处理');}
console.log('PASS: headers, split/regroup, ordered merge, lookup blanks/status/duplicates, identifier formats, counted filenames, subsets, XLSX roundtrip');
