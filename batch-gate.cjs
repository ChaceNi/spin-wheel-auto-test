function createBatchGate(size) {
  if (!Number.isInteger(size) || size < 1) throw Error('Invalid batch size');
  let count = 0;
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  return {
    arrive() {
      count++;
      if (count > size) throw Error('Too many arrivals');
      if (count === size) release();
      return ready;
    }
  };
}
module.exports = { createBatchGate };
