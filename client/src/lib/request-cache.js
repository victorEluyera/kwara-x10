export function createRequestCache({ ttl = 60000, max = 60, now = Date.now } = {}) {
  const saved = new Map(), pending = new Map(); let generation = 0;
  return {
    clear() { generation++; saved.clear(); pending.clear(); },
    get(key, load) {
      const hit = saved.get(key);
      if (hit && now() - hit.at < ttl) return Promise.resolve(hit.value);
      if (pending.has(key)) return pending.get(key);
      const version = generation;
      const promise = Promise.resolve().then(load).then(value => {
        if (generation === version) {
          saved.delete(key); saved.set(key, { value, at: now() });
          if (saved.size > max) saved.delete(saved.keys().next().value);
        }
        return value;
      }).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
      pending.set(key, promise); return promise;
    },
  };
}
