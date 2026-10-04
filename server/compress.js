// gzip, because Express does not do it and nothing else was.
//
// Every response this app sends was going over the wire raw: a 527 KB
// JavaScript bundle, a 179 KB geography payload on most pages, and every JSON
// body. On a phone on Nigerian mobile data that is the difference between the
// app appearing and the app appearing eventually.
//
// Hand-rolled rather than adding the `compression` package, for the same
// reason as the spreadsheet writer and the S3 signing in this codebase: the
// job is thirty lines of built-in zlib, and a dependency here would sit in the
// path of every single response.
//
// What it does NOT do, deliberately:
//   - compress anything already compressed (images, spreadsheets, zips)
//   - compress tiny bodies, where the header costs more than it saves
//   - touch a response that already set its own Content-Encoding

import zlib from 'node:zlib';

/** Text-shaped types. Everything else is left alone. */
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|xml|manifest|x-ndjson)|image\/svg)/i;

/** Below this many bytes gzip usually makes the response bigger. */
const THRESHOLD = 1024;

export function compress({ threshold = THRESHOLD, level = zlib.constants.Z_DEFAULT_COMPRESSION } = {}) {
  return function compressionMiddleware(req, res, next) {
    // A client that did not ask for it does not get it.
    if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next();
    if (req.method === 'HEAD') return next();

    const rawWrite = res.write.bind(res);
    const rawEnd = res.end.bind(res);

    // null = not decided yet, false = decided against, otherwise the stream.
    let gzip = null;

    const decide = () => {
      if (gzip !== null) return gzip;

      const type = String(res.getHeader('Content-Type') || '');
      const length = Number(res.getHeader('Content-Length') || 0);
      const already = res.getHeader('Content-Encoding');

      if (already || !COMPRESSIBLE.test(type) || (length && length < threshold)) {
        gzip = false;
        return false;
      }

      // The compressed length is not known until it is compressed, so the
      // declared one has to go or the client will truncate the body.
      res.removeHeader('Content-Length');
      res.setHeader('Content-Encoding', 'gzip');
      // Caches must not serve a gzipped body to a client that cannot read it.
      res.setHeader('Vary', 'Accept-Encoding');

      gzip = zlib.createGzip({ level });
      gzip.on('data', (chunk) => rawWrite(chunk));
      gzip.on('end', () => rawEnd());
      gzip.on('error', () => rawEnd());
      return gzip;
    };

    res.write = (chunk, encoding, callback) => {
      const stream = decide();
      if (!stream) return rawWrite(chunk, encoding, callback);
      return stream.write(chunk, typeof encoding === 'string' ? encoding : undefined, callback);
    };

    res.end = (chunk, encoding, callback) => {
      const stream = decide();
      if (!stream) return rawEnd(chunk, encoding, callback);
      if (typeof chunk === 'function') return stream.end(chunk);
      if (chunk) stream.write(chunk, typeof encoding === 'string' ? encoding : undefined);
      stream.end(typeof encoding === 'function' ? encoding : callback);
      return res;
    };

    next();
  };
}

export { COMPRESSIBLE };
