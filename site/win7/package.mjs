import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import './build.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),workspace=path.resolve(root,'../..');
const version=JSON.parse(fs.readFileSync(path.join(root,'../package.json'))).version;
if(!fs.readFileSync(path.join(root,'launcher/main.go'),'utf8').includes(`const version = "${version}-win7"`))throw new Error('Launcher version and package version must agree.');
const go=process.argv[2];if(!go)throw new Error('Pass an absolute Go 1.20.14 executable path.');
const goVersion=execFileSync(go,['version'],{encoding:'utf8'}).trim();if(!/go1\.20\.14\b/.test(goVersion))throw new Error('Win7 binaries must be compiled with Go 1.20.14.');
const releases=path.join(workspace,'releases'),stage=fs.mkdtempSync(path.join(os.tmpdir(),'excelbomb-win7-package-')),bundle=path.join(stage,'ExcelBomb-Win7');fs.mkdirSync(bundle,{recursive:true});
const env={...process.env,CGO_ENABLED:'0',GOCACHE:process.env.EXCELBOMB_GO_CACHE||path.join(os.tmpdir(),'excelbomb-win7-build/gocache'),GOMODCACHE:path.join(os.tmpdir(),'excelbomb-win7-build/modcache')};
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
function cstring(buffer,offset){const end=buffer.indexOf(0,offset);if(end<0)throw new Error('Invalid PE string.');return buffer.subarray(offset,end).toString('ascii');}
function inspectPE(buffer,architecture){
 const pe=buffer.readUInt32LE(0x3c);if(buffer.toString('ascii',pe,pe+4)!=='PE\u0000\u0000')throw new Error('Invalid PE file.');
 const machine=buffer.readUInt16LE(pe+4),sectionCount=buffer.readUInt16LE(pe+6),optionalSize=buffer.readUInt16LE(pe+20),opt=pe+24,magic=buffer.readUInt16LE(opt),wide=magic===0x20b;
 if(machine!==(architecture==='x86'?0x14c:0x8664)||wide!==(architecture==='x64'))throw new Error('Wrong executable architecture.');
 const major=buffer.readUInt16LE(opt+48),minor=buffer.readUInt16LE(opt+50),subsystem=buffer.readUInt16LE(opt+68);
 if(major>6||(major===6&&minor>1)||subsystem!==2)throw new Error('Executable subsystem is newer than Windows 7, or is not GUI.');
 const sections=[];for(let i=0;i<sectionCount;i++){const s=opt+optionalSize+i*40;sections.push({virtual:buffer.readUInt32LE(s+12),size:Math.max(buffer.readUInt32LE(s+8),buffer.readUInt32LE(s+16)),raw:buffer.readUInt32LE(s+20)});}
 function rva(value){const section=sections.find(s=>value>=s.virtual&&value<s.virtual+s.size);if(!section)throw new Error('Unmapped PE address.');return section.raw+value-section.virtual;}
 const directory=opt+(wide?112:96),importRva=buffer.readUInt32LE(directory+8),imports=[];
 for(let descriptor=rva(importRva);buffer.readUInt32LE(descriptor+12)!==0;descriptor+=20){
  const library=cstring(buffer,rva(buffer.readUInt32LE(descriptor+12))),table=buffer.readUInt32LE(descriptor)||buffer.readUInt32LE(descriptor+16);let thunk=rva(table);const functions=[];
  while(true){const value=wide?buffer.readBigUInt64LE(thunk):BigInt(buffer.readUInt32LE(thunk));if(!value)break;const ordinalMask=wide?0x8000000000000000n:0x80000000n;if(value&ordinalMask)functions.push('ordinal:'+String(value&0xffffn));else functions.push(cstring(buffer,rva(Number(value))+2));thunk+=wide?8:4;}
  imports.push({library,functions});
 }
 const unsupported=new Set(['GetSystemTimePreciseAsFileTime','GetTempPath2W','CreateFile2','WaitOnAddress','SetThreadDescription']);
 for(const item of imports)for(const fn of item.functions)if(unsupported.has(fn))throw new Error('Unsupported Win7 static import: '+fn);
 const resourceBase=rva(buffer.readUInt32LE(directory+16));
 function resourceEntry(relative,id){const table=resourceBase+relative,count=buffer.readUInt16LE(table+12)+buffer.readUInt16LE(table+14);for(let i=0;i<count;i++){const entry=table+16+i*8;if(id===null||buffer.readUInt32LE(entry)===id)return buffer.readUInt32LE(entry+4);}throw new Error('Missing manifest resource directory entry.');}
 const typeEntry=resourceEntry(0,24),idEntry=resourceEntry(typeEntry&0x7fffffff,1),languageEntry=resourceEntry(idEntry&0x7fffffff,null);
 if(!(typeEntry&0x80000000)||!(idEntry&0x80000000)||(languageEntry&0x80000000))throw new Error('Invalid RT_MANIFEST resource tree.');
 const manifestEntry=resourceBase+languageEntry,manifestStart=rva(buffer.readUInt32LE(manifestEntry));
 const manifest=buffer.subarray(manifestStart,manifestStart+buffer.readUInt32LE(manifestEntry+4));
 const manifestAsInvoker=manifest.includes(Buffer.from('requestedExecutionLevel level="asInvoker"'));
 if(!manifestAsInvoker)throw new Error('Missing embedded asInvoker manifest; installer detection could request administrator rights.');
 return {machine:architecture,format:wide?'PE32+':'PE32',subsystem:'Windows GUI',minimumSubsystem:`${major}.${minor}`,manifestAsInvoker,imports};
}
const binaries=[];
const [hostOS,hostArch]=execFileSync(go,['env','GOHOSTOS','GOHOSTARCH'],{encoding:'utf8'}).trim().split(/\r?\n/);
execFileSync(go,['mod','download'],{cwd:path.join(root,'tools'),env:{...env,GOOS:hostOS,GOARCH:hostArch},stdio:'inherit'});
for(const [folder,arch] of [['x86','386'],['x64','amd64']]){
 execFileSync(go,['run','-mod=readonly','github.com/akavel/rsrc','-manifest',path.join(root,'launcher/app.manifest'),'-arch',arch,'-o',path.join(root,`launcher/rsrc_windows_${arch}.syso`)],{cwd:path.join(root,'tools'),env:{...env,GOOS:hostOS,GOARCH:hostArch},stdio:'inherit'});
 const destination=path.join(bundle,'bin',folder,'ExcelBomb.exe');fs.mkdirSync(path.dirname(destination),{recursive:true});
 execFileSync(go,['build','-trimpath','-buildvcs=false','-ldflags','-H=windowsgui -s -w','-o',destination,'.'],{cwd:path.join(root,'launcher'),env:{...env,GOOS:'windows',GOARCH:arch,...(arch==='386'?{GO386:'softfloat'}:{})},stdio:'inherit'});
 const data=fs.readFileSync(destination),pe=inspectPE(data,folder);binaries.push({file:`bin/${folder}/ExcelBomb.exe`,sha256:hash(data),bytes:data.length,...pe});
 console.log('Verified:',folder,pe.format,'subsystem',pe.minimumSubsystem);
}
fs.copyFileSync(path.join(bundle,'bin/x86/ExcelBomb.exe'),path.join(bundle,'Install-ExcelBomb.exe'));
const installer=fs.readFileSync(path.join(bundle,'Install-ExcelBomb.exe'));
binaries.push({file:'Install-ExcelBomb.exe',sha256:hash(installer),bytes:installer.length,...inspectPE(installer,'x86')});
function command(mode){return `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\nset "EXCELBOMB_BIN=bin\\x86\\ExcelBomb.exe"\r\nif /I "%PROCESSOR_ARCHITECTURE%"=="AMD64" set "EXCELBOMB_BIN=bin\\x64\\ExcelBomb.exe"\r\nif defined PROCESSOR_ARCHITEW6432 set "EXCELBOMB_BIN=bin\\x64\\ExcelBomb.exe"\r\nif not exist "%~dp0%EXCELBOMB_BIN%" (\r\n  echo Please extract the entire ZIP before running ExcelBomb.\r\n  pause\r\n  exit /b 1\r\n)\r\nstart "" "%~dp0%EXCELBOMB_BIN%"${mode?' -'+mode:''}\r\nendlocal\r\n`;}
for(const [name,mode] of [['Start-ExcelBomb.cmd',''],['Stop-ExcelBomb.cmd','stop'],['Check-ExcelBomb.cmd','check'],['Enable-Autostart.cmd','enable-autostart'],['Disable-Autostart.cmd','disable-autostart']])fs.writeFileSync(path.join(bundle,name),command(mode).replace('if not exist "%~dp0%EXCELBOMB_BIN%" (','if not exist "%~dp0%EXCELBOMB_BIN%" set "EXCELBOMB_BIN=bin\\x86\\ExcelBomb.exe"\r\nif not exist "%~dp0%EXCELBOMB_BIN%" ('),'ascii');
fs.writeFileSync(path.join(bundle,'Install-ExcelBomb.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nstart "" "%~dp0Install-ExcelBomb.exe"\r\n','ascii');
fs.writeFileSync(path.join(bundle,'Uninstall-ExcelBomb.cmd'),'@echo off\r\nsetlocal\r\nif not exist "%LOCALAPPDATA%\\ExcelBomb\\Uninstall-ExcelBomb.cmd" (\r\n echo ExcelBomb is not installed for this user.\r\n pause\r\n exit /b 1\r\n)\r\n"%LOCALAPPDATA%\\ExcelBomb\\Uninstall-ExcelBomb.cmd"\r\n','ascii');
fs.writeFileSync(path.join(bundle,'README.txt'),'\ufeff'+fs.readFileSync(path.join(root,'README.txt'),'utf8').replace(/\r?\n/g,'\r\n'),'utf8');
fs.copyFileSync(path.join(root,'launcher/web/index.html'),path.join(bundle,'ExcelBomb-Win7.html'));
fs.mkdirSync(path.join(bundle,'licenses'),{recursive:true});fs.cpSync(path.resolve(root,'../dist/vendor/licenses'),path.join(bundle,'licenses'),{recursive:true});
fs.copyFileSync(path.join(root,'node_modules/core-js-bundle/LICENSE'),path.join(bundle,'licenses/core-js.txt'));
fs.copyFileSync(path.join(root,'node_modules/@babel/core/LICENSE'),path.join(bundle,'licenses/Babel.txt'));
fs.copyFileSync(path.resolve(path.dirname(go),'../LICENSE'),path.join(bundle,'licenses/Go.txt'));
const testFiles=[['test_01_拆表_第一行表头.xlsx','test_01_split_header1.xlsx'],['test_02_拆表_第二行表头.xlsx','test_02_split_header2.xlsx'],['test_03_合表_第一批.xlsx','test_03_merge_first.xlsx'],['test_04_合表_第二批_列顺序不同.xlsx','test_04_merge_reordered.xlsx'],['test_05_合表_第三批_缺列及新增列.xlsx','test_05_merge_different_columns.xlsx'],['test_06_Lookup_主表.xlsx','test_06_lookup_main.xlsx'],['test_07_Lookup_参照表.xlsx','test_07_lookup_reference.xlsx']];
fs.mkdirSync(path.join(bundle,'test'));for(const [original,name] of testFiles)fs.copyFileSync(path.join(workspace,'test',original),path.join(bundle,'test',name));
fs.writeFileSync(path.join(bundle,'test/README.txt'),'\ufeff'+fs.readFileSync(path.join(workspace,'test/测试说明.txt'),'utf8').replace(/\r?\n/g,'\r\n'),'utf8');
const report={version:version+'-win7',goVersion,nativeWindows7Tested:false,installation:{installerArchitecture:'x86',scope:'current-user',path:'%LOCALAPPDATA%\\ExcelBomb',autostart:'HKCU Run, --autostart, no browser at logon',desktopShortcut:true,controlPanelUninstall:true},checks:{es5Syntax:true,embeddedStaticAssets:true,loopbackOnly:true},web:JSON.parse(fs.readFileSync(path.join(root,'build-report.json'))),binaries};
fs.writeFileSync(path.join(bundle,'build-info.json'),JSON.stringify(report,null,2));
const require=createRequire(import.meta.url),sandbox={module:{exports:{}},exports:{},require,Buffer,setTimeout,setImmediate,clearTimeout,console};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.resolve(root,'../dist/vendor/jszip.min.js'),'utf8'),sandbox);const JSZip=sandbox.module.exports;
function addTree(zip,directory,prefix,x86Only){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){const absolute=path.join(directory,entry.name),name=prefix+entry.name;if(x86Only&&name==='ExcelBomb-Win7/bin/x64')continue;if(entry.isDirectory())addTree(zip,absolute,name+'/',x86Only);else zip.file(name,fs.readFileSync(absolute));}}
fs.mkdirSync(releases,{recursive:true});fs.cpSync(bundle,path.join(releases,'ExcelBomb-Win7'),{recursive:true});
for(const x86Only of [false,true]){
 const zip=new JSZip();addTree(zip,bundle,'ExcelBomb-Win7/',x86Only);
 if(x86Only)zip.file('ExcelBomb-Win7/build-info.json',JSON.stringify({...report,packageArchitecture:'x86',binaries:binaries.filter(binary=>binary.machine==='x86')},null,2));
 const archive=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
 const archiveName=`ExcelBomb-Win7-${x86Only?'x86-':''}${version}.zip`;fs.writeFileSync(path.join(releases,archiveName),archive);fs.writeFileSync(path.join(releases,archiveName+'.sha256'),hash(archive)+'  '+archiveName+'\n');
 console.log(JSON.stringify({archive:path.join(releases,archiveName),sha256:hash(archive),bytes:archive.length}));
}
fs.rmSync(stage,{recursive:true,force:true});
