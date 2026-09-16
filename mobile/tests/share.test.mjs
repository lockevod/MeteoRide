// POST /share stores whatever anyone sends in KV, so its size limit is the only thing
// bounding memory and storage. It used to compare `raw.length` — UTF-16 units, not
// bytes — and only after reading the whole body, so a multibyte payload with no
// Content-Length got past the limit and an endless one was read to the end first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../functions/share.js');
// The function is an ES module in a directory with no package.json; load it as one.
const { onRequest } = await import('data:text/javascript;base64,' +
  Buffer.from(await readFile(SRC, 'utf8')).toString('base64'));

const MAX_BYTES = 2_500_000;

function kv() {
  const store = new Map();
  return {
    store,
    put: async (id, data) => { store.set(id, data); },
    get: async (id) => store.get(id) ?? null
  };
}

const post = (body, headers = {}) => new Request('https://example.test/share',
  { method: 'POST', body, headers, duplex: 'half' });

test('a multibyte text body over the byte limit is refused without writing', async () => {
  const env = { SHARED_GPX: kv() };
  // 2.52 MB of UTF-8 in 1.26 million characters: over the limit in bytes, under it in
  // characters, and inside the read allowance so it is the byte count that refuses it.
  const request = post('<gpx>' + 'é'.repeat(1_260_000) + '</gpx>');
  assert.equal(request.headers.has('content-length'), false);
  const res = await onRequest({ request, env });
  assert.equal(res.status, 413);
  assert.equal(env.SHARED_GPX.store.size, 0);
});

test('a multipart file over the byte limit is refused without writing', async () => {
  const env = { SHARED_GPX: kv() };
  const form = new FormData();
  form.append('file', new File(['<gpx>' + 'é'.repeat(1_260_000) + '</gpx>'], 'r.gpx'));
  const request = post(form);
  assert.equal(request.headers.has('content-length'), false);
  const res = await onRequest({ request, env });
  assert.equal(res.status, 413);
  assert.equal(env.SHARED_GPX.store.size, 0);
});

test('an oversized body is not read past the limit', async () => {
  const env = { SHARED_GPX: kv() };
  const chunk = new TextEncoder().encode('<gpx>' + 'x'.repeat(999_995));
  let pulled = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulled++;
      if (pulled > 20) controller.close(); else controller.enqueue(chunk);
    }
  });
  const res = await onRequest({ request: post(body), env });
  assert.equal(res.status, 413);
  assert.equal(env.SHARED_GPX.store.size, 0);
  // 1 MB chunks against a 2.5 MB limit: the third one crosses it. Allow the stream's
  // own read-ahead, but not reading all twenty.
  assert.ok(pulled <= 5, `read ${pulled} MB before refusing`);
});

test('ordinary routes are still stored, as text and as multipart', async () => {
  const gpx = '<?xml version="1.0"?><gpx><trk><name>Montseny ñ</name></trk></gpx>';

  const text = { SHARED_GPX: kv() };
  assert.equal((await onRequest({ request: post(gpx), env: text })).status, 201);
  assert.deepEqual([...text.SHARED_GPX.store.values()], [gpx]);

  const multi = { SHARED_GPX: kv() };
  const form = new FormData();
  form.append('file', new File([gpx], 'r.gpx'));
  assert.equal((await onRequest({ request: post(form), env: multi })).status, 201);
  assert.deepEqual([...multi.SHARED_GPX.store.values()], [gpx]);
});

test('a file exactly at the limit is accepted, one byte over is not', async () => {
  const body = (n) => '<gpx>' + 'x'.repeat(n - 11) + '</gpx>';
  const ok = { SHARED_GPX: kv() };
  assert.equal((await onRequest({ request: post(body(MAX_BYTES)), env: ok })).status, 201);
  const over = { SHARED_GPX: kv() };
  assert.equal((await onRequest({ request: post(body(MAX_BYTES + 1)), env: over })).status, 413);

  // Inside multipart the envelope has its own allowance, so the file is checked apart.
  const form = new FormData();
  form.append('file', new File([body(MAX_BYTES + 1)], 'r.gpx'));
  const multi = { SHARED_GPX: kv() };
  assert.equal((await onRequest({ request: post(form), env: multi })).status, 413);
  assert.equal(multi.SHARED_GPX.store.size, 0);
});

// Decoding replaces every invalid byte with U+FFFD, three bytes each: 2.5 MB of 0xFF
// read under the limit used to be stored as 7.5 MB.
function notUtf8() {
  const bytes = new Uint8Array(MAX_BYTES);
  bytes.set(new TextEncoder().encode('<gpx>'));
  return bytes.fill(0xff, 5);
}

test('a text body that is not UTF-8 is refused without writing', async () => {
  const env = { SHARED_GPX: kv() };
  const res = await onRequest({ request: post(notUtf8()), env });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(env.SHARED_GPX.store.size, 0);
});

test('a multipart file that is not UTF-8 is refused without writing', async () => {
  const form = new FormData();
  form.append('file', new File([notUtf8()], 'r.gpx'));
  const env = { SHARED_GPX: kv() };
  const res = await onRequest({ request: post(form), env });
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.equal(env.SHARED_GPX.store.size, 0);
});

test('a multipart file of exactly the limit fits inside the envelope allowance', async () => {
  const gpx = '<gpx>' + 'x'.repeat(MAX_BYTES - 11) + '</gpx>';
  const form = new FormData();
  form.append('file', new File([gpx], 'r.gpx'));
  const env = { SHARED_GPX: kv() };
  assert.equal((await onRequest({ request: post(form), env })).status, 201);
  assert.equal([...env.SHARED_GPX.store.values()][0].length, MAX_BYTES);
});

test('a declared Content-Length over the allowance is refused before reading', async () => {
  const env = { SHARED_GPX: kv() };
  const request = post('<gpx></gpx>', { 'content-length': String(MAX_BYTES + 64_000 + 1) });
  assert.equal(request.headers.get('content-length'), '2564001');
  const res = await onRequest({ request, env });
  assert.equal(res.status, 413);
  assert.equal(env.SHARED_GPX.store.size, 0);
});

test('an oversized body whose cancel fails is still refused as too large', async () => {
  const chunk = new TextEncoder().encode('<gpx>' + 'x'.repeat(999_995));
  const body = new ReadableStream({
    pull(controller) { controller.enqueue(chunk); },
    cancel() { throw new Error('cancel failed'); }
  });
  const env = { SHARED_GPX: kv() };
  assert.equal((await onRequest({ request: post(body), env })).status, 413);
  assert.equal(env.SHARED_GPX.store.size, 0);
});
