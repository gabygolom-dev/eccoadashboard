import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const files=[];async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())await walk(p);else if(/\.(?:m?js)$/.test(p))files.push(p);}}
for(const dir of ['src','public','functions','scripts','tests'])await walk(dir);
for(const file of files){const c=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(c.status){process.stderr.write(c.stderr);process.exit(1);}}
const forbidden=[/EAA[A-Za-z0-9]{40,}/,/gh[pousr]_[A-Za-z0-9]{25,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
for(const file of files){const text=await readFile(file,'utf8');if(forbidden.some(re=>re.test(text)))throw new Error('Possível credencial em '+file);}
const transport=await readFile('src/connectors/http.js','utf8');
if(!transport.includes("method:'GET'")||!transport.includes("redirect:'error'"))throw new Error('Proteção do transporte ausente');
console.log(`${files.length} arquivos JavaScript: sintaxe válida. Verificação básica de credenciais e transporte GET concluída.`);
