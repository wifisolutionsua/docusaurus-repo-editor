export function sendProxyError(error, target) {
  if (!target) return;

  const body = `Docusaurus preview is starting: ${error.message}`;

  if (typeof target.writeHead === 'function' && typeof target.end === 'function') {
    if (!target.headersSent) {
      target.writeHead(502, {'Content-Type': 'text/plain'});
    }
    if (!target.writableEnded) {
      target.end(body);
    }
    return;
  }

  sendSocketResponse(target, 502, 'Bad Gateway', body);
}

export function sendSocketResponse(socket, statusCode, statusText, body) {
  if (!socket || socket.destroyed || typeof socket.end !== 'function') return;

  const payload = String(body);
  socket.end(
    `HTTP/1.1 ${statusCode} ${statusText}\r\n`
    + 'Connection: close\r\n'
    + 'Content-Type: text/plain; charset=utf-8\r\n'
    + `Content-Length: ${Buffer.byteLength(payload)}\r\n`
    + '\r\n'
    + payload,
  );
}
