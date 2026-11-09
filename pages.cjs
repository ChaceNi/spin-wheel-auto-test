// Create tabs concurrently, but settle every creation before cleaning up failures.
async function createPages(count, setup) {
  const results = await Promise.allSettled(Array.from({ length: count }, () => Promise.resolve().then(setup)));
  const failure = results.find(result => result.status === 'rejected');
  if (failure) {
    await Promise.allSettled(results.filter(result => result.status === 'fulfilled').map(result => result.value.close()));
    throw failure.reason;
  }
  return results.map(result => result.value);
}
module.exports = { createPages };
