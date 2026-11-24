const sources=new Map();let sourceSerial=0;
function progress(id,label,percent=null){self.postMessage({id,progress:{label,percent}});}
function sourceData(meta){const stored=sources.get(meta.id);if(!stored)throw new Error('文件已释放，请重新选择文件。');const key=JSON.stringify([meta.sheet,meta.header,meta.preserveIdentifiers]);if(stored.key!==key){stored.data=getData({...meta,wb:stored.wb});stored.key=key;}return stored.data;}
function register(wb,name,extra={}){const id=`source-${++sourceSerial}`;sources.set(id,{wb});return {id,name,sheetNames:wb.SheetNames,sheet:wb.SheetNames[0],header:1,preserveIdentifiers:true,...extra};}
self.onmessage=async({data:{id,kind,payload}})=>{
 try{
  let result;
  if(kind==='read'){
   const pending=[];
   for(let i=0;i<payload.files.length;i++){
    const f=payload.files[i];progress(id,`读取文件 ${i+1}/${payload.files.length}：${f.name}`);
    let wb;try{wb=XLSX.read(f.buffer,{type:'array',cellDates:true,cellNF:true,raw:/\.csv$/i.test(f.name)});}catch{throw new Error(`无法读取「${f.name}」，请检查文件是否损坏或已加密。`);}
    if(!wb.SheetNames.length)throw new Error(`「${f.name}」没有工作表。`);
    pending.push({wb,name:f.name});progress(id,`已读取 ${i+1}/${payload.files.length} 个文件`,(i+1)/payload.files.length*100);
   }
   result=pending.map(({wb,name})=>register(wb,name));
  }else if(kind==='sample'){
   result=payload.map(f=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([f.headers,...f.rows]),'示例数据');return register(wb,f.name,{demo:true});});
  }else if(kind==='extract'){progress(id,'识别表头与数据');result=sourceData(payload.source);
  }else if(kind==='split'){progress(id,'按字段分组');const data=sourceData(payload.source);result={data,groups:splitData(data,payload.column)};
  }else if(kind==='merge'){const tables=[];for(let i=0;i<payload.sources.length;i++){progress(id,`整理表格 ${i+1}/${payload.sources.length}`,i/payload.sources.length*80);tables.push(sourceData(payload.sources[i]));}progress(id,'对齐字段并合并数据',85);result=mergeTables(tables);
  }else if(kind==='lookup'){progress(id,'整理主表和参照表');const main=sourceData(payload.main),ref=sourceData(payload.ref);progress(id,'匹配记录并检查重复值');try{result={main,ref,result:lookupTables(main,ref,payload.options)};}catch(e){if(e.duplicateData)result={main,ref,duplicateData:e.duplicateData,error:e.message};else throw e;}
  }else if(kind==='xlsx'){progress(id,'生成 Excel 文件');result={buffer:XLSX.write(makeWorkbook(payload.data),{type:'array',bookType:'xlsx'})};
  }else if(kind==='zip'){
   const zip=new JSZip(),names=splitFilenames(payload.groups);
   for(let i=0;i<payload.groups.length;i++){progress(id,`生成 Excel ${i+1}/${payload.groups.length}`,i/payload.groups.length*80);zip.file(names[i],XLSX.write(makeWorkbook(groupData(payload.data,payload.groups[i])),{type:'array',bookType:'xlsx'}));}
   progress(id,'打包 ZIP',80);const buffer=await zip.generateAsync({type:'arraybuffer'},meta=>progress(id,'打包 ZIP',80+meta.percent*.2));result={buffer};
  }else if(kind==='dispose'){for(const key of payload.ids)sources.delete(key);result=true;
  }else throw new Error('未知处理任务。');
  if(result?.buffer instanceof ArrayBuffer)self.postMessage({id,result},[result.buffer]);else self.postMessage({id,result});
 }catch(error){self.postMessage({id,error:error.message||'处理失败，请检查文件后重试。'});}
};
