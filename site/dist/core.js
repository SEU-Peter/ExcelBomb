// Pure data operations, shared by the interface and regression checks.
export const display = v => v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}` : String(v ?? '');
export function uniqueHeaders(values) {
  const used = new Set();
  return values.map((value,i) => { const base=display(value).trim() || `未命名列 ${i+1}`;let name=base,n=2;while(used.has(name))name=`${base} (${n++})`;used.add(name);return name; });
}
export function getData(source) {
  if(!source) throw new Error('请先选择文件。');
  const sheet=source.wb.Sheets[source.sheet];
  if(!sheet?.['!ref']) throw new Error('这张工作表为空，请选择其他工作表。');
  const range=XLSX.utils.decode_range(sheet['!ref']);
  const header=Number(source.header);
  if(!Number.isInteger(header)||header<1||header>range.e.r+1)throw new Error(`表头行应为 1 到 ${range.e.r+1} 之间的整数。`);
  if(range.e.r-header+1>200000||range.e.c>=1000)throw new Error('当前版本支持每张表最多 20 万行、1000 列，请先缩小文件。');
  if((range.e.r-header+2)*(range.e.c+1)>5000000)throw new Error('工作表范围过大，超过 500 万个单元格。请分批处理，或删除多余的空白行列。');
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,range:{s:{r:header-1,c:0},e:range.e},defval:'',raw:true,blankrows:true});
  const width=range.e.c+1;
  const headers=uniqueHeaders(Array.from({length:width},(_,i)=>matrix[0]?.[i]??''));
  if(!matrix[0]?.some(v=>display(v).trim()))throw new Error('所选表头行为空，请调整表头所在行。');
  const rows=[],formats=[],rowNumbers=[];let protectedIdentifiers=0;
  matrix.slice(1).forEach((r,offset)=>{
    if(!r.some(v=>v!==''&&v!=null))return;
    const excelRow=header+offset;
    const row=Array.from({length:width},(_,i)=>r[i]??'');
    const rowFormats=Array.from({length:width},(_,i)=>{
      const cell=sheet[XLSX.utils.encode_cell({r:excelRow,c:i})];
      if(cell?.t==='n'&&Number.isInteger(cell.v)&&/^0{2,}(?:[- /]?0+)*$/.test(cell.z||'')){
        protectedIdentifiers++;
        if(source.preserveIdentifiers!==false){row[i]=XLSX.utils.format_cell(cell);return '@';}
      }
      return cell?.z||'';
    });
    rows.push(row);formats.push(rowFormats);rowNumbers.push(excelRow+1);
  });
  return {headers,rows,formats,rowNumbers,protectedIdentifiers};
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
export function mergeTables(tables) {
  if(tables.length<2)throw new Error('请至少添加两个文件。');
  const headers=[...new Set(tables.flatMap(t=>t.headers))];
  if(headers.length>16384)throw new Error('合并结果超过 Excel 单张工作表的列数上限。');
  const rows=[],formats=[];
  for(const t of tables){const indices=headers.map(h=>t.headers.indexOf(h));t.rows.forEach((r,row)=>{rows.push(indices.map(i=>i<0?'':r[i]));formats.push(indices.map(i=>i<0?'':t.formats?.[row]?.[i]||''));});}
  if(rows.length>1048575)throw new Error('合并结果超过 Excel 单张工作表的行数上限。');
  return {headers,rows,formats};
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
export function makeWorkbook(data){const wb=XLSX.utils.book_new();const ws=XLSX.utils.aoa_to_sheet([data.headers,...data.rows.map(row=>row.map(value=>value===''?null:value))],{cellDates:true});data.formats?.forEach((r,i)=>r.forEach((format,j)=>{const cell=ws[XLSX.utils.encode_cell({r:i+1,c:j})];if(format&&cell)cell.z=format;}));ws['!cols']=data.headers.map(h=>({wch:Math.max(14,Math.min(display(h).length*2+2,30))}));if(data.rows.length)ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:data.rows.length,c:data.headers.length-1}})};XLSX.utils.book_append_sheet(wb,ws,'数据');return wb;}
