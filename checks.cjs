function isFissionCode(code, base) {
  if (!code) return false;
  if (base) return code.startsWith(base + '_') && /^[a-f0-9]{8}$/i.test(code.slice(base.length + 1));
  return /^spin_off_\d+_[a-f0-9]{8}$/i.test(code);
}

function visibleCode(text, fields, networkCode) {
  if (networkCode && (fields.some(field => field.value === networkCode) || text.split(/\s+/).includes(networkCode))) return networkCode;
  const candidates = fields.filter(field => field.value && !/full_name|email|phone|consent/i.test([field.id, field.name, field.placeholder, field.type].join(' ')));
  const couponField = candidates.find(field => field.readOnly || /coupon|code/i.test([field.id, field.name, field.placeholder].join(' ')));
  if (couponField) return couponField.value.trim();
  if (/You won/i.test(text) && candidates.length === 1) return candidates[0].value.trim();
  return text.match(/\bspin_off_[A-Za-z0-9_-]+\b/)?.[0] || null;
}

function assess({ code, base, networkCode, previousCodes, drawSucceeded, error, responseError }) {
  const issues = [];
  if (error) issues.push('browser_error');
  if (responseError) issues.push('api_error');
  if (code && !isFissionCode(code, base)) issues.push('non_fission_code');
  if (code && (code === base || /^spin_off_\d+$/.test(code))) issues.push('base_code');
  if (code && previousCodes.has(code)) issues.push('duplicate_code');
  if (code && base && code !== base && !code.startsWith(base + '_')) issues.push('wrong_prize_code');
  if (networkCode && code && networkCode !== code) issues.push('ui_api_mismatch');
  if (drawSucceeded && base && !code) issues.push('missing_code');
  if (networkCode && !code) issues.push('code_not_shown');
  return issues;
}

function summaryOf(rows, config) {
  const byPrize = {};
  const anomalies = {};
  for (const row of rows) {
    for (const issue of row.issues) anomalies[issue] = (anomalies[issue] || 0) + 1;
    if (!row.code) continue;
    const key = row.base || 'unknown';
    const stat = byPrize[key] ||= { returned: 0, baseCodes: 0, nonFissionCodes: 0, uniqueSuffixedCodes: [], duplicateReturns: 0, after50Unique: [] };
    stat.returned++;
    if (!isFissionCode(row.code, row.base)) stat.nonFissionCodes++;
    if (row.code === row.base) stat.baseCodes++;
    if (isFissionCode(row.code, row.base) && !stat.uniqueSuffixedCodes.includes(row.code)) {
      stat.uniqueSuffixedCodes.push(row.code);
      if (stat.uniqueSuffixedCodes.length > 50) stat.after50Unique.push({ round: row.round, code: row.code });
    }
    if (row.issues.includes('duplicate_code')) stat.duplicateReturns++;
  }
  for (const stat of Object.values(byPrize)) stat.uniqueSuffixedCount = stat.uniqueSuffixedCodes.length;
  return {
    config, finished: rows.length, codesReturned: rows.filter(r => r.code).length,
    noWin: rows.filter(r => r.outcome === 'no_win').length,
    abnormalRounds: rows.filter(r => r.issues.length).length,
    anomalies, byPrize,
    limitations: [config.mode === 'api' ? 'HTTP API tests with a shared visitor and cookie jar for this run; no UI rendering, animation, screenshots, or UI/API comparison.' : 'Browser UI tests, concurrent batches of tabs in one Chrome window; shared storage is cleared only between batches.', 'No checkout redemption or mailbox delivery verification.', 'Unique-code counts cover this run only; backend starting stock is unknown.']
  };
}
module.exports = { assess, summaryOf, isFissionCode, visibleCode };
