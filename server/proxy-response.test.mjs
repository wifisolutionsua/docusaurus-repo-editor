import test from 'node:test';
import assert from 'node:assert/strict';
import {sendProxyError, sendSocketResponse} from './proxy-response.mjs';

test('sendProxyError handles an HTTP response', () => {
  const calls = [];
  const response = {
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers) {
      calls.push(['writeHead', status, headers]);
    },
    end(body) {
      calls.push(['end', body]);
    },
  };

  sendProxyError(new Error('not ready'), response);

  assert.equal(calls[0][1], 502);
  assert.match(calls[1][1], /not ready/);
});

test('sendProxyError handles a WebSocket socket', () => {
  let payload = '';
  const socket = {
    destroyed: false,
    end(value) {
      payload = value;
    },
  };

  sendProxyError(new Error('connection refused'), socket);

  assert.match(payload, /^HTTP\/1\.1 502 Bad Gateway/);
  assert.match(payload, /connection refused/);
});

test('sendSocketResponse ignores destroyed sockets', () => {
  let called = false;
  sendSocketResponse(
    {destroyed: true, end() { called = true; }},
    503,
    'Service Unavailable',
    'not ready',
  );
  assert.equal(called, false);
});
