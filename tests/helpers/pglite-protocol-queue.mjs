/**
 * pglite-socket 0.2.7 queues individual protocol messages against ONE PostgreSQL session.
 * Parse(A), Parse(B), Bind(A) then uses B's unnamed statement (08P01), unlike real PostgreSQL.
 * Keep ownership through Sync/ReadyForQuery, and through an explicit transaction until commit.
 * Test-only adapter: no production pg driver, query semantics or product errors are changed.
 */
export function serializePgliteProtocol(server) {
  const queue = server.queryQueue;
  if (!queue?.enqueue || !queue.clearTransactionIfNeeded) throw Error("TEST_INFRA_FAILURE: unsupported PGlite socket queue");
  const enqueue = queue.enqueue.bind(queue), clear = queue.clearTransactionIfNeeded.bind(queue), clearPending = queue.clearQueueForHandler.bind(queue);
  let owner;
  const waiting = [];
  const tails = new Map();
  const closed = new Set();
  const release = id => {
    if (owner !== id) return;
    owner = undefined;
    const next = waiting.shift();
    if (next) { owner = next.id; next.resolve(); }
  };
  const leasedEnqueue = async (id, message, onData) => {
    if (owner !== undefined && owner !== id) await new Promise(resolve => waiting.push({ id, resolve }));
    else owner = id;
    try {
      if(closed.has(id))throw Error("TEST_INFRA_FAILURE: PGlite connection closed");
      const result = await enqueue(id, message, onData);
      // Startup packet, Simple Query and Sync complete a protocol exchange.
      if ([0, 81, 83].includes(message[0]) && !server.db.isInTransaction()) release(id);
      return result;
    } catch (error) { release(id); throw error; }
  };
  // Socket `data` callbacks are async and can overlap even for ONE handler. Preserve its wire order.
  queue.enqueue = (id, message, onData) => {
    const next = (tails.get(id) ?? Promise.resolve()).catch(() => undefined).then(() => leasedEnqueue(id, message, onData));
    tails.set(id, next);
    return next;
  };
  queue.clearTransactionIfNeeded = async id => {
    try { return await clear(id); }
    finally {
      // Remove disconnected waiters so a dead socket cannot acquire and strand the lease.
      for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].id === id) waiting.splice(i, 1)[0].resolve();
      release(id);
      tails.delete(id);
    }
  };
  queue.clearQueueForHandler = id => { closed.add(id); return clearPending(id); };
}
