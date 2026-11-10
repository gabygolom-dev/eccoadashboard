import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function createDB(file=':memory:'){
 const sqlite=new DatabaseSync(file);for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 function prepare(sql){let args=[];const obj={bind(...a){args=a;return obj;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};},_run(){const r=sqlite.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};return obj;}
 return {prepare,async batch(stmts){sqlite.exec('BEGIN');try{const r=stmts.map(s=>s._run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}},close(){sqlite.close();},sqlite};
}
