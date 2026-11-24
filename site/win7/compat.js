/* ES5-only browser adapters. Build-time transpilation is not a DOM polyfill. */
(function (window, document) {
  'use strict';
  var ie = !!document.documentMode;
  window.ExcelBombWin7 = {isIE: ie, version: '1.1.0-win7'};
  if (!Element.prototype.matches) Element.prototype.matches = Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;
  if (!Element.prototype.closest) Element.prototype.closest = function (selector) {var node=this;while(node&&node.nodeType===1){if(node.matches(selector))return node;node=node.parentElement;}return null;};
  if (!Element.prototype.remove) Element.prototype.remove = function () {if(this.parentNode)this.parentNode.removeChild(this);};
  if (window.NodeList&&!NodeList.prototype.forEach) NodeList.prototype.forEach=Array.prototype.forEach;
  if (window.DOMTokenList) {
    var toggle=DOMTokenList.prototype.toggle;
    DOMTokenList.prototype.toggle=function(name,force){if(arguments.length>1){if(force)this.add(name);else this.remove(name);return !!force;}return toggle.call(this,name);};
  }
  if (window.Blob&&!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer=function(){var blob=this;return new Promise(function(resolve,reject){var reader=new FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=function(){reject(reader.error||new Error('读取文件失败。'));};reader.readAsArrayBuffer(blob);});};
  function event(name,cancelable){var e=document.createEvent('Event');e.initEvent(name,false,!!cancelable);return e;}
  var dialog=document.getElementById('modal'),nativeDialog=dialog&&typeof dialog.showModal==='function'&&!window.ExcelBombForceLegacyDOM;
  var lastFocus=null,backdrop=null;
  if(dialog&&!nativeDialog){
    document.documentElement.className+=' legacy-dialog';
    backdrop=document.createElement('div');backdrop.className='legacy-backdrop';backdrop.style.display='none';document.body.appendChild(backdrop);
    if(!('open' in dialog))Object.defineProperty(dialog,'open',{get:function(){return this.hasAttribute('open');}});
    dialog.showModal=function(){lastFocus=document.activeElement;this.setAttribute('open','');backdrop.style.display='block';document.body.className+=' modal-open';var first=this.querySelector('button,input,select,[tabindex]');if(first)first.focus();};
    dialog.close=function(){if(!this.hasAttribute('open'))return;this.removeAttribute('open');backdrop.style.display='none';document.body.className=document.body.className.replace(/\bmodal-open\b/g,'');this.dispatchEvent(event('close'));if(lastFocus&&lastFocus.focus)lastFocus.focus();};
    function cancel(){if(dialog.dispatchEvent(event('cancel',true)))dialog.close();}
    backdrop.onclick=cancel;
    document.addEventListener('keydown',function(e){if(!dialog.open)return;if(e.keyCode===27){e.preventDefault();cancel();return;}if(e.keyCode===9){var nodes=Array.prototype.filter.call(dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]'),function(n){return !n.disabled&&n.getClientRects().length>0;});if(!nodes.length)return;var first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}},true);
  }
  var nativeDetails='open' in document.createElement('details');
  if(!nativeDetails||window.ExcelBombForceLegacyDOM){
    document.documentElement.className+=' legacy-details';
    if(!nativeDetails&&!('open' in Element.prototype))Object.defineProperty(Element.prototype,'open',{get:function(){return this.hasAttribute('open');},set:function(value){if(value)this.setAttribute('open','');else this.removeAttribute('open');}});
    function prepare(){var summaries=document.querySelectorAll('details>summary');for(var i=0;i<summaries.length;i++){summaries[i].setAttribute('tabindex','0');summaries[i].setAttribute('role','button');summaries[i].setAttribute('aria-expanded',summaries[i].parentNode.hasAttribute('open')?'true':'false');}}
    function flip(summary){var details=summary.parentNode;if(details.hasAttribute('open'))details.removeAttribute('open');else details.setAttribute('open','');summary.setAttribute('aria-expanded',details.hasAttribute('open')?'true':'false');}
    document.addEventListener('click',function(e){var summary=e.target.closest('summary');if(summary&&summary.parentNode.tagName.toLowerCase()==='details'){e.preventDefault();flip(summary);}},true);
    document.addEventListener('keydown',function(e){if((e.keyCode===13||e.keyCode===32)&&e.target.tagName.toLowerCase()==='summary'){e.preventDefault();flip(e.target);}});
    prepare();if(window.MutationObserver)new MutationObserver(prepare).observe(document.body,{childList:true,subtree:true});
  }
  window.ExcelBombLegacySave=function(blob,name){
    if(navigator.msSaveOrOpenBlob){if(navigator.msSaveOrOpenBlob(blob,name)===false)throw new Error('保存未成功，请在浏览器中允许文件下载。');return;}
    if(navigator.msSaveBlob){if(navigator.msSaveBlob(blob,name)===false)throw new Error('保存未成功，请在浏览器中允许文件下载。');return;}
    var api=window.URL||window.webkitURL;
    if(!api||!api.createObjectURL)throw new Error('当前浏览器不支持文件保存，请使用 IE11 或兼容浏览器。');
    var url=api.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.parentNode.removeChild(a);setTimeout(function(){api.revokeObjectURL(url);},30000);
  };
  window.ExcelBombLegacyCreateWorker=function(){
    var facade={onmessage:null,onerror:null},real=null,local=null,pending=[],completed=false,terminated=false;
    function deliver(data){if(terminated)return;if(!data.progress){completed=true;pending=pending.filter(function(item){return item.id!==data.id;});}if(facade.onmessage)facade.onmessage({data:data});}
    function localSend(data){setTimeout(function(){if(!terminated)local.onmessage({data:data});},0);}
    function fallback(){if(real){real.terminate();real=null;}local={postMessage:function(data){setTimeout(function(){deliver(data);},0);}};window.ExcelBombLegacyEngine(local);for(var i=0;i<pending.length;i++)localSend(pending[i]);window.ExcelBombWin7.processing='兼容处理模式';}
    function fail(error){if(!completed){fallback();}else if(facade.onerror)facade.onerror(error);}
    if(!window.Worker||window.ExcelBombForceFallback||(ie&&location.protocol==='file:'))fallback();
    else{
      try{
        var embedded=document.getElementById('excelbomb-worker-source');
        if(!ie&&embedded){var api=window.URL||window.webkitURL;var blobUrl=api.createObjectURL(new Blob([embedded.textContent],{type:'text/javascript'}));real=new Worker(blobUrl);api.revokeObjectURL(blobUrl);}
        else real=new Worker('worker.js');
        real.onmessage=function(e){deliver(e.data);};real.onerror=fail;window.ExcelBombWin7.processing='后台线程';
      }catch(error){fallback();}
    }
    facade.postMessage=function(data,transfer){if(terminated)return;pending.push(data);if(local)localSend(data);else{try{if(ie)real.postMessage(data);else real.postMessage(data,transfer||[]);}catch(error){fail(error);}}};
    facade.terminate=function(){terminated=true;if(real)real.terminate();pending=[];local=null;};
    return facade;
  };
}(window,document));
