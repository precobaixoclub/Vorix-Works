// Controlled Vorix fixture identity, not a Google account. Never runs outside local homologation.
import pg from 'pg';
import { SolutionAccessService } from '../../dist/application/solutions/solution-access.service.js';
import { PostgresSolutionEntitlementRepository } from '../../dist/infrastructure/storage/postgres/postgres-solution-entitlement-repository.js';

export const FIXTURE_ADMIN_EMAIL='structural-admin@vorix-fixture.invalid';
// Deliberately public fixture data; never use these credentials in production or Google.
export const FIXTURE_ADMIN_PASSWORD='ControlledVorixFixture!2026';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try {
  if(process.env.ALLOW_FIXTURE_ADMIN_BOOTSTRAP!=='true')throw new Error('Explicit fixture bootstrap flag required');
  const database=(await pool.query('select current_database() as name')).rows[0].name;
  if(database!=='vorix_homolog')throw new Error('Refusing fixture bootstrap outside vorix_homolog');
  const existing=(await pool.query(`select id from users where email=$1`,[FIXTURE_ADMIN_EMAIL])).rows[0];
  const endpoint=existing?'login':'signup';
  const response=await fetch(`http://localhost:3000/v1/auth/${endpoint}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:FIXTURE_ADMIN_EMAIL,password:FIXTURE_ADMIN_PASSWORD,...(existing?{}:{name:'Administrador fictício de homologação',workspaceName:'Homologação Meetings — fixtures controladas'})})});
  const body=await response.json();
  if(!body.ok)throw new Error(`Fixture auth failed: ${body.error.code}`);
  const actor=body.data;
  const owned=(await pool.query(`select u.id,m.tenant_id,m.role from users u join tenant_members m on m.user_id=u.id where u.email=$1 and m.tenant_id=$2`,[FIXTURE_ADMIN_EMAIL,actor.tenantId])).rows[0];
  if(!owned||!['owner','admin'].includes(owned.role)||owned.id!==actor.user.id)throw new Error('Fixture ownership mismatch');
  await new SolutionAccessService({repository:new PostgresSolutionEntitlementRepository(pool),cacheTtlMs:0}).setEntitlement({tenantId:actor.tenantId,solutionKey:'meetings',enabled:true,source:'internal',reason:'Fixture-only local acceptance preparation; PUBLIC=NO; CONTRACTABLE=NO',actorUserId:actor.user.id,limits:{maxConcurrentRecordings:2}});
  const workspace=(await pool.query(`select id from workspaces where tenant_id=$1 and status='active'`,[actor.tenantId])).rows[0];
  const result={fixtureOnly:true,googleAccountCreated:false,email:FIXTURE_ADMIN_EMAIL,tenantId:actor.tenantId,userId:actor.user.id,workspaceId:workspace.id,role:owned.role,planCapacity:2};
  console.log(JSON.stringify(result));
}finally {await pool.end();}
