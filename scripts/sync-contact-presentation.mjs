import {readFileSync,writeFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/shared/utils/contact-presentation.ts',import.meta.url),'utf8');
const target=new URL('../web/features/crm/contact-presentation.ts',import.meta.url);
const generated='// Generated from src/shared/utils/contact-presentation.ts. Run node scripts/sync-contact-presentation.mjs.\n'+source;
if(process.argv.includes('--check')) {
 if(readFileSync(target,'utf8')!==generated) throw new Error('Contact presentation mirror is out of date.');
} else writeFileSync(target,generated);
