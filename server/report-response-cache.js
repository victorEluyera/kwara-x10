export function reportResponseCache({ ttl = 30000, max = 40, now = Date.now } = {}) {
  const entries = new Map(); let generation = 0;
  return {
    clear() { entries.clear(); generation++; },
    middleware(req, res, next) {
      const u = req.user;
      const key = JSON.stringify([u.id,u.role,u.scope_type,u.scope_value,u.member_id,u.is_coordinator,req.originalUrl]);
      const hit = entries.get(key);
      if (hit && now() - hit.at < ttl) return res.json(hit.body);
      const version = generation, send = res.json.bind(res);
      res.json = body => {
        if (res.statusCode === 200 && generation === version) {
          entries.delete(key); entries.set(key,{at:now(),body});
          if (entries.size > max) entries.delete(entries.keys().next().value);
        }
        return send(body);
      };
      next();
    },
  };
}
