const sources=new Map(),mergeExports=new Map();let sourceSerial=0,exportSerial=0;
async function readWorkbook(file){
 const options={type:'array',cellDates:true,cellNF:true,raw:/\.csv$/i.test(file.name)},complete=wb=>wb?.SheetNames?.length&&wb.SheetNames.every(name=>typeof name==='string'&&wb.Sheets?.[name]);
 let wb;try{wb=XLSX.read(file.buffer,options);}catch{}
 if(complete(wb))return {wb,repairedDates:0};
 // Some XLSX generators emit date cells with no cached value. SheetJS can
 // silently drop that entire worksheet after calling .match on the null date.
 if(/\.xlsx$/i.test(file.name)){
  try{
   const zip=await JSZip.loadAsync(file.buffer);let repairedDates=0;
   for(const name of Object.keys(zip.files)){
    if(!/^xl\/worksheets\/[^/]+\.xml$/.test(name))continue;
    const xml=await zip.file(name).async('string');let changed=false;
    const fixed=xml.replace(/<c\b[^>]*\bt=(?:"d"|'d')[^>]*(?:\/>|>[\s\S]*?<\/c>)/g,cell=>{
     const match=cell.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/),value=match?match[1].trim():'';
     if(value&&Number.isFinite(new Date(value).getTime()))return cell;
     repairedDates++;changed=true;if(!value||/^(?:null|undefined)$/i.test(value))return '';
     const start=cell.match(/^<c\b([^>]*?)(?:\/>|>)/),attributes=start?start[1].replace(/\s+t=(?:"d"|'d')/,''):'';
     return `<c${attributes} t="inlineStr"><is><t>${match[1]}</t></is></c>`;
    });
    if(changed)zip.file(name,fixed);
   }
   if(repairedDates){wb=XLSX.read(await zip.generateAsync({type:'arraybuffer'}),options);if(complete(wb))return {wb,repairedDates};}
  }catch{}
 }
 throw new Error(`无法完整读取「${file.name}」的工作表，请检查文件是否损坏或已加密；必要时用 Excel / WPS 另存为 XLSX 后重试。`);
}
function progress(id,label,percent=null){self.postMessage({id,progress:{label,percent}});}
function sourceData(meta){const stored=sources.get(meta.id);if(!stored)throw new Error('文件已释放，请重新选择文件。');const key=JSON.stringify([meta.sheet,meta.header,meta.preserveIdentifiers]);if(stored.key!==key){stored.data=getData({...meta,wb:stored.wb});stored.key=key;}return stored.data;}
function register(wb,name,extra={},buffer=null){const id=`source-${++sourceSerial}`;sources.set(id,{wb,buffer});return {id,name,sheetNames:wb.SheetNames,sheet:wb.SheetNames[0],header:1,preserveIdentifiers:true,...extra};}
self.onmessage=async({data:{id,kind,payload}})=>{
 try{
  let result;
  if(kind==='read'){
   const pending=[];
   for(let i=0;i<payload.files.length;i++){
    const f=payload.files[i];progress(id,`读取文件 ${i+1}/${payload.files.length}：${f.name}`);
    const {wb,repairedDates}=await readWorkbook(f);
    if(!wb.SheetNames.length)throw new Error(`「${f.name}」没有工作表。`);
    pending.push({wb,name:f.name,repairedDates,buffer:f.buffer});progress(id,`已读取 ${i+1}/${payload.files.length} 个文件`,(i+1)/payload.files.length*100);
   }
   result=pending.map(({wb,name,repairedDates,buffer})=>{const meta=register(wb,name,{repairedDates},buffer);if(payload.merge){meta.autoHeader=true;const found=detectMergeHeader({...meta,wb});meta.header=found.header;meta.detectedDataStart=found.header+found.depth;}return meta;});
  }else if(kind==='sample'){
   result=payload.map(f=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([f.headers,...f.rows]),'示例数据');return register(wb,f.name,{demo:true});});
  }else if(kind==='extract'){progress(id,'识别表头与数据');result=sourceData(payload.source);
  }else if(kind==='split'){progress(id,'按字段分组');const data=sourceData(payload.source);result={data,groups:splitData(data,payload.column)};
  }else if(kind==='merge-header'){const meta=payload.source,stored=sources.get(meta.id);if(!stored)throw new Error('文件已释放，请重新选择文件。');result=detectMergeHeader({...meta,wb:stored.wb});
  }else if(kind==='merge'){const tables=[],inputs=[];for(let i=0;i<payload.sources.length;i++){const meta=payload.sources[i],stored=sources.get(meta.id);if(!stored)throw new Error('文件已释放，请重新选择文件。');progress(id,`整理表格 ${i+1}/${payload.sources.length}：${meta.name}`,i/payload.sources.length*80);try{tables.push(getMergeData({...meta,wb:stored.wb}));if(payload.options?.preserveStyles!==false&&/\.xls$/i.test(meta.name)&&!meta.demo)throw new Error('保留原格式请先用 Excel / WPS 将 XLS 另存为 XLSX。也可在页面明确关闭“保留原格式”后只合并数据。');inputs.push({id:meta.id,name:/\.xlsx$/i.test(meta.name)?meta.name:meta.demo||/\.csv$/i.test(meta.name)?meta.name+'.xlsx':meta.name,sheet:meta.sheet,buffer:/\.xlsx$/i.test(meta.name)&&stored.buffer?stored.buffer:XLSX.write(stored.wb,{type:'array',bookType:'xlsx'})});}catch(e){throw new Error(`「${meta.name}」的「${meta.sheet}」处理失败：${e.message}`);}}progress(id,'清理重复结构并对齐字段',85);result=mergeTables(tables,payload.options||{});mergeExports.clear();if(payload.options?.preserveStyles!==false){const token=`merge-${++exportSerial}`;mergeExports.set(token,{data:result,inputs});result={...result,exportToken:token,preserveStyles:true};}delete result.exportPlan;
  }else if(kind==='lookup'){progress(id,'整理主表和参照表');const main=sourceData(payload.main),ref=sourceData(payload.ref);progress(id,'匹配记录并检查重复值');try{result={main,ref,result:lookupTables(main,ref,payload.options)};}catch(e){if(e.duplicateData)result={main,ref,duplicateData:e.duplicateData,error:e.message};else throw e;}
  }else if(kind==='xlsx'){progress(id,'生成 Excel 文件');if(payload.data.exportToken){const saved=mergeExports.get(payload.data.exportToken);if(!saved)throw new Error('原格式导出已过期，请重新合并。');progress(id,'保留原表样式和版式');result={buffer:await makePreservedMerge(saved.data,saved.inputs)};}else result={buffer:XLSX.write(makeWorkbook(payload.data),{type:'array',bookType:'xlsx'})};
  }else if(kind==='zip'){
   const zip=new JSZip(),names=splitFilenames(payload.groups);
   for(let i=0;i<payload.groups.length;i++){progress(id,`生成 Excel ${i+1}/${payload.groups.length}`,i/payload.groups.length*80);zip.file(names[i],XLSX.write(makeWorkbook(groupData(payload.data,payload.groups[i])),{type:'array',bookType:'xlsx'}));}
   progress(id,'打包 ZIP',80);const buffer=await zip.generateAsync({type:'arraybuffer'},meta=>progress(id,'打包 ZIP',80+meta.percent*.2));result={buffer};
  }else if(kind==='dispose'){for(const key of payload.ids)sources.delete(key);for(const [token,saved] of mergeExports)if(saved.inputs.some(input=>payload.ids.includes(input.id)))mergeExports.delete(token);result=true;
  }else throw new Error('未知处理任务。');
  if(result?.buffer instanceof ArrayBuffer)self.postMessage({id,result},[result.buffer]);else self.postMessage({id,result});
 }catch(error){self.postMessage({id,error:error.message||'处理失败，请检查文件后重试。'});}
};
