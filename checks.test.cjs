const test = require('node:test');
const assert = require('node:assert/strict');
const { assess, summaryOf, visibleCode } = require('./checks.cjs');
const check = value => assess({ previousCodes: new Set(), ...value });
test('base-code fallback is recorded, including duplicate shared codes', () => {
  assert.deepEqual(check({ code:'spin_off_1', base:'spin_off_1', previousCodes:new Set(['spin_off_1']) }), ['non_fission_code','base_code','duplicate_code']);
});
test('mismatched UI and API code is not accepted silently', () => {
  assert.deepEqual(check({ code:'spin_off_1_A1234567', base:'spin_off_1', networkCode:'spin_off_1_B1234567' }), ['ui_api_mismatch']);
});
test('winning without visible code records missing-code evidence', () => {
  assert.deepEqual(check({ base:'spin_off_3', drawSucceeded:true, networkCode:'spin_off_3_A' }), ['missing_code','code_not_shown']);
  assert.deepEqual(check({ base:null, drawSucceeded:true }), []);
});
test('wrong-prize prefix is flagged', () => {
  assert.deepEqual(check({ code:'spin_off_10_A1234567', base:'spin_off_1' }), ['non_fission_code','wrong_prize_code']);
});
test('unique threshold excludes base codes and repeated suffixed codes', () => {
  const rows=Array.from({length:51},(_,i)=>({round:i+1,code:`spin_off_1_${i.toString(16).padStart(8,'0')}`,base:'spin_off_1',issues:[],outcome:'code_received'}));
  rows.push({round:52,code:'spin_off_1',base:'spin_off_1',issues:['base_code'],outcome:'code_received'});
  rows.push({round:53,code:'spin_off_1_00000000',base:'spin_off_1',issues:['duplicate_code'],outcome:'code_received'});
  rows.push({round:54,code:'SAVE10',base:'spin_off_1',issues:['non_fission_code'],outcome:'code_received'});
  rows.push({round:55,code:'spin_off_1_SUMMER',base:'spin_off_1',issues:['non_fission_code'],outcome:'code_received'});
  const stat=summaryOf(rows,{}).byPrize.spin_off_1;
  assert.equal(stat.uniqueSuffixedCount,51); assert.equal(stat.baseCodes,1); assert.equal(stat.duplicateReturns,1);
  assert.equal(stat.nonFissionCodes,3);
  assert.deepEqual(stat.after50Unique,[{round:51,code:'spin_off_1_00000032'}]);
});
test('ordinary codes and malformed suffixes are abnormal even on first issuance', () => {
  assert.deepEqual(check({code:'SAVE10',base:'SAVE10'}),['non_fission_code','base_code']);
  assert.deepEqual(check({code:'SUMMER10',base:'spin_off_1'}),['non_fission_code','wrong_prize_code']);
  assert.deepEqual(check({code:'spin_off_1_SUMMER',base:'spin_off_1'}),['non_fission_code']);
});
test('visible ordinary coupon is retained instead of being mistaken for missing code', () => {
  assert.equal(visibleCode('You won "5美刀"', [{value:'SAVE10',readOnly:true,id:'coupon'}]),'SAVE10');
  assert.equal(visibleCode('You won "5美刀"', [{value:'SAVE10',id:'result'}]),'SAVE10');
  assert.equal(visibleCode('Enter your full name and email', [{value:'Alex Test',id:'cc_spinner_full_name'},{value:'a@example.com',id:'cc_spinner_email'}]),null);
});
