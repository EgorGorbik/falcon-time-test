import {stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=new URL('../',import.meta.url);
export async function resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env=globalThis.__falconEnv;',shortCircuit:true};
 if(specifier==='next/headers')return {url:'data:text/javascript,export async function headers(){return new Headers(globalThis.__falconHeaders)}',shortCircuit:true};
 if(specifier==='next/navigation')return {url:'data:text/javascript,export function redirect(url){throw new Error(url)}',shortCircuit:true};
 if(specifier.startsWith('@/'))specifier=new URL(specifier.slice(2),root).href;
 if(specifier.startsWith('.')||specifier.startsWith('file:')){
  const u=new URL(specifier,context.parentURL);if(!/\.[a-z]+$/.test(u.pathname)&&existsSync(fileURLToPath(u)+'.ts'))return {url:u.href+'.ts',shortCircuit:true};
 }
 return next(specifier,context);
}
function strip(source, url) {
  try { return stripTypeScriptTypes(source, {mode:'strip', sourceUrl:url}); }
  catch { return stripTypeScriptTypes(source, {mode:'transform', sourceUrl:url}); }
}
export async function load(url,context,next){if(url.endsWith('.ts'))return {format:'module',source:strip(await readFile(fileURLToPath(url),'utf8'),url),shortCircuit:true};return next(url,context);}
