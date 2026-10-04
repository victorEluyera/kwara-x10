import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { csvLine, streamCsv } from './csv-export.js';

test('CSV preserves quotes, commas, multiline text and uses Windows line endings', () => {
  assert.equal(csvLine(['a,b', 'a"b', 'a\rb', '0012345678', null]), '"a,b","a""b","a\rb",0012345678,\r\n');
  assert.equal(csvLine(['=SUM(A1)', '+234123', '@value', '-formula']), "'=SUM(A1),'+234123,'@value,'-formula\r\n");
});
test('large exports emit a UTF-8 BOM, all rows and respect backpressure', async () => {
  const response = new EventEmitter();
  const chunks = [];
  response.write = chunk => { chunks.push(chunk); queueMicrotask(() => response.emit('drain')); return false; };
  response.end = () => { response.ended = true; };
  const rows = Array.from({length:1201}, (_,id) => ({id}));
  await streamCsv(response, rows, ['id','label'], row => ({...row,label:'Member ' + row.id}));
  assert.equal(chunks.length, 4);
  assert.ok(chunks[0].startsWith('\uFEFF'));
  assert.ok(chunks.join('').endsWith('1200,Member 1200\r\n'));
  assert.equal(response.ended, true);
  assert.equal(response.listenerCount('close'), 0);
});
test('cancelled downloads stop streaming', async () => {
  const response = new EventEmitter();
  response.write = () => { queueMicrotask(() => response.emit('close')); return false; };
  response.end = () => assert.fail('cancelled response must not be ended');
  await streamCsv(response, [{id:1}], ['id']);
});
