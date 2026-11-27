// XLSX format-preserving merge. XML styles are copied, not re-created by SheetJS.
// Kept independent of DOMParser so IE11 Workers and the no-Worker path agree.
import {makeWorkbook,cleanValue,display} from './core.js';
const xmlDecode=s=>String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>v[0]==='#'?String.fromCodePoint(parseInt(v.slice(v[1].toLowerCase()==='x'?2:1),v[1].toLowerCase()==='x'?16:10)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[v]||_));
const xmlEscape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const localName=n=>n.name.split(':').pop();
const element=(name,attrs={},children=[])=>({name,attrs,children});
const cloneXML=n=>typeof n==='string'?n:{name:n.name,attrs:{...n.attrs},children:n.children.map(cloneXML)};
const children=(n,name)=>n?.children.filter(c=>typeof c!=='string'&&(!name||localName(c)===name))||[];
const child=(n,name)=>children(n,name)[0];
const textXML=n=>n?.children.map(c=>typeof c==='string'?c:textXML(c)).join('')||'';
function descend(n,fn){if(!n||typeof n==='string')return;fn(n);children(n).forEach(c=>descend(c,fn));}
export function parseXML(xml){
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('不支持含外部实体的 XML。');
  const root=element('_'),stack=[root],tokens=xml.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>|[^<]+/g)||[];
  for(const token of tokens){
    if(token.startsWith('<?')||token.startsWith('<!--'))continue;
    if(token.startsWith('<![CDATA[')){stack[stack.length-1].children.push(token.slice(9,-3));continue;}
    if(token.startsWith('</')){if(stack.length<2||stack.pop().name!==token.slice(2,-1).trim())throw new Error('XML 结构损坏。');continue;}
    if(token[0]==='<'){
      const match=token.match(/^<([^\s/>]+)/);if(!match)throw new Error('XML 节点无效。');
      const attrs={};token.slice(match[0].length).replace(/([^\s=/>]+)\s*=\s*("[^"]*"|'[^']*')/g,(_,k,v)=>{attrs[k]=xmlDecode(v.slice(1,-1));return _;});
      const n=element(match[1],attrs);stack[stack.length-1].children.push(n);if(!/\/\s*>$/.test(token))stack.push(n);
    }else stack[stack.length-1].children.push(xmlDecode(token));
  }
  if(stack.length!==1)throw new Error('XML 节点未闭合。');return children(root)[0];
}
export function writeXML(n){if(typeof n==='string')return xmlEscape(n);const attrs=Object.keys(n.attrs).map(k=>` ${k}="${xmlEscape(n.attrs[k])}"`).join('');return n.children.length?`<${n.name}${attrs}>${n.children.map(writeXML).join('')}</${n.name}>`:`<${n.name}${attrs}/>`;}
const documentXML=n=>'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+writeXML(n);
function partPath(base,target){if(target[0]==='/')return target.slice(1);const parts=base.split('/').slice(0,-1);for(const p of target.split('/')){if(p==='..')parts.pop();else if(p!=='.'&&p)parts.push(p);}return parts.join('/');}
async function xmlPart(zip,path,required=true){const file=zip.file(path);if(!file){if(required)throw new Error(`XLSX 缺少 ${path}`);return null;}const root=parseXML(await file.async('string')),prefix=root.name.includes(':')?root.name.split(':')[0]+':':'',ns=root.attrs[prefix?'xmlns:'+prefix.slice(0,-1):'xmlns'];if(/(?:spreadsheetml\/2006\/main|ooxml\/spreadsheetml\/main)$/.test(ns||'')){descend(root,n=>{if(!prefix||n.name.startsWith(prefix))n.name=n.name.slice(prefix.length);});root.attrs.xmlns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';}return root;}
function section(root,name){let n=child(root,name);if(!n){n=element(name);root.children.push(n);}return n;}
function replaceSection(root,name,n){root.children=root.children.filter(c=>typeof c==='string'||localName(c)!==name);if(n)root.children.push(n);}
function styleChildren(root,name){return children(child(root,name));}
const cellPosition=address=>XLSX.utils.decode_cell(address.replace(/\$/g,''));
const addressAt=(row,col)=>XLSX.utils.encode_cell({r:row-1,c:col});
function themePalette(theme){
  let scheme;descend(theme,n=>{if(localName(n)==='clrScheme')scheme=n;});
  const names=['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'];
  return names.map(name=>{const color=children(child(scheme,name))[0];return color?.attrs.lastClr||color?.attrs.val||'000000';});
}
function freezeTheme(n,theme,styles){
  const palette=themePalette(theme),indexed=children(child(child(styles,'colors'),'indexedColors')).map(n=>n.attrs.rgb);
  descend(n,item=>{if(item.attrs.theme!==undefined){item.attrs.rgb=palette[Number(item.attrs.theme)];delete item.attrs.theme;}if(item.attrs.indexed!==undefined&&indexed[Number(item.attrs.indexed)]){item.attrs.rgb=indexed[Number(item.attrs.indexed)];delete item.attrs.indexed;}});
  let major,minor;descend(theme,item=>{if(localName(item)==='majorFont')major=child(item,'latin')?.attrs.typeface;if(localName(item)==='minorFont')minor=child(item,'latin')?.attrs.typeface;});
  descend(n,item=>{if(localName(item)==='font'){const scheme=child(item,'scheme')?.attrs.val,typeface=scheme==='major'?major:scheme==='minor'?minor:null;if(typeface){let name=child(item,'name');if(!name){name=element('name');item.children.unshift(name);}name.attrs.val=typeface;item.children=item.children.filter(c=>typeof c==='string'||localName(c)!=='scheme');}}});
  return n;
}
export async function readFormatSource(buffer,sheetName,selection=null){
  const zip=await JSZip.loadAsync(buffer),workbook=await xmlPart(zip,'xl/workbook.xml'),rels=await xmlPart(zip,'xl/_rels/workbook.xml.rels');
  const selected=children(child(workbook,'sheets'),'sheet').find(n=>n.attrs.name===sheetName);if(!selected)throw new Error('找不到原始工作表。');
  const relation=children(rels).find(n=>n.attrs.Id===selected.attrs['r:id']);if(!relation)throw new Error('工作表关联无效。');
  const sheetPath=partPath('xl/workbook.xml',relation.attrs.Target);let sheetText=await zip.file(sheetPath).async('string');
  // Formatting-only rows outside the selected data must not recreate a million-row sheet.
  if(selection)sheetText=sheetText.replace(/<(?:\w+:)?row\b[^>]*(?:\/>|>[\s\S]*?<\/(?:\w+:)?row>)/g,row=>{const r=Number(row.match(/\br=["'](\d+)["']/)?.[1]);return r<=selection.headerEnd||selection.rows.has(r)?row:'';});
  let sheet=parseXML(sheetText);const rootPrefix=sheet.name.includes(':')?sheet.name.split(':')[0]+':':'';if(rootPrefix){descend(sheet,n=>{if(n.name.startsWith(rootPrefix))n.name=n.name.slice(rootPrefix.length);});sheet.attrs.xmlns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';}
  const stylesRel=children(rels).find(n=>/\/styles$/.test(n.attrs.Type)),themeRel=children(rels).find(n=>/\/theme$/.test(n.attrs.Type));
  const styles=stylesRel?await xmlPart(zip,partPath('xl/workbook.xml',stylesRel.attrs.Target)):parseXML('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font/></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="1"><xf/></cellXfs></styleSheet>');
  const theme=themeRel?await xmlPart(zip,partPath('xl/workbook.xml',themeRel.attrs.Target)):null;
  const sharedRel=children(rels).find(n=>/\/sharedStrings$/.test(n.attrs.Type)),shared=sharedRel?children(await xmlPart(zip,partPath('xl/workbook.xml',sharedRel.attrs.Target)),'si'):[];
  const rows=new Map();for(const row of children(child(sheet,'sheetData'),'row'))rows.set(Number(row.attrs.r),row);
  const cols=children(child(sheet,'cols'),'col'),merges=children(child(sheet,'mergeCells'),'mergeCell').map(n=>XLSX.utils.decode_range(n.attrs.ref));
  const columnStyle=c=>cols.find(n=>Number(n.attrs.min)<=c+1&&Number(n.attrs.max)>=c+1)?.attrs.style;
  const sheetRels=await xmlPart(zip,sheetPath.replace(/([^/]+)$/, '_rels/$1.rels'),false);
  return {zip,workbook,sheet,sheetPath,sheetRels,styles,theme,shared,rows,cols,merges,columnStyle,date1904:child(workbook,'workbookPr')?.attrs.date1904==='1'||child(workbook,'workbookPr')?.attrs.date1904==='true'};
}
function styleRegistry(first){
  const root=cloneXML(first.styles),maps=[],indexes={};
  // Deduplicate imported components while preserving all of the first file's IDs.
  for(const name of ['fonts','fills','borders','cellStyleXfs','cellXfs','dxfs'])indexes[name]=new Map(styleChildren(root,name).map((n,i)=>[writeXML(n),i]));
  function add(name,node){const key=writeXML(node),index=indexes[name];if(index.has(key))return index.get(key);const parent=section(root,name),id=children(parent).length;parent.children.push(node);index.set(key,id);return id;}
  let nextNumFmt=Math.max(163,...styleChildren(root,'numFmts').map(n=>Number(n.attrs.numFmtId)))+1;
  const formats=new Map(styleChildren(root,'numFmts').map(n=>[n.attrs.formatCode,Number(n.attrs.numFmtId)]));
  function importSource(source,i){
    if(i===0){const identity={};for(const name of Object.keys(indexes))identity[name]=styleChildren(source.styles,name).map((_,n)=>n);maps.push(identity);return identity;}
    const map={numFmts:new Map()};
    for(const original of styleChildren(source.styles,'numFmts')){const code=original.attrs.formatCode;let id=formats.get(code);if(id===undefined){id=nextNumFmt++;formats.set(code,id);const node=cloneXML(original);node.attrs.numFmtId=id;section(root,'numFmts').children.push(node);}map.numFmts.set(Number(original.attrs.numFmtId),id);}
    for(const name of ['fonts','fills','borders'])map[name]=styleChildren(source.styles,name).map(n=>add(name,freezeTheme(cloneXML(n),source.theme,source.styles)));
    const remapXF=n=>{const node=cloneXML(n);for(const [attr,name] of [['fontId','fonts'],['fillId','fills'],['borderId','borders'],['xfId','cellStyleXfs']])if(node.attrs[attr]!==undefined&&map[name])node.attrs[attr]=map[name][Number(node.attrs[attr])]||0;if(map.numFmts.has(Number(node.attrs.numFmtId)))node.attrs.numFmtId=map.numFmts.get(Number(node.attrs.numFmtId));return node;};
    map.cellStyleXfs=styleChildren(source.styles,'cellStyleXfs').map(n=>add('cellStyleXfs',remapXF(n)));
    map.cellXfs=styleChildren(source.styles,'cellXfs').map(n=>add('cellXfs',remapXF(n)));
    map.dxfs=styleChildren(source.styles,'dxfs').map(n=>{const node=freezeTheme(cloneXML(n),source.theme,source.styles);descend(node,item=>{if(localName(item)==='numFmt'&&map.numFmts.has(Number(item.attrs.numFmtId)))item.attrs.numFmtId=map.numFmts.get(Number(item.attrs.numFmtId));});return add('dxfs',node);});
    maps.push(map);return map;
  }
  function finish(){for(const name of ['numFmts','fonts','fills','borders','cellStyleXfs','cellXfs','dxfs']){const n=child(root,name);if(n)n.attrs.count=children(n).length;}
    const order=['numFmts','fonts','fills','borders','cellStyleXfs','cellXfs','cellStyles','dxfs','tableStyles','colors','extLst'];root.children=children(root).sort((a,b)=>order.indexOf(localName(a))-order.indexOf(localName(b)));return root;}
  return {root,maps,importSource,finish};
}
function mappedRanges(ref,rowMap,columnMap){
  const result=[];for(const token of String(ref||'').trim().split(/\s+/)){if(!/\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?$/i.test(token))continue;const range=XLSX.utils.decode_range(token.replace(/\$/g,'')),positions=[];
    const sorted=rowMap.sortedRows||(rowMap.sortedRows=[...rowMap].sort((a,b)=>a[0]-b[0]));let low=0,high=sorted.length;while(low<high){const mid=(low+high)>>1;if(sorted[mid][0]<range.s.r+1)low=mid+1;else high=mid;}for(let j=low;j<sorted.length&&sorted[j][0]<=range.e.r+1;j++)positions.push(sorted[j]);positions.sort((a,b)=>a[1]-b[1]);
    const cols=[];for(let c=range.s.c;c<=range.e.c;c++)if(columnMap.has(c))cols.push(columnMap.get(c));cols.sort((a,b)=>a-b);if(!cols.length)continue;
    let start=0;for(let i=1;i<=positions.length;i++)if(i===positions.length||positions[i][0]!==positions[i-1][0]+1||positions[i][1]!==positions[i-1][1]+1){for(let c=0;c<cols.length;){let end=c;while(end+1<cols.length&&cols[end+1]===cols[end]+1)end++;result.push({s:{r:positions[start][1]-1,c:cols[c]},e:{r:positions[i-1][1]-1,c:cols[end]},delta:positions[start][1]-positions[start][0]});c=end+1;}start=i;}
  }return result;
}
// Formula references in conditional formatting are shifted with their rows/columns.
function shiftedFormula(formula,delta,columnMap){return formula.replace(/("(?:[^"]|"")*"|'(?:[^']|'')*'!|\b(?:[A-Za-z_][\w.]*!))|(\$?)([A-Z]{1,3})(\$?)(\d+)/g,(all,quoted,absCol,letters,absRow,row,index)=>{if(quoted||formula[index+all.length]==='('||(index>0&&/[\w.]/.test(formula[index-1])))return all;const old=XLSX.utils.decode_col(letters),col=columnMap.has(old)?columnMap.get(old):old;return `${absCol}${XLSX.utils.encode_col(col)}${absRow}${absRow?row:Math.max(1,Number(row)+delta)}`;});}
export async function makePreservedMerge(data,sourceInputs){
  if(!data.exportPlan)throw new Error('缺少原格式导出信息，请重新合并。');
  const plan=data.exportPlan,selections=sourceInputs.map((_,i)=>({headerEnd:i===0?plan.contexts[0].header+plan.contexts[0].depth-1:0,rows:new Set()}));for(const origin of [...plan.origins,...plan.notes,...(plan.summaryOrigin?[plan.summaryOrigin]:[])])selections[origin.source].rows.add(origin.row);
  const sources=[];for(let i=0;i<sourceInputs.length;i++){const source=sourceInputs[i];if(!source.buffer||!/\.xlsx$/i.test(source.name))throw new Error(`「${source.name}」不是 XLSX。保留原格式请先用 Excel / WPS 另存为 .xlsx；CSV 本身没有样式。`);sources.push(await readFormatSource(source.buffer,source.sheet,selections[i]));}
  const first=sources[0],registry=styleRegistry(first);sources.forEach((s,i)=>registry.importSource(s,i));
  const base=await JSZip.loadAsync(XLSX.write(makeWorkbook(data),{type:'array',bookType:'xlsx'})),sheet=await xmlPart(base,'xl/worksheets/sheet1.xml'),firstContext=plan.contexts[0],offset=firstContext.firstColumn;
  const headerEnd=firstContext.header+firstContext.depth-1,templateLastColumn=Math.max(offset+plan.mappings[0].length-1,...first.merges.filter(m=>m.s.r<headerEnd).map(m=>m.e.c)),outputWidth=Math.max(offset+data.headers.length,templateLastColumn+1);
  const rowMaps=sources.map(()=>new Map()),columnMaps=plan.mappings.map((mapping,i)=>new Map(mapping.map((target,c)=>[plan.contexts[i].firstColumn+c,offset+target]))),output=[];
  for(let c=0;c<offset;c++)columnMaps[0].set(c,c);
  for(let c=offset+plan.mappings[0].length;c<outputWidth;c++)columnMaps[0].set(c,c);
  const styleId=(source,id)=>registry.maps[source].cellXfs[Number(id||0)]||0;
  function sourceCell(sourceIndex,original,targetRow,targetCol,row){
    const source=sources[sourceIndex],cell=cloneXML(original);cell.attrs.r=addressAt(targetRow,targetCol);const oldCol=cellPosition(original.attrs.r).c;cell.attrs.s=styleId(sourceIndex,original.attrs.s??row?.attrs.s??source.columnStyle(oldCol));delete cell.attrs.cm;delete cell.attrs.vm;
    cell.children=cell.children.filter(n=>typeof n==='string'||!['f','extLst'].includes(localName(n)));
    if(cell.attrs.t==='s'){const si=source.shared[Number(textXML(child(cell,'v')))];cell.attrs.t='inlineStr';cell.children=si?[element('is',{},si.children.map(cloneXML))]:[];}
    if(cell.attrs.t==='d'&&!Number.isFinite(new Date(textXML(child(cell,'v'))).getTime())){delete cell.attrs.t;cell.children=[];}
    if(source.date1904!==first.date1904&&(!cell.attrs.t||cell.attrs.t==='n')){const originalXF=styleChildren(source.styles,'cellXfs')[Number(original.attrs.s??row?.attrs.s??source.columnStyle(oldCol)??0)],formatId=Number(originalXF?.attrs.numFmtId||0),format=styleChildren(source.styles,'numFmts').find(n=>Number(n.attrs.numFmtId)===formatId)?.attrs.formatCode||XLSX.SSF._table[formatId];const value=child(cell,'v');if(value&&format&&XLSX.SSF.is_date(format))value.children=[String(Number(textXML(value))+(source.date1904?1462:-1462))];}
    if(sourceIndex!==0&&children(child(cell,'is'),'r').length)freezeTheme(cell,source.theme,source.styles);return cell;
  }
  function copyRow(sourceIndex,oldRow,newRow,generated=null){
    const source=sources[sourceIndex],original=source.rows.get(oldRow)||element('row',{r:oldRow}),node=element('row',{...original.attrs,r:newRow});delete node.attrs.spans;if(node.attrs.s!==undefined)node.attrs.s=styleId(sourceIndex,node.attrs.s);
    const cells=new Map();for(const c of children(original,'c')){const oldCol=cellPosition(c.attrs.r).c,target=columnMaps[sourceIndex].get(oldCol);if(target!==undefined)cells.set(target,sourceCell(sourceIndex,c,newRow,target,original));else if(sourceIndex===0&&oldCol<offset)cells.set(oldCol,sourceCell(sourceIndex,c,newRow,oldCol,original));}
    for(const [oldCol,target] of columnMaps[sourceIndex])if(!cells.has(target)&&(original.attrs.s!==undefined||source.columnStyle(oldCol)!==undefined))cells.set(target,element('c',{r:addressAt(newRow,target),s:styleId(sourceIndex,original.attrs.s??source.columnStyle(oldCol))}));
    if(generated)for(let c=0;c<data.headers.length;c++){const col=offset+c,value=cleanValue(generated[c]);let cell=cells.get(col);if(!cell){cell=element('c',{r:addressAt(newRow,col),s:styleId(sourceIndex,0)});cells.set(col,cell);}cell.children=[];delete cell.attrs.t;if(value==='')continue;if(typeof value==='number')cell.children=[element('v',{},[String(value)])];else if(typeof value==='boolean'){cell.attrs.t='b';cell.children=[element('v',{},[value?'1':'0'])];}else{cell.attrs.t='inlineStr';cell.children=[element('is',{},[element('t',{'xml:space':'preserve'},[display(value)])])];}}
    node.children=[...cells.entries()].sort((a,b)=>a[0]-b[0]).map(([,cell])=>cell);output.push(node);rowMaps[sourceIndex].set(oldRow,newRow);return node;
  }
  for(const r of [...first.rows.keys()].sort((a,b)=>a-b))if(r<=headerEnd)copyRow(0,r,r);
  let next=headerEnd+1;
  for(const origin of plan.origins)copyRow(origin.source,origin.row,next++);
  const summaryRow=data.summaryRowCount?next:0;if(summaryRow){const origin=plan.summaryOrigin||plan.origins[0];copyRow(origin.source,origin.row,next++,data.rows[data.rows.length-1]);}
  for(const note of plan.notes)copyRow(note.source,note.row,next++);
  if(next-1>1048576||offset+data.headers.length>16384)throw new Error('保留表头后的合表结果超过 Excel 行列上限。');
  // New fields retain their source's header style; existing multi-row headers stay intact.
  let header=output.find(n=>Number(n.attrs.r)===headerEnd);if(!header){header=element('row',{r:headerEnd});output.push(header);}
  const headerCells=new Map(children(header,'c').map(n=>[cellPosition(n.attrs.r).c,n]));
  for(let c=firstContext.firstColumn+plan.mappings[0].length;c<offset+data.headers.length;c++){
    const field=c-offset,index=plan.mappings.findIndex(m=>m.includes(field)),oldCol=plan.contexts[index].firstColumn+plan.mappings[index].indexOf(field),original=sources[index].rows.get(plan.contexts[index].header+plan.contexts[index].depth-1),raw=children(original,'c').find(n=>cellPosition(n.attrs.r).c===oldCol);
    const cell=raw?sourceCell(index,raw,headerEnd,c,original):element('c',{r:addressAt(headerEnd,c),s:styleId(index,0)});cell.attrs.t='inlineStr';cell.children=[element('is',{},[element('t',{},[data.headers[field]])])];headerCells.set(c,cell);
  }
  header.children=[...headerCells.entries()].sort((a,b)=>a[0]-b[0]).map(([,n])=>n);output.sort((a,b)=>Number(a.attrs.r)-Number(b.attrs.r));
  replaceSection(sheet,'sheetData',element('sheetData',{},output));
  const cols=[];for(let c=0;c<outputWidth;c++){let sourceIndex=0,oldCol=c;if(c>=offset+plan.mappings[0].length&&c<offset+data.headers.length){sourceIndex=plan.mappings.findIndex(m=>m.includes(c-offset));oldCol=plan.contexts[sourceIndex].firstColumn+plan.mappings[sourceIndex].indexOf(c-offset);}const original=sources[sourceIndex].cols.find(n=>Number(n.attrs.min)<=oldCol+1&&Number(n.attrs.max)>=oldCol+1);if(original){const col=cloneXML(original);col.attrs.min=c+1;col.attrs.max=c+1;if(col.attrs.style!==undefined)col.attrs.style=styleId(sourceIndex,col.attrs.style);cols.push(col);}}
  replaceSection(sheet,'cols',cols.length?element('cols',{},cols):null);
  const outputRows=new Map(output.map(row=>[Number(row.attrs.r),row])),mergeRefs=[];sources.forEach((source,i)=>{for(const range of source.merges){const mapped=mappedRanges(XLSX.utils.encode_range(range),rowMaps[i],columnMaps[i]);if(!mapped.length)continue;
    const mappedCols=[];for(let c=range.s.c;c<=range.e.c;c++)mappedCols.push(columnMaps[i].get(c));
    if(mappedCols.some((c,j)=>c===undefined||(j&&c!==mappedCols[j-1]+1)))throw new Error(`「${sourceInputs[i].name}」的合并区域 ${XLSX.utils.encode_range(range)} 在字段对齐后无法保持原版式。请将相关文件的列顺序调整一致；本次不会静默取消合并。`);
    for(const rect of mapped){if(rect.e.r>rect.s.r||rect.e.c>rect.s.c)mergeRefs.push(XLSX.utils.encode_range(rect));
      if(!rowMaps[i].has(range.s.r+1)){
        const row=outputRows.get(rect.s.r+1),originalRow=source.rows.get(range.s.r+1),anchor=children(originalRow,'c').find(c=>c.attrs.r===addressAt(range.s.r+1,range.s.c));if(row&&anchor){const cell=sourceCell(i,anchor,rect.s.r+1,rect.s.c,originalRow);row.children=children(row,'c').filter(c=>cellPosition(c.attrs.r).c!==rect.s.c);row.children.push(cell);row.children.sort((a,b)=>cellPosition(a.attrs.r).c-cellPosition(b.attrs.r).c);}
      }
    }
  }});
  replaceSection(sheet,'mergeCells',mergeRefs.length?element('mergeCells',{count:mergeRefs.length},[...new Set(mergeRefs)].map(ref=>element('mergeCell',{ref}))):null);
  for(const name of ['sheetPr','sheetViews','sheetFormatPr','printOptions','pageMargins','pageSetup','headerFooter']){const n=child(first.sheet,name);if(n){const copy=cloneXML(n);descend(copy,item=>{delete item.attrs['r:id'];});replaceSection(sheet,name,copy);}else replaceSection(sheet,name,null);}
  const conditional=[];sources.forEach((source,i)=>{for(const block of children(source.sheet,'conditionalFormatting'))for(const range of mappedRanges(block.attrs.sqref,rowMaps[i],columnMaps[i])){const n=cloneXML(block);n.attrs.sqref=XLSX.utils.encode_range(range);descend(n,item=>{if(item.attrs.dxfId!==undefined)item.attrs.dxfId=registry.maps[i].dxfs[Number(item.attrs.dxfId)]||0;if(localName(item)==='formula')item.children=[shiftedFormula(textXML(item),range.delta,columnMaps[i])];});conditional.push(n);}});
  sheet.children.push(...conditional);
  // Carry the first report's Excel table style (banding, header and totals styles).
  const tableParts=[],sheetRelations=[];
  for(const part of children(child(first.sheet,'tableParts'),'tablePart')){
    const relation=children(first.sheetRels).find(n=>n.attrs.Id===part.attrs['r:id']);if(!relation)continue;
    const table=await xmlPart(first.zip,partPath(first.sheetPath,relation.attrs.Target)),range=XLSX.utils.decode_range(table.attrs.ref);
    if(range.s.r+1!==headerEnd||range.s.c!==offset)continue;
    const total=Number(table.attrs.totalsRowCount||0)>0&&summaryRow?1:0;table.attrs.ref=XLSX.utils.encode_range({s:{r:headerEnd-1,c:offset},e:{r:headerEnd+plan.origins.length+total-1,c:offset+data.headers.length-1}});
    if(!total){delete table.attrs.totalsRowCount;table.attrs.totalsRowShown='0';}
    const filter=child(table,'autoFilter');if(filter)filter.attrs.ref=XLSX.utils.encode_range({s:{r:headerEnd-1,c:offset},e:{r:headerEnd+plan.origins.length-1,c:offset+data.headers.length-1}});
    const tableCols=child(table,'tableColumns');if(tableCols){const originals=children(tableCols,'tableColumn');for(let c=originals.length;c<data.headers.length;c++)tableCols.children.push(element('tableColumn',{id:c+1,name:data.headers[c]}));tableCols.attrs.count=children(tableCols).length;children(tableCols).forEach(n=>{n.children=n.children.filter(c=>typeof c==='string'||!['calculatedColumnFormula','totalsRowFormula'].includes(localName(c)));});}
    const id=tableParts.length+1;table.attrs.id=id;table.attrs.name=`ExcelBombTable${id}`;table.attrs.displayName=`ExcelBombTable${id}`;base.file(`xl/tables/table${id}.xml`,documentXML(table));tableParts.push(element('tablePart',{'r:id':`rIdTable${id}`}));sheetRelations.push(element('Relationship',{Id:`rIdTable${id}`,Type:'http://schemas.openxmlformats.org/officeDocument/2006/relationships/table',Target:`../tables/table${id}.xml`}));
    const types=await xmlPart(base,'[Content_Types].xml');types.children.push(element('Override',{PartName:`/xl/tables/table${id}.xml`,ContentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml'}));base.file('[Content_Types].xml',documentXML(types));
  }
  if(tableParts.length){sheet.attrs['xmlns:r']='http://schemas.openxmlformats.org/officeDocument/2006/relationships';replaceSection(sheet,'tableParts',element('tableParts',{count:tableParts.length},tableParts));base.file('xl/worksheets/_rels/sheet1.xml.rels',documentXML(element('Relationships',{xmlns:'http://schemas.openxmlformats.org/package/2006/relationships'},sheetRelations)));replaceSection(sheet,'autoFilter',null);}else replaceSection(sheet,'autoFilter',child(first.sheet,'autoFilter')?cloneXML(child(first.sheet,'autoFilter')):null);
  const auto=child(sheet,'autoFilter');if(auto){if(firstContext.depth>1)replaceSection(sheet,'autoFilter',null);else auto.attrs.ref=XLSX.utils.encode_range({s:{r:headerEnd-1,c:offset},e:{r:headerEnd+plan.origins.length-1,c:offset+data.headers.length-1}});}
  child(sheet,'dimension').attrs.ref=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:next-2,c:outputWidth-1}});
  const sheetOrder=['sheetPr','dimension','sheetViews','sheetFormatPr','cols','sheetData','sheetCalcPr','sheetProtection','protectedRanges','scenarios','autoFilter','sortState','dataConsolidate','customSheetViews','mergeCells','phoneticPr','conditionalFormatting','dataValidations','hyperlinks','printOptions','pageMargins','pageSetup','headerFooter','rowBreaks','colBreaks','customProperties','cellWatches','ignoredErrors','smartTags','drawing','legacyDrawing','legacyDrawingHF','picture','oleObjects','controls','webPublishItems','tableParts','extLst'];
  sheet.children.sort((a,b)=>typeof a==='string'?0:typeof b==='string'?0:sheetOrder.indexOf(localName(a))-sheetOrder.indexOf(localName(b)));
  base.file('xl/worksheets/sheet1.xml',documentXML(sheet));base.file('xl/styles.xml',documentXML(registry.finish()));
  if(first.theme)base.file('xl/theme/theme1.xml',documentXML(first.theme));
  const workbook=await xmlPart(base,'xl/workbook.xml'),pr=section(workbook,'workbookPr');pr.attrs.date1904=first.date1904?'1':'0';
  const originalSheetIndex=children(child(first.workbook,'sheets'),'sheet').findIndex(n=>n.attrs.name===sourceInputs[0].sheet),printNames=children(child(first.workbook,'definedNames'),'definedName').filter(n=>Number(n.attrs.localSheetId)===originalSheetIndex&&['_xlnm.Print_Area','_xlnm.Print_Titles'].includes(n.attrs.name));
  if(printNames.length){const names=element('definedNames');for(const n of printNames){const node=cloneXML(n);node.attrs.localSheetId='0';node.children=[n.attrs.name==='_xlnm.Print_Area'?`'数据'!$A$1:$${XLSX.utils.encode_col(outputWidth-1)}$${next-1}`:textXML(n).replace(/(?:'[^']*(?:''[^']*)*'|[^, !]+)!/g,"'数据'!")];names.children.push(node);}replaceSection(workbook,'definedNames',names);}else replaceSection(workbook,'definedNames',null);
  base.file('xl/workbook.xml',documentXML(workbook));
  return base.generateAsync({type:'arraybuffer',compression:'DEFLATE'});
}
