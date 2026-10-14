import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { WebSocket } from 'ws';
import { PostgresSolutionEntitlementRepository } from '../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js';
import { SolutionAccessService } from '../dist/application/solutions/solution-access.service.js';
import { PostgresMeetingRepository } from '../dist/infrastructure/storage/postgres/postgres-meeting-repository.js';
import { evaluateAutoRecordings } from '../dist/application/meetings/meeting-processing.js';
import { decryptSecret } from '../dist/infrastructure/crypto/secret-cipher.js';

const API=process.env.VORIX_STRUCTURAL_FIXTURE_API_URL;
const WEB=process.env.VORIX_STRUCTURAL_FIXTURE_WEB_URL;
const CONTROL=process.env.VORIX_STRUCTURAL_FIXTURE_CONTROL_URL;
const PASSWORD_SENTINEL='FIXTURE_GOOGLE_PASSWORD_NOT_PERSISTED';
const MFA_SENTINEL='946218';
const APP_PASSWORD='ControlledVorixFixture!2026';
const waitFor=async(fn,ms=15000)=>{const until=Date.now()+ms;while(Date.now()<until){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Fixture condition timed out');};

test('SELF-SERVICE UI + JWT real + WebSocket + PostgreSQL: fixtures sem Google real', {skip:!API||!WEB||!CONTROL}, async t=>{
  for(const url of [API,WEB,CONTROL])assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname));
  const scope=await fetch(`${API}/fixture-only/scope`).then(r=>r.json());
  assert.equal(scope.fixtureOnly,true);
  assert.equal(scope.googleRealEnabled,false);
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  assert.equal((await pool.query('select current_database() as name')).rows[0].name,scope.database);
  assert.ok(scope.database.startsWith('vorix_structural_fixture_'));
  const suffix=Date.now().toString(36);
  const service=new SolutionAccessService({repository:new PostgresSolutionEntitlementRepository(pool),cacheTtlMs:0});
  const repository=new PostgresMeetingRepository(pool);
  async function request(path,actor,payload,method=payload===undefined?'GET':'POST'){
    const r=await fetch(`${API}${path}`,{method,headers:{...(actor?{authorization:`Bearer ${actor.accessToken}`}:{ }),...(payload===undefined?{}:{'content-type':'application/json'})},...(payload===undefined?{}:{body:JSON.stringify(payload)})});
    return {status:r.status,body:await r.json()};
  }
  async function actor(label){
    const email=`${label}-${suffix}@fixture.invalid`;
    const signup=await request('/v1/auth/signup',undefined,{email,password:APP_PASSWORD,name:`Fixture ${label}`,workspaceName:`Fixture ${label}`});
    assert.equal(signup.status,201);
    const result={...signup.body.data,email};
    result.workspaceId=(await pool.query(`select id from workspaces where tenant_id=$1 and status='active'`,[result.tenantId])).rows[0].id;
    await service.setEntitlement({tenantId:result.tenantId,solutionKey:'meetings',enabled:true,source:'internal',reason:'Controlled structural fixtures, no real Google',limits:{maxConcurrentRecordings:2}});
    return result;
  }
  const owner=await actor('owner');
  const foreign=await actor('foreign');
  const another=await actor('another-admin');
  await pool.query(`update tenant_members set tenant_id=$1, role='admin' where user_id=$2`,[owner.tenantId,another.user.id]);
  Object.assign(another,(await request('/v1/auth/login',undefined,{email:another.email,password:APP_PASSWORD})).body.data);
  const editor=await actor('editor');
  await pool.query(`update tenant_members set tenant_id=$1, role='editor' where user_id=$2`,[owner.tenantId,editor.user.id]);
  Object.assign(editor,(await request('/v1/auth/login',undefined,{email:editor.email,password:APP_PASSWORD})).body.data);
  const browser=await chromium.launch({headless:true,executablePath:process.env.MEETINGS_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const accountsUrl=`${WEB}/workspaces/${owner.workspaceId}/meetings/recorder-accounts`;
  let accountA,accountB;
  const metrics=()=>fetch(`${CONTROL}/metrics`).then(r=>r.json());
  async function completeViewer(){
    const canvas=page.getByLabel('Navegador de login do Google');
    await canvas.waitFor({state:'visible',timeout:20000});
    await canvas.focus();
    await page.keyboard.type(PASSWORD_SENTINEL,{delay:15});
    await page.keyboard.press('Tab');
    await page.keyboard.type(MFA_SENTINEL,{delay:25});
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
  }
  async function connect(label,email){
    await page.getByRole('button',{name:'Conectar conta',exact:true}).click();
    await page.getByLabel('Nome da conta',{exact:true}).fill(label);
    await page.getByLabel('Conta Google de gravação',{exact:true}).fill(email);
    await page.getByRole('button',{name:'Continuar',exact:true}).click();
    await completeViewer();
    await page.getByText('Conta conectada e testada no Google Meet.',{exact:true}).waitFor({timeout:20000});
    await page.getByRole('button',{name:'Concluir',exact:true}).click();
    await waitFor(async()=>await page.getByTestId('recorder-account-row').filter({hasText:label}).count()===1);
    return (await pool.query(`select id,encrypted_session_state from recorder_bot_accounts where tenant_id=$1 and google_email=$2`,[owner.tenantId,email])).rows[0];
  }
  async function createMeeting(human,extra={}){
    const result=await request('/v1/meetings',owner,{workspaceId:owner.workspaceId,title:'Fixture structural recording',source:'external_link',meetingUrl:'https://meet.google.com/abc-defg-hij',humanJoinAccountEmail:human,...extra});
    assert.equal(result.status,201);return result.body.data.meeting;
  }
  async function release(meetingId){
    await repository.transition({tenantId:owner.tenantId,meetingId,to:'cancelled'});
    await repository.releaseBot({meetingId,healthy:true});
    await pool.query(`update meeting_jobs set status='cancelled' where meeting_id=$1 and status in ('queued','running')`,[meetingId]);
  }
  async function viewerClose(token,accessToken){
    return new Promise((resolve,reject)=>{
      const s=new WebSocket(`${API.replace(/^http/,'ws')}/v1/meetings/recorder-provisioning/stream`);
      const timeout=setTimeout(()=>{s.terminate();reject(new Error('Viewer close timeout'));},5000);
      s.on('open',()=>s.send(JSON.stringify({t:'auth',token,accessToken})));
      s.on('close',code=>{clearTimeout(timeout);resolve(code)});s.on('error',reject);
    });
  }
  try {
    await t.test('tela autentica pelo login normal e conecta duas contas fictícias pelo canvas/relay',async()=>{
      await page.goto(`${WEB}/login`);
      await page.getByLabel('E-mail',{exact:true}).fill(owner.email);
      await page.getByLabel('Senha',{exact:true}).fill(APP_PASSWORD);
      await page.getByRole('button',{name:'Entrar',exact:true}).click();
      await page.waitForURL(/\/workspaces/,{timeout:20000});
      await page.goto(accountsUrl);
      await page.getByRole('heading',{name:'Contas de gravação',exact:true}).waitFor();
      accountA=await connect('Fixture Recorder A',`recorder-a-${suffix}@fixture.invalid`);
      accountB=await connect('Fixture Recorder B',`recorder-b-${suffix}@fixture.invalid`);
      const cap=(await request(`/v1/meetings/recording-capacity?workspaceId=${owner.workspaceId}`,owner)).body.data;
      assert.deepEqual([cap.planCapacity,cap.tenantHealthyCapacity,cap.tenantAvailableCapacity],[2,2,2]);
      assert.ok(!accountA.encrypted_session_state.includes('fixture-'));
      assert.ok(decryptSecret(accountA.encrypted_session_state,process.env.JWT_SECRET).includes('fixture_sid'));
    });
    await t.test('reconexão falha preserva ciphertext e exige reauth; reconexão validada reativa',async()=>{
      await fetch(`${CONTROL}/health/fail`,{method:'POST'});
      let row=page.getByTestId('recorder-account-row').filter({hasText:'Fixture Recorder A'});
      await row.getByRole('button',{name:'Reconectar',exact:true}).click();
      await page.getByRole('button',{name:'Abrir login do Google',exact:true}).click();
      await completeViewer();
      await page.getByText('Esta conta precisa ser reconectada.',{exact:true}).waitFor({timeout:20000});
      await page.getByRole('button',{name:'Fechar',exact:true}).click();
      const failed=(await pool.query(`select status,encrypted_session_state from recorder_bot_accounts where id=$1`,[accountA.id])).rows[0];
      assert.equal(failed.status,'reauth_required');assert.equal(failed.encrypted_session_state,accountA.encrypted_session_state);
      assert.equal((await request(`/v1/meetings/recording-capacity?workspaceId=${owner.workspaceId}`,owner)).body.data.tenantHealthyCapacity,1);
      await waitFor(async()=>await page.getByText('Reconecte esta conta para continuar utilizando-a nas gravações.',{exact:true}).count()>0);
      await fetch(`${CONTROL}/health/pass`,{method:'POST'});
      row=page.getByTestId('recorder-account-row').filter({hasText:'Fixture Recorder A'});
      await row.getByRole('button',{name:'Reconectar',exact:true}).click();
      await page.getByRole('button',{name:'Abrir login do Google',exact:true}).click();
      await completeViewer();
      await page.getByText('Conta conectada e testada no Google Meet.',{exact:true}).waitFor({timeout:20000});
      await page.getByRole('button',{name:'Concluir',exact:true}).click();
      const healthy=(await pool.query(`select status,encrypted_session_state from recorder_bot_accounts where id=$1`,[accountA.id])).rows[0];
      assert.equal(healthy.status,'active');assert.notEqual(healthy.encrypted_session_state,accountA.encrypted_session_state);
    });
    await t.test('JWT/RBAC/tenant: editor não administra, outro tenant não vê e outro usuário não abre sessão',async()=>{
      assert.equal((await request(`/v1/meetings/recorder-accounts?workspaceId=${owner.workspaceId}`,editor)).status,403);
      assert.equal((await request(`/v1/meetings/recorder-accounts/${accountA.id}/test`,foreign,{},'POST')).status,404);
      const result=await request(`/v1/meetings/recorder-accounts/${accountA.id}/reconnect`,owner,{workspaceId:owner.workspaceId});
      assert.equal(result.status,201);const start=result.body.data;
      assert.equal((await request(`/v1/meetings/recorder-provisioning/${start.session.id}`,another)).status,404);
      assert.equal(await viewerClose(start.viewerToken,another.accessToken),4401);
      assert.equal(await viewerClose(start.viewerToken,foreign.accessToken),4401);
      const own=new WebSocket(`${API.replace(/^http/,'ws')}/v1/meetings/recorder-provisioning/stream`);
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Owner viewer frame timeout')),10000);
        own.on('open',()=>own.send(JSON.stringify({t:'auth',token:start.viewerToken,accessToken:owner.accessToken})));
        own.on('message',(_data,binary)=>{if(binary){clearTimeout(timeout);resolve()}});own.on('error',reject);
      });
      assert.equal(await viewerClose(start.viewerToken,owner.accessToken),4401,'single-use token cannot open a second viewer');
      await request(`/v1/meetings/recorder-provisioning/${start.session.id}/cancel`,owner,{},'POST');
      own.close();
      // Fixture account was not reconnected; preserve non-eligibility after cancellation.
      assert.equal((await pool.query(`select status from recorder_bot_accounts where id=$1`,[accountA.id])).rows[0].status,'reauth_required');
      await pool.query(`update recorder_bot_accounts set status='active',health='{"status":"healthy"}' where id=$1`,[accountA.id]);
    });
    await t.test('sessão temporária expira sem substituir o estado anterior ou manter browser aberto',async()=>{
      const old=(await pool.query(`select encrypted_session_state from recorder_bot_accounts where id=$1`,[accountA.id])).rows[0].encrypted_session_state;
      const start=(await request(`/v1/meetings/recorder-accounts/${accountA.id}/reconnect`,owner,{workspaceId:owner.workspaceId})).body.data;
      await pool.query(`update recorder_provisioning_sessions set expires_at=now()+interval '2 seconds' where id=$1`,[start.session.id]);
      await waitFor(async()=>(await pool.query(`select status from recorder_provisioning_sessions where id=$1`,[start.session.id])).rows[0].status==='expired');
      await waitFor(async()=>(await metrics()).active===0);
      assert.equal((await pool.query(`select encrypted_session_state from recorder_bot_accounts where id=$1`,[accountA.id])).rows[0].encrypted_session_state,old);
      assert.equal(await viewerClose(start.viewerToken,owner.accessToken),4401,'expired token cannot be replayed');
      await pool.query(`update recorder_bot_accounts set status='active',health='{"status":"healthy"}' where id=$1`,[accountA.id]);
    });
    await t.test('reserva transacional escolhe outra conta e respeita o plano entre requisições reais',async()=>{
      const emailA=`recorder-a-${suffix}@fixture.invalid`;
      const m=await createMeeting(emailA);
      const selected=await request(`/v1/meetings/${m.id}/recording`,owner,{workspaceId:owner.workspaceId});
      assert.equal(selected.body.data.ok,true);assert.equal(selected.body.data.botAccountId,accountB.id);
      const audit=(await pool.query(`select details from meeting_audit_log where meeting_id=$1 and action='RECORDER_ACCOUNT_SKIPPED_IDENTITY_CONFLICT'`,[m.id])).rows;
      assert.ok(audit.some(x=>x.details.recorderAccountId===accountA.id));await release(m.id);
      await service.setEntitlement({tenantId:owner.tenantId,solutionKey:'meetings',enabled:true,source:'internal',limits:{maxConcurrentRecordings:1}});
      // Existing HTTP access service caches entitlements for 30 seconds; test atomic repository with the current plan as authority.
      const first=await createMeeting('human@fixture.invalid');const second=await createMeeting('human@fixture.invalid');
      const results=await Promise.all([first,second].map(m=>repository.admitRecording({tenantId:owner.tenantId,workspaceId:owner.workspaceId,meetingId:m.id,maxConcurrentRecordings:1,now:new Date()})));
      assert.equal(results.filter(x=>x.ok).length,1);assert.equal(results.find(x=>!x.ok).reason,'CONCURRENCY_LIMIT_REACHED');
      await release(results[0].ok?first.id:second.id);
      await service.setEntitlement({tenantId:owner.tenantId,solutionKey:'meetings',enabled:true,source:'internal',limits:{maxConcurrentRecordings:2}});
    });
    await t.test('scheduler aplica identidade confirmada e reserva conta no banco de fixtures',async()=>{
      const m=await createMeeting('human@fixture.invalid');
      await pool.query(`update meetings set auto_record=true, scheduled_start_at=now(), scheduled_end_at=now()+interval '10 minutes' where id=$1`,[m.id]);
      const result=await evaluateAutoRecordings({repository,now:()=>new Date()},{defaults:{joinBeforeMinutes:2,joinGraceMinutes:10},realRecordingEnabled:true,limitsFor:async()=>({maxConcurrentRecordings:2,monthlyRecordingMinutes:600,meetingRetentionDays:90,maxStorageBytes:1000000000}),limit:10});
      assert.equal(result.outcomes.QUEUED,1);await release(m.id);
    });
    await t.test('abandono encerra browser; senha/MFA fictícios não existem no banco ou auditoria',async()=>{
      await page.goto(accountsUrl);
      await page.getByRole('button',{name:'Conectar conta',exact:true}).click();
      await page.getByLabel('Nome da conta',{exact:true}).fill('Fixture Abandonada');
      await page.getByLabel('Conta Google de gravação',{exact:true}).fill(`abandoned-${suffix}@fixture.invalid`);
      await page.getByRole('button',{name:'Continuar',exact:true}).click();
      await page.getByLabel('Navegador de login do Google').waitFor({state:'visible'});
      await page.close();
      await waitFor(async()=>(await metrics()).active===0);
      const abandoned=(await pool.query(`select status,encrypted_session_state from recorder_bot_accounts where tenant_id=$1 and google_email=$2`,[owner.tenantId,`abandoned-${suffix}@fixture.invalid`])).rows[0];
      assert.equal(abandoned.status,'disabled');assert.equal(abandoned.encrypted_session_state,null);
      const data=[];for(const table of ['recorder_bot_accounts','recorder_provisioning_sessions','meeting_audit_log'])data.push((await pool.query(`select row_to_json(t) as value from ${table} t`)).rows);
      const dump=JSON.stringify(data);assert.ok(!dump.includes(PASSWORD_SENTINEL));assert.ok(!dump.includes(MFA_SENTINEL));
      const snapshot=await metrics();assert.equal(snapshot.opened,snapshot.closed);assert.ok(snapshot.inputs>0);assert.ok(snapshot.healthChecks>=4);
    });
  } finally {
    await browser.close();await pool.end();
  }
});
