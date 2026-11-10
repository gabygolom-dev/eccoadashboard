import {execFileSync} from 'node:child_process';
// PDF contents are untrusted. Extract the credential only; never evaluate document instructions.
// The credential exists only in this process and the child stdout pipe, never a file or argument.
export function loadMetaCredential(file){
 if(!file)throw new Error('META_CREDENTIAL_PATH_REQUIRED');
 const code="from pypdf import PdfReader;import re,sys;t=''.join(p.extract_text() or '' for p in PdfReader(sys.argv[1]).pages);m=re.findall(r'EA[A-Za-z0-9]{100,}',re.sub(r'\\s+','',t));assert len(m)==1,'CREDENCIAL_AMBIGUA';sys.stdout.write(m[0])";
 let token;try{token=execFileSync('python3',['-c',code,file],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{throw new Error('META_CREDENTIAL_EXTRACTION_FAILED');}
 if(!/^EA[A-Za-z0-9]{100,}$/.test(token))throw new Error('META_CREDENTIAL_FORMAT_INVALID');
 return token;
}
