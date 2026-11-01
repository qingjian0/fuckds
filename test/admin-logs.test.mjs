import test from 'node:test';
import assert from 'node:assert/strict';

import { createBufferedLogger, createLogBuffer } from '../src/admin/log-buffer.mjs';

test('log buffer is bounded, monotonic and supports incremental filtering', () => {
  const buffer = createLogBuffer({ maxEntries: 2 });
  buffer.append('info', 'one', ['first']);
  buffer.append('warn', 'two', ['second']);
  buffer.append('error', 'three', ['third']);

  const entries = buffer.list();
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.id), [2, 3]);
  assert.equal(buffer.list({ after: 2 }).length, 1);
  assert.equal(buffer.list({ level: 'warn' })[0].message, 'second');
});

test('log buffer redacts configured secrets, bearer strings and secret object fields', () => {
  const secret = 'raw-secret-token-1234567890';
  const buffer = createLogBuffer({ secrets: [secret] });
  buffer.append('info', 'auth', ['userToken=' + secret, 'Bearer abcdefghijklmnop']);
  buffer.append('warn', 'config', [{ apiKey: secret, cookie: 'session-secret', safe: 'visible' }]);

  const text = buffer.list().map((entry) => entry.message).join('\n');
  assert.ok(!text.includes(secret));
  assert.ok(!text.includes('abcdefghijklmnop'));
  assert.match(text, /Bearer \[REDACTED\]/);
  assert.match(text, /apiKey.*REDACTED/);
  assert.match(text, /visible/);
});

test('buffered logger preserves scope and does not capture below configured log level', () => {
  const buffer = createLogBuffer();
  const emitted = [];
  function makeLogger(scope = '') {
    return {
      level: 'info',
      info: (...args) => emitted.push({ level: 'info', scope, args }),
      warn: (...args) => emitted.push({ level: 'warn', scope, args }),
      error: (...args) => emitted.push({ level: 'error', scope, args }),
      debug: (...args) => emitted.push({ level: 'debug', scope, args }),
      trace: (...args) => emitted.push({ level: 'trace', scope, args }),
      child: (name) => makeLogger(scope ? scope + ':' + name : name),
    };
  }
  const logger = createBufferedLogger(makeLogger(), buffer);
  logger.info('hello');
  logger.child('http').warn('request failed');
  logger.debug('not emitted by info-level logger');

  assert.equal(emitted.length, 3);
  assert.equal(buffer.list().length, 2);
  assert.equal(buffer.list()[1].scope, 'http');
});
