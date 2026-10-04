// Where uploaded files go.
//
// App Platform containers have an ephemeral filesystem: anything written to
// local disk is gone on the next deploy or restart. That is fine for a CSV
// that is parsed and discarded, and fatal for project evidence photos someone
// is meant to look at next month.
//
// So this picks a backend at startup:
//
//   - Spaces (S3-compatible object storage) when SPACES_* is configured.
//     Durable. This is what production should use.
//   - Local disk otherwise, with a loud warning. Keeps local development
//     working with no cloud account, and keeps the app running rather than
//     refusing uploads if someone deploys before the bucket exists.
//
// Switching is a config change, not a code change -- nothing that calls
// storePublicFile needs to know which one is active.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const {
  SPACES_KEY, SPACES_SECRET, SPACES_BUCKET,
  SPACES_REGION = 'lon1',
  SPACES_ENDPOINT,
} = process.env;

export const spacesConfigured = Boolean(SPACES_KEY && SPACES_SECRET && SPACES_BUCKET);

const endpoint = SPACES_ENDPOINT || `https://${SPACES_REGION}.digitaloceanspaces.com`;

/** Random name, original extension. Never trust the uploader's filename. */
function safeName(originalName, allowedExt) {
  const ext = path.extname(originalName || '').toLowerCase();
  return crypto.randomBytes(16).toString('hex') + (allowedExt.has(ext) ? ext : '.bin');
}

/* ------------------------------ S3 signing -------------------------------- */
// Implemented directly rather than pulling in the AWS SDK: this needs exactly
// one operation (PUT an object), and the SDK is tens of megabytes.

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function signedPutHeaders({ bucket, key, body, contentType, host }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256(body);

  const canonicalHeaders =
    `content-type:${contentType}\n`
    + `host:${host}\n`
    + `x-amz-acl:public-read\n`
    + `x-amz-content-sha256:${payloadHash}\n`
    + `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-acl;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = ['PUT', `/${bucket}/${key}`, '', canonicalHeaders,
    signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${SPACES_REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  let signingKey = hmac('AWS4' + SPACES_SECRET, dateStamp);
  for (const part of [SPACES_REGION, 's3', 'aws4_request']) signingKey = hmac(signingKey, part);
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${SPACES_KEY}/${scope}, `
      + `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'content-type': contentType,
    'x-amz-acl': 'public-read',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
}

/* -------------------------------- public ---------------------------------- */

/**
 * Store a file and return a URL that will still work next month.
 *
 * @param buffer        file contents
 * @param originalName  only its extension is used
 * @param contentType   sent to the browser on retrieval
 * @param opts.prefix   folder within the bucket, e.g. "projects"
 * @param opts.localDir where to write when Spaces is not configured
 * @param opts.publicPath URL prefix that serves localDir
 * @param opts.allowedExt Set of permitted extensions
 */
export async function storePublicFile(buffer, originalName, contentType, opts) {
  const { prefix = 'uploads', localDir, publicPath = '/uploads', allowedExt } = opts;
  const name = safeName(originalName, allowedExt);
  const key = `${prefix}/${name}`;

  if (!spacesConfigured) {
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(path.join(localDir, name), buffer);
    return { url: `${publicPath}/${name}`, durable: false };
  }

  const host = new URL(endpoint).host;
  const headers = signedPutHeaders({ bucket: SPACES_BUCKET, key, body: buffer, contentType, host });
  const response = await fetch(`${endpoint}/${SPACES_BUCKET}/${key}`, {
    method: 'PUT', body: buffer, headers,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error('Upload to Spaces failed (' + response.status + '): ' + detail.slice(0, 200));
  }
  return { url: `${endpoint}/${SPACES_BUCKET}/${key}`, durable: true };
}

/** Printed once at boot so nobody discovers this from a missing photo. */
export function warnIfNotDurable() {
  if (spacesConfigured) {
    console.log('Uploads: DigitalOcean Spaces (' + SPACES_BUCKET + ')');
    return;
  }
  console.warn('WARNING: uploads are being written to local disk.');
  console.warn('  On a host with an ephemeral filesystem they are LOST on every deploy.');
  console.warn('  Set SPACES_KEY, SPACES_SECRET and SPACES_BUCKET to store them durably.');
}
