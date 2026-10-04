/**
 * Catch async errors in an Express route.
 *
 * Express 4 does not await route handlers. An `async` handler that rejects
 * therefore produces an unhandled promise rejection, and Node terminates the
 * process on those -- so one bad query in one endpoint takes the whole API
 * down, and every other request in flight dies with it.
 *
 * This forwards the rejection to Express's error handler instead, which turns
 * it into a JSON 500. Every async route must use it.
 *
 * Its own module so both index.js and external.js use the same one, and so it
 * can be tested without starting a server.
 */
export const wrap = (fn) => (req, res, next) => {
  // The try/catch is not redundant: if fn throws synchronously it throws
  // before Promise.resolve is ever reached, so .catch alone would miss it.
  try {
    Promise.resolve(fn(req, res, next)).catch(next);
  } catch (error) {
    next(error);
  }
};

/**
 * Last line of defence: keep the process alive if a rejection escapes anyway.
 *
 * Losing one request is bad. Losing the process drops every concurrent
 * request and restarts the container, which is how a single failing endpoint
 * became an outage.
 */
export function guardProcess() {
  process.on('unhandledRejection', (reason) => {
    console.error('[fatal-guard] unhandled rejection -- the process was kept alive:',
      reason instanceof Error ? reason.stack : reason);
  });
  process.on('uncaughtException', (error) => {
    console.error('[fatal-guard] uncaught exception -- the process was kept alive:',
      error?.stack || error);
  });
}
