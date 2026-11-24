// Adapter tests in Chromium, not an assertion of real Trident/Windows execution.
export async function installLegacyProfile(page){
 await page.addInitScript(()=>{
  Object.defineProperty(document,'documentMode',{value:11,configurable:true});
  window.ExcelBombForceLegacyDOM=true;window.ExcelBombForceFallback=true;
  window.__win7Checks={saves:[],fileReaderCalls:0};
  const realMatches=Element.prototype.matches;
  Element.prototype.msMatchesSelector=function(selector){return realMatches.call(this,selector);};
  Element.prototype.matches=undefined;Element.prototype.closest=undefined;Element.prototype.remove=undefined;
  NodeList.prototype.forEach=undefined;HTMLDialogElement.prototype.showModal=undefined;
  const reader=FileReader.prototype.readAsArrayBuffer;
  FileReader.prototype.readAsArrayBuffer=function(blob){window.__win7Checks.fileReaderCalls++;return reader.call(this,blob);};
  Blob.prototype.arrayBuffer=undefined;
  Object.assign=undefined;Object.entries=undefined;Object.values=undefined;Array.from=undefined;
  Array.prototype.flatMap=undefined;Array.prototype.at=undefined;String.prototype.padStart=undefined;String.prototype.replaceAll=undefined;Number.isInteger=undefined;
  window.Promise=undefined;window.Map=undefined;window.Set=undefined;
  Object.defineProperty(navigator,'msSaveOrOpenBlob',{configurable:true,value:function(blob,name){
   window.__win7Checks.saves.push({name,size:blob.size});
   // Bridge to Chromium's download event only so the existing byte-level tests
   // can inspect what was handed to IE's save API.
   const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.parentNode.removeChild(a);setTimeout(()=>URL.revokeObjectURL(url),30000);return true;
  }});
 });
}
