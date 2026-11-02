import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
function files(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):[join(dir,e.name)]);}
test('interfaces não retornam nomes crus de contatos, Lead ou IDs como identificação; protocolo Meta mantém enum interno',()=>{
 const sources=[...files('web/app'),...files('web/components')].filter(f=>/\.tsx?$/.test(f));
 for(const file of sources){const source=readFileSync(file,'utf8');
  assert.doesNotMatch(source,/\{contact\.name\}|contact\?\.name\s*\?\?\s*"Sem contato|return conversation\.contactName\s*\?\?|"Novo Lead"|label="Lead score"/,file);
 }
 const pixel=readFileSync('web/app/workspaces/[workspaceId]/meta-ads/pixels-tab.tsx','utf8');assert.match(pixel,/"Lead"/);assert.match(pixel,/"Lead" \? "Contato"/);
});
