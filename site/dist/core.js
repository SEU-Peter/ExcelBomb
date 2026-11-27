// Pure data operations, shared by the interface and regression checks.
export const display = v => v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}` : String(v ?? '');
export function uniqueHeaders(values) {
  const used = new Set();
  return values.map((value,i) => { const base=display(value).trim() || `未命名列 ${i+1}`;let name=base,n=2;while(used.has(name))name=`${base} (${n++})`;used.add(name);return name; });
}
export const DATA_LIMITS={rows:200000,columns:1000,cells:5000000};
export function cleanValue(value,fallback='') {
  if(value==null)return '';
  if(Object.prototype.toString.call(value)==='[object Date]')return Number.isFinite(value.getTime())?value:fallback;
  if(typeof value==='number')return Number.isFinite(value)?value:fallback;
  if(typeof value==='string'||typeof value==='boolean')return value;
  // Never pass cell-like objects with a null date to the XLSX writer.
  if(typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'v'))return value.v==null?'':typeof value.v==='object'?fallback:cleanValue(value.v,fallback);
  return display(value);
}
function cleanFormat(format){return typeof format==='string'?format:typeof format==='number'?XLSX.SSF?._table?.[format]||'':'';}
function hasCellValue(cell) {
  if(!cell||cell.t==='z'||cell.t==='e'||cell.v==null)return false;
  return typeof cell.v!=='string'||cell.v.replace(/\u200b/g,'').trim()!=='';
}
export function getData(source) {
  if(!source) throw new Error('请先选择文件。');
  const sheet=source.wb.Sheets[source.sheet];
  if(!sheet) throw new Error('这张工作表为空，请选择其他工作表。');
  const header=Number(source.header);
  if(!Number.isInteger(header)||header<1)throw new Error('表头行必须是大于零的整数。');
  // !ref often includes a million formatted blank rows. Inspect stored values
  // before allocating arrays; skip empty rows even inside a sparse used range.
  const usedRows=new Set();let firstColumn=Infinity,lastColumn=-1,lastRow=-1;
  for(const address of Object.keys(sheet)){
    if(address[0]==='!'||!hasCellValue(sheet[address])||!/^[A-Z]+[1-9]\d*$/i.test(address))continue;
    const position=XLSX.utils.decode_cell(address);
    if(position.r>1048575||position.c>16383)continue;
    lastRow=Math.max(lastRow,position.r);
    if(position.r<header-1)continue;
    usedRows.add(position.r);firstColumn=Math.min(firstColumn,position.c);lastColumn=Math.max(lastColumn,position.c);
  }
  if(lastRow<0)throw new Error('这张工作表没有非空数据，请选择其他工作表。');
  if(header>lastRow+1)throw new Error(`表头行应为 1 到 ${lastRow+1} 之间的整数。`);
  if(!usedRows.has(header-1))throw new Error('所选表头行为空，请调整表头所在行。');
  const actualRows=[...usedRows].filter(r=>r>=header).sort((a,b)=>a-b),width=lastColumn-firstColumn+1;
  if(actualRows.length>DATA_LIMITS.rows||width>DATA_LIMITS.columns)throw new Error(`实际数据为 ${actualRows.length.toLocaleString()} 行、${width} 列，超过当前容量（${DATA_LIMITS.rows.toLocaleString()} 行、${DATA_LIMITS.columns} 列）。空白区域已自动忽略，请分批处理实际数据。`);
  if((actualRows.length+1)*width>DATA_LIMITS.cells)throw new Error(`实际非空行的数据区域超过 ${DATA_LIMITS.cells.toLocaleString()} 个单元格。空白区域已自动忽略，请将实际数据分批处理。`);
  if(typeof sheet['!ref']!=='string'||!sheet['!ref'])sheet['!ref']=XLSX.utils.encode_range({s:{r:header-1,c:firstColumn},e:{r:lastRow,c:lastColumn}});
  // Let SheetJS normalize cached values (especially dates/timezones), while
  // restricting conversion to one real row instead of the advertised !ref.
  const readRow=r=>{const values=XLSX.utils.sheet_to_json(sheet,{header:1,range:{s:{r,c:firstColumn},e:{r,c:lastColumn}},defval:'',raw:true,blankrows:true})[0]||[];return Array.from({length:width},(_,i)=>{const cell=sheet[XLSX.utils.encode_cell({r,c:firstColumn+i})];return cleanValue(values[i],typeof cell?.w==='string'?cell.w:'');});};
  const headers=uniqueHeaders(readRow(header-1));
  const rows=[],formats=[],rowNumbers=[];let protectedIdentifiers=0;
  actualRows.forEach(excelRow=>{
    const row=readRow(excelRow);
    const rowFormats=Array.from({length:width},(_,i)=>{
      const cell=sheet[XLSX.utils.encode_cell({r:excelRow,c:firstColumn+i})];
      if(cell?.t==='n'&&Number.isInteger(cell.v)&&/^0{2,}(?:[- /]?0+)*$/.test(cell.z||'')){
        protectedIdentifiers++;
        if(source.preserveIdentifiers!==false){row[i]=XLSX.utils.format_cell({...cell,w:undefined});return '@';}
      }
      return cleanFormat(cell?.z);
    });
    rows.push(row);formats.push(rowFormats);rowNumbers.push(excelRow+1);
  });
  return {headers,rows,formats,rowNumbers,protectedIdentifiers,headerRow:header,firstColumn};
}
export function splitData(data,column) {
  const map=new Map();
  data.rows.forEach((row,index)=>{const value=row[column];const key=value instanceof Date?`date:${value.getTime()}`:`${typeof value}:${value??''}`;if(!map.has(key))map.set(key,{id:`g${map.size}`,name:display(value)||'空白',items:[]});map.get(key).items.push({row,index});});
  return [...map.values()];
}
export function mergeGroups(groups,ids,name) {
  const selected=new Set(ids);const chosen=groups.filter(g=>selected.has(g.id));
  if(chosen.length<2)throw new Error('请至少选择两个分组。');
  const combined={id:chosen[0].id,name:name.trim()||'合并分组',items:chosen.flatMap(g=>g.items).sort((a,b)=>a.index-b.index)};
  const result=[];let inserted=false;
  for(const g of groups){if(selected.has(g.id)){if(!inserted){result.push(combined);inserted=true;}}else result.push(g);}
  return result;
}
function headerKey(value){return display(value).replace(/[！-～]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248)).replace(/[\s\u200b\ufeff]+/g,'').replace(/[:：]+$/,'').toLocaleLowerCase();}
function rowKey(row){return JSON.stringify(row.map(headerKey));}
const fieldLabel=/^(序号|编号|编码|代码|id|姓名|名称|人员|单位|部门|岗位|职务|日期|时间|金额|数量|单价|合价|总价|规格|型号|产品|商品|项目|地址|电话|手机|邮箱|备注|说明|城市|渠道|工时|补贴|人数|年龄|性别|.*(?:编号|编码|名称|日期|时间|金额|数量|姓名|电话|单位|部门)(?:[（(].*[)）])?)$/i;
function worksheetRows(sheet){
  const rows=new Map();
  for(const address of Object.keys(sheet||{})){
    const cell=sheet[address];if(address[0]==='!'||!hasCellValue(cell)||!/^[A-Z]+[1-9]\d*$/i.test(address))continue;
    const {r,c}=XLSX.utils.decode_cell(address);if(r<0||r>1048575||c<0||c>16383)continue;
    if(!rows.has(r))rows.set(r,new Map());rows.get(r).set(c,cell);
  }
  return [...rows].sort((a,b)=>a[0]-b[0]);
}
function findMergeHeader(source,rawRows){
  const sheet=source.wb.Sheets[source.sheet];let header=Number(source.header)||1;
  if(source.autoHeader!==false){
    let best=-Infinity;
    for(const [r,cells] of rawRows.slice(0,80)){
      const values=[...cells.values()].map(cell=>cleanValue(cell.v)),strings=values.filter(v=>typeof v==='string'),known=strings.filter(v=>fieldLabel.test(headerKey(v))).length;
      const score=values.length*3+known*8+strings.length/values.length*4-(values.length-strings.length)*5-strings.filter(v=>v.length>45).length*4;
      if(score>best){best=score;header=r+1;}
    }
  }
  let start=header-1,end=start;const merges=Array.isArray(sheet?.['!merges'])?sheet['!merges']:[];
  // Fold real merged header levels into a single output field row.
  for(let n=0;n<2;n++){
    const above=rawRows.find(([r])=>r===start-1);
    if(!above||above[1].size<2||!merges.some(m=>m.s.r===start-1&&(m.e.c>m.s.c||m.e.r>=start)))break;
    start--;
  }
  for(let n=0;n<2;n++){
    const below=rawRows.find(([r])=>r===end+1);
    if(!below||!merges.some(m=>m.s.r<=end&&m.e.r>=end&&m.e.c>m.s.c))break;
    const values=[...below[1].values()].map(c=>cleanValue(c.v));
    if(values.filter(v=>typeof v==='string'&&fieldLabel.test(headerKey(v))).length<2)break;
    end++;
  }
  return {header:start+1,depth:end-start+1};
}
export function detectMergeHeader(source){return findMergeHeader(source,worksheetRows(source.wb.Sheets[source.sheet]));}
export function getMergeData(source){
  const sheet=source.wb.Sheets[source.sheet],rawRows=worksheetRows(sheet),found=findMergeHeader(source,rawRows);
  const data=getData({...source,header:found.header}),width=data.headers.length,first=data.firstColumn,merges=Array.isArray(sheet['!merges'])?sheet['!merges']:[];
  const rawVector=r=>Array.from({length:width},(_,j)=>cleanValue(sheet[XLSX.utils.encode_cell({r,c:first+j})]?.v));
  const labelAt=(r,c)=>{let cell=sheet[XLSX.utils.encode_cell({r,c})];if(!hasCellValue(cell)){const m=merges.find(m=>m.s.r<=r&&m.e.r>=r&&m.s.c<=c&&m.e.c>=c);if(m)cell=sheet[XLSX.utils.encode_cell(m.s)];}return display(cleanValue(cell?.v)).trim();};
  const levels=Array.from({length:width},(_,j)=>Array.from({length:found.depth},(_,i)=>labelAt(found.header-1+i,first+j)).filter((v,i,a)=>v&&a.indexOf(v)===i));
  const leaves=levels.map(a=>a[a.length-1]||''),counts=new Map();leaves.forEach(v=>counts.set(headerKey(v),(counts.get(headerKey(v))||0)+1));
  data.headers=uniqueHeaders(levels.map((a,i)=>counts.get(headerKey(leaves[i]))>1?a.join(' / '):leaves[i]));
  const indices=data.rowNumbers.map((r,i)=>({r,i})).filter(({r})=>r>=found.header+found.depth);
  const rows=indices.map(({i})=>data.rows[i]),formats=indices.map(({i})=>data.formats[i]),rowNumbers=indices.map(({r})=>r);
  const formulas={};indices.forEach(({r},i)=>{if(summaryLabel(rows[i],data.headers))formulas[i]=Array.from({length:width},(_,j)=>{const value=sheet[XLSX.utils.encode_cell({r:r-1,c:first+j})]?.f;return typeof value==='string'?value:'';});});
  return {...data,rows,formats,rowNumbers,repairedDates:source.repairedDates||0,sourceName:source.name||source.sheet,mergeContext:{header:found.header,depth:found.depth,headers:Array.from({length:found.depth},(_,i)=>rawVector(found.header-1+i)),prefix:rawRows.filter(([r])=>r<found.header-1).map(([r])=>rawVector(r)),formulas}};
}
function summaryLabel(row,headers=[]){
  if(!Array.isArray(row))return null;
  const index=row.findIndex(v=>/^(?:(?:本页|本表|本期|本月|本次|本组|部门|分项|分类|全表|全部))?(?:小计|合计|共计|总计|累计|汇总|总合计|总额|总数)(?:[（(].*[)）])?$/.test(headerKey(v)));if(index<0)return null;
  if(row.some((v,c)=>c!==index&&headerKey(v)&&/序号|编号|编码|代码|身份证|账号|^id$/i.test(headerKey(headers[c]))))return null;
  const first=row.findIndex(v=>headerKey(v)!=='');
  if(first!==index&&row.some((v,c)=>c!==index&&headerKey(v)&&numericValue(v)===null))return null;
  return {index,label:display(row[index])};
}
function footerLabel(row,headers=[]){
  const cells=row.map(v=>display(v).trim()).filter(Boolean);if(!cells.length)return false;
  const firstIndex=row.findIndex(v=>headerKey(v));
  if(row.some((v,c)=>c!==firstIndex&&headerKey(v)&&/序号|编号|编码|代码|身份证|账号|^id$/i.test(headerKey(headers[c]))))return false;
  const joined=cells.join(' '),first=cells[0];
  if(/^(?:第\s*\d+\s*页|页(?:码|次)\s*[:：]|共\s*\d+\s*页)/.test(first)||/^(?:本页)?共(?:计)?\s*\d+\s*(?:条|行|笔|份)(?:记录|数据)?[。.]?$/.test(first)||/^page\s+\d+(?:\s+(?:of|\/)\s+\d+)?$/i.test(joined))return true;
  return (cells.length<=4||(cells.length<=8&&!row.some(v=>typeof v==='number')))&&/^(?:(?:制表人?|填表人?|填报人?|编制人?|审核人?|复核人?|审批人?|负责人|经办人|统计人|报送单位|制表单位|签字|盖章|打印人|打印时间|打印日期|生成时间|导出时间|制表日期|填报日期|填表日期|报送日期|数据来源)(?:\s*[:：]|$)|(?:备注|附注|注|说明|提示|声明)\s*[:：]|本(?:表|报告).*(?:仅供|供内部|统计口径|数据说明))/.test(first);
}
function numericValue(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value!=='string')return null;const text=value.trim();
  if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)||/^[+-]?0\d/.test(text))return null;
  const number=Number(text.replace(/,/g,''));return Number.isFinite(number)?number:null;
}
function sumColumn(rows,column){let total=0,correction=0,count=0;for(const row of rows){const number=numericValue(row[column]);if(number===null)continue;const value=number-correction,next=total+value;correction=(next-total)-value;total=next;count++;}return {value:Number(total.toPrecision(15)),count};}
function maySum(header,formats,column){
  if(/序号|编号|编码|代码|证件|身份证|电话|手机|邮编|账号|日期|时间|单价|均价|平均|比例|占比|百分比|税率|利率|增长率|余额|年份|年度|^(?:id|code|phone|date|time)$/i.test(headerKey(header)))return false;
  return !formats.some(row=>{const f=cleanFormat(row?.[column]);return /%/.test(f)||(f&&XLSX.SSF.is_date(f));});
}
export function mergeTables(tables,{clean=true,totals='auto'}={}) {
  if(!Array.isArray(tables)||tables.length<2)throw new Error('请至少添加两个文件。');
  const headers=[],keys=new Map();
  const prepared=tables.map((table,index)=>{
    if(!Array.isArray(table?.headers)||!table.headers.length)throw new Error(`第 ${index+1} 份表格没有可用表头。`);
    const localHeaders=uniqueHeaders(table.headers),occurrences=new Map(),mapping=localHeaders.map(h=>{const base=headerKey(h),n=(occurrences.get(base)||0)+1;occurrences.set(base,n);const key=n===1?base:`${base}::${n}`;if(!keys.has(key)){keys.set(key,headers.length);headers.push(h);}return keys.get(key);});
    const entries=[];(Array.isArray(table.rows)?table.rows:[]).forEach((row,i)=>{if(!Array.isArray(row))return;const values=Array.from({length:localHeaders.length},(_,c)=>cleanValue(row[c]));if(!values.some(v=>headerKey(v)))return;entries.push({values,formats:localHeaders.map((_,c)=>cleanFormat(table.formats?.[i]?.[c])),number:table.rowNumbers?.[i]??i+2,original:i});});
    const headerRows=[localHeaders,...(table.mergeContext?.headers||[])],headerSet=new Set(headerRows.map(rowKey)),prefix=new Set((table.mergeContext?.prefix||[]).map(rowKey));
    return {table,localHeaders,mapping,entries,headerSet,prefix,name:table.sourceName||`文件 ${index+1}`};
  });
  if(headers.length>16384)throw new Error('合并结果超过 Excel 单张工作表的列数上限。');
  // Repeated free-form tail notes are removable only after the last identifiable
  // business record. Repeated business rows themselves are never deduplicated.
  const tailCounts=new Map();
  for(const p of prepared){
    const ids=p.localHeaders.map((h,c)=>/序号|编号|编码|代码|身份证|账号|^id$/i.test(headerKey(h))?c:-1).filter(c=>c>=0);p.tailCandidates=new Set();let lastRecord=-1;
    if(ids.length)for(let i=0;i<p.entries.length;i++){const row=p.entries[i].values;if(p.headerSet.has(rowKey(row))||summaryLabel(row,p.localHeaders)||footerLabel(row,p.localHeaders))continue;if(ids.some(c=>{const value=display(row[c]).trim();return value&&(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)||value.length<=6||row.filter(v=>headerKey(v)).length>=3);}))lastRecord=i;}
    if(lastRecord>=0)for(let i=lastRecord+1;i<p.entries.length;i++){const values=p.entries[i].values.filter(v=>headerKey(v));if(values.length&&values.length<=3&&values.every(v=>typeof v==='string')){const key=rowKey(p.entries[i].values);p.tailCandidates.add(i);tailCounts.set(key,(tailCounts.get(key)||0)+1);}}
  }
  const rows=[],formats=[],removed=[],files=[],sumColumns=new Set();let totalLabel=0;
  for(const p of prepared){
    const kept=[],summaries=[];let segmentStart=0;const stats={name:p.name,header:p.table.mergeContext?.header||p.table.headerRow||1,headers:0,footers:0,summaries:0,input:p.entries.length,kept:0};
    const kinds=p.entries.map(e=>p.headerSet.has(rowKey(e.values))?'header':summaryLabel(e.values,p.localHeaders)?'summary':footerLabel(e.values,p.localHeaders)?'footer':'');
    for(let i=0;i<p.entries.length;i++){
      const entry=p.entries[i],summary=summaryLabel(entry.values,p.localHeaders);let kind=clean?kinds[i]:'';
      if(clean&&!kind&&p.prefix.has(rowKey(entry.values))){for(let j=i+1;j<Math.min(i+9,p.entries.length);j++){if(kinds[j]==='header'){kind='header';break;}if(kinds[j]!=='footer'&&!p.prefix.has(rowKey(p.entries[j].values)))break;}}
      if(clean&&!kind&&p.tailCandidates.has(i)&&(tailCounts.get(rowKey(entry.values))||0)>1)kind='footer';
      if(kind){
        stats[kind==='header'?'headers':kind==='footer'?'footers':'summaries']++;
        removed.push({p,entry,reason:kind==='header'?'重复表头 / 页眉':kind==='footer'?'页脚 / 说明':'原表合计 / 小计'});
        if(kind==='summary'){summaries.push({entry,summary,before:kept.length,segmentStart});segmentStart=kept.length;}
      }else kept.push(entry);
    }
    const numericCache=new Map(),formatCache=new Map(),keptFormats=kept.map(e=>e.formats);
    const prefix=c=>{if(!numericCache.has(c)){const values=[0],counts=[0];let sum=0,correction=0,count=0;for(const entry of kept){const number=numericValue(entry.values[c]);if(number!==null){const v=number-correction,next=sum+v;correction=(next-sum)-v;sum=next;count++;}values.push(sum);counts.push(count);}numericCache.set(c,{values,counts});}return numericCache.get(c);};
    if(clean&&totals==='auto')for(const record of summaries){
      totalLabel=p.mapping[record.summary.index];
      for(let c=0;c<p.localHeaders.length;c++){
        const formula=p.table.mergeContext?.formulas?.[record.entry.original]?.[c];
        const explicit=typeof formula==='string'&&/^(?:=?\s*SUM\s*\(|=?\s*SUBTOTAL\s*\(\s*(?:9|109)\s*[,;])/i.test(formula);
        const expected=numericValue(record.entry.values[c]);if(expected===null&&!explicit)continue;if(!formatCache.has(c))formatCache.set(c,maySum(p.localHeaders[c],keptFormats,c));if(!formatCache.get(c))continue;
        const sums=prefix(c),all={value:sums.values[record.before],count:sums.counts[record.before]},part={value:sums.values[record.before]-sums.values[record.segmentStart],count:sums.counts[record.before]-sums.counts[record.segmentStart]};
        const close=sum=>expected!==null&&sum.count>0&&Math.abs(sum.value-expected)<=Math.max(1e-8,Math.abs(expected)*1e-9);
        if((explicit&&(all.count||part.count))||close(all)||close(part))sumColumns.add(p.mapping[c]);
      }
    }
    for(const entry of kept){const row=Array(headers.length).fill(''),format=Array(headers.length).fill('');p.mapping.forEach((target,c)=>{row[target]=entry.values[c];format[target]=entry.formats[c];});rows.push(row);formats.push(format);}
    stats.kept=kept.length;files.push(stats);
  }
  const dataRows=rows.length;let summaryRowCount=0;
  if(clean&&totals==='auto'&&sumColumns.size&&dataRows){
    const summary=Array(headers.length).fill(''),format=Array(headers.length).fill('');
    if(sumColumns.has(totalLabel))totalLabel=headers.findIndex((_,c)=>!sumColumns.has(c));if(totalLabel<0)totalLabel=0;
    summary[totalLabel]='合计';for(const column of sumColumns){if(column===totalLabel)continue;summary[column]=sumColumn(rows,column).value;format[column]=formats.find(r=>r[column])?.[column]||'';}
    rows.push(summary);formats.push(format);summaryRowCount=1;
  }
  if(rows.length>1048575)throw new Error('合并结果超过 Excel 单张工作表的行数上限。');
  const removedData={headers:uniqueHeaders(['来源文件','原始行号','清理原因',...headers]),rows:[],formats:[]};
  for(const item of removed){const row=Array(headers.length).fill(''),format=Array(headers.length).fill('');item.p.mapping.forEach((target,c)=>{row[target]=item.entry.values[c];format[target]=item.entry.formats[c];});removedData.rows.push([item.p.name,item.entry.number,item.reason,...row]);removedData.formats.push(['','','',...format]);}
  return {headers,rows,formats,summaryRowCount,mergeReport:{clean,dataRows,summaryRowCount,repairedDates:prepared.reduce((s,p)=>s+(p.table.repairedDates||0),0),sumColumns:[...sumColumns].map(c=>headers[c]),headersRemoved:files.reduce((s,f)=>s+f.headers,0),footersRemoved:files.reduce((s,f)=>s+f.footers,0),summariesRemoved:files.reduce((s,f)=>s+f.summaries,0),files,removedData}};
}
export function lookupTables(main,reference,{mainKey,refKey,returns,trim=true,ignoreCase=false,duplicate='first',missing=''}) {
  if(!returns.length)throw new Error('请至少选择一个返回字段。');
  const normalize=v=>{let s=v instanceof Date?`date:${v.getTime()}`:String(v??'');if(trim)s=s.trim();return ignoreCase?s.toLocaleLowerCase():s;};
  const map=new Map(),occurrences=new Map();let duplicates=0;
  reference.rows.forEach((r,index)=>{const key=normalize(r[refKey]);if(!key)return;if(!occurrences.has(key))occurrences.set(key,[]);occurrences.get(key).push(index);if(map.has(key)){duplicates++;if(duplicate!=='last')return;}map.set(key,index);});
  const duplicateRows=[],duplicateFormats=[];
  for(const [key,indices] of occurrences){if(indices.length<2)continue;for(const index of indices){duplicateRows.push([reference.rowNumbers?.[index]??index+2,duplicate==='error'?'待处理':map.get(key)===index?'已采用':'未采用',...reference.rows[index]]);duplicateFormats.push(['','',...(reference.formats?.[index]||[])]);}}
  const duplicateData={headers:uniqueHeaders(['参照表行号','处理情况',...reference.headers]),rows:duplicateRows,formats:duplicateFormats};
  if(duplicate==='error'&&duplicates){const error=new Error(`参照表有 ${duplicates} 条重复匹配记录，请查看重复值并调整处理方式。`);error.duplicateData=duplicateData;throw error;}
  let matched=0;
  const matchedRows=[],formats=[];
  const rows=main.rows.map((r,rowIndex)=>{const k=normalize(r[mainKey]);const index=k?map.get(k):undefined;const found=index!==undefined;if(found)matched++;matchedRows.push(found);formats.push([...(main.formats?.[rowIndex]||main.headers.map(()=>'')),...returns.map(i=>found?reference.formats?.[index]?.[i]||'':'')]);return [...r,...returns.map(i=>found?reference.rows[index][i]:missing)];});
  return {headers:uniqueHeaders([...main.headers,...returns.map(i=>`${reference.headers[i]}（匹配）`)]),rows,formats,rowNumbers:main.rowNumbers,matchedRows,matched,unmatched:main.rows.length-matched,duplicates,duplicateData};
}
export function safeFilename(name){const clean=String(name).trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,100)||'未命名';return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(clean)?`_${clean}`:clean;}
export function uniqueFilenames(names){const used=new Set();return names.map(n=>{const base=safeFilename(n);let s=base,i=2;while(used.has(s.toLocaleLowerCase()))s=`${base} (${i++})`;used.add(s.toLocaleLowerCase());return `${s}.xlsx`;});}
export function splitFilenames(groups){return uniqueFilenames(groups.map(g=>`${safeFilename(g.name).slice(0,85)}-${g.items.length}`));}
export function groupData(data,group){return {headers:data.headers,rows:group.items.map(x=>x.row),formats:group.items.map(x=>data.formats?.[x.index]||[]),rowNumbers:group.items.map(x=>data.rowNumbers?.[x.index]??x.index+2)};}
export function subsetData(data,indices){return {...data,rows:indices.map(i=>data.rows[i]),formats:indices.map(i=>data.formats?.[i]||[]),rowNumbers:indices.map(i=>data.rowNumbers?.[i]??i+1)};}
export function makeWorkbook(data){
  if(!data||!Array.isArray(data.headers)||!data.headers.length)throw new Error('没有可导出的表格字段。');
  const rows=Array.isArray(data.rows)?data.rows:[],values=rows.map(row=>Array.from({length:data.headers.length},(_,i)=>{const v=cleanValue(Array.isArray(row)?row[i]:null);return v===''?null:v;}));
  const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet([data.headers.map(v=>cleanValue(v)),...values],{cellDates:true});
  if(Array.isArray(data.formats))data.formats.forEach((row,i)=>{if(!Array.isArray(row))return;row.forEach((format,j)=>{const cell=ws[XLSX.utils.encode_cell({r:i+1,c:j})],safe=cleanFormat(format);if(safe&&cell)cell.z=safe;});});
  ws['!cols']=data.headers.map(h=>({wch:Math.max(14,Math.min(display(h).length*2+2,30))}));
  const filteredRows=rows.length-(data.summaryRowCount||0);
  if(filteredRows>0)ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:filteredRows,c:data.headers.length-1}})};
  XLSX.utils.book_append_sheet(wb,ws,'数据');return wb;
}
