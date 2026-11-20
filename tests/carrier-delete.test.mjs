import test from 'node:test';
import assert from 'node:assert/strict';
import { exactShipment, darb } from '../netlify/lib/core.mjs';
test('carrier mutations require positive acknowledgement and exact reference matching', async t => {
  const target = {reference:'SH2',_id:'two'};
  assert.equal(exactShipment({results:[{reference:'SH1'}, target]}, 'SH2'),target);
  assert.equal(exactShipment({results:[target,target]}, 'SH2'),null);
  assert.equal(exactShipment({results:[target]}, 'SH1'),null);
  globalThis.Netlify = {env:{get:()=> 'fixture'}};
  t.mock.method(globalThis,'fetch',async()=>Response.json({status:false,messages:[{message:'Rejected'}]}));
  await assert.rejects(darb('DELETE','/api/local/shipments/two'),/Rejected/);
  globalThis.fetch.mock.mockImplementation(async()=>Response.json({}));
  await assert.rejects(darb('DELETE','/api/local/shipments/two'));
});
