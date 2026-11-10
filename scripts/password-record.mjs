import {readFile} from 'node:fs/promises';
import {passwordRecord} from '../src/auth.js';
// Run privately: node scripts/password-record.mjs /protected/eccoa.json | pbcopy
// Never invoke with a password on the command line. No CRM or Meta key is accessed.
const file=process.argv[2];if(!file)throw new Error('Informe o caminho do JSON protegido com a chave dashboardPassword.');
const {dashboardPassword}=JSON.parse(await readFile(file,'utf8'));
process.stdout.write(await passwordRecord(dashboardPassword));
