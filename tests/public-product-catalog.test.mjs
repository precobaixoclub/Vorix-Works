import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerPlatformPlansRoutes } from '../dist/interfaces/api/routes/v1/platform-plans.route.js';
import * as solutionCatalog from '../dist/domain/solutions/solution.model.js';

test('public pricing exposes existing eligibility without publishing internal products or modifying prices', async () => {
  const app = Fastify();
  const plan = { planCode:'START', name:'Start', tagline:'', monthlyPriceUsd:149, yearlyPriceUsd:1490, currency:'BRL', limits:{users:2,messaging_connections:1,ai_credits:500}, trialDays:7 };
  await registerPlatformPlansRoutes(app, { planVersionRepository:{async listActivePlans(){return [plan];}} });
  try {
    const response = await app.inject({method:'GET',url:'/platform/plans'});
    assert.equal(response.statusCode,200);
    const data=response.json().data;
    assert.equal(data.priceSource,'plan_versions');
    assert.equal(data.plans[0].monthlyPriceUsd,149);
    assert.deepEqual(data.solutions.map(solution=>solution.key),['conversations','meetings','site']);
    for(const solution of data.solutions) {
      const definition=solutionCatalog.SOLUTIONS[solution.key];
      const expected=solutionCatalog.isSolutionContractable ? solutionCatalog.isSolutionContractable(definition) : solution.key==='conversations' && definition.commercialAvailability==='public';
      assert.equal(solution.contractable,expected);
    }
    assert.equal(data.solutions.find(solution=>solution.key==='meetings').contractable,true);
    assert.equal(data.solutions.some(solution=>solution.key==='marketing'),false);
    assert.equal(data.solutions.some(solution=>solution.key==='suite'),false);
  } finally {await app.close();}
});

test('development fallback is identified and cannot impersonate the official billing source', async () => {
  const app=Fastify();
  await registerPlatformPlansRoutes(app);
  try {
    const data=(await app.inject({method:'GET',url:'/platform/plans'})).json().data;
    assert.equal(data.priceSource,'legacy_development');
    assert.equal(data.solutions.find(solution=>solution.key==='meetings').contractable,true);
  } finally {await app.close();}
});
