const MAX_SSE_FRAME_BYTES = 128 * 1024;
const MAX_SSE_CONTENT_BYTES = 2 * 1024 * 1024;

// Incrementally decodes UTF-8 and SSE frames without retaining more than one bounded frame.
async function readSseEvents(body, onEvent, signal, onFirstByte, onBodyEnd) {
  if (!body || typeof body.getReader !== 'function') throw new Error('BEDROCK_STREAM_UNAVAILABLE');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let totalBytes = 0;
  let ended = false;
  let sourceDone = false;
  let reportedBodyEnd = false;
  const reportBodyEnd = () => {
    if (reportedBodyEnd) return;
    reportedBodyEnd = true;
    onBodyEnd?.(totalBytes);
  };
  const dispatchFrames = async text => {
    pending += text;
    // CRLF and LF delimiters may be split across network chunks, so retain incomplete tails.
    while (true) {
      const match = /\r?\n\r?\n/.exec(pending);
      if (!match) {
        if (Buffer.byteLength(pending, 'utf8') > MAX_SSE_FRAME_BYTES) throw new Error('BEDROCK_STREAM_FRAME_TOO_LARGE');
        break;
      }
      const frame = pending.slice(0, match.index);
      if (Buffer.byteLength(frame, 'utf8') > MAX_SSE_FRAME_BYTES) throw new Error('BEDROCK_STREAM_FRAME_TOO_LARGE');
      pending = pending.slice(match.index + match[0].length);
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart()).join('\n');
      if (!data) continue;
      if (data === '[DONE]') { ended = true; reportBodyEnd(); return; }
      let event;
      try { event = JSON.parse(data); } catch { throw new Error('BEDROCK_STREAM_INVALID_EVENT'); }
      await onEvent(event, data);
    }
  };
  const abortReader = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', abortReader, { once: true });
  try {
    while (!ended) {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const { value, done } = await reader.read();
      if (done) { sourceDone = true; reportBodyEnd(); break; }
      if (value.byteLength && totalBytes === 0) onFirstByte?.();
      totalBytes += value.byteLength;
      if (totalBytes > MAX_SSE_CONTENT_BYTES) throw new Error('BEDROCK_STREAM_TOO_LARGE');
      let text;
      try { text = decoder.decode(value, { stream: true }); } catch { throw new Error('BEDROCK_STREAM_INVALID_UTF8'); }
      await dispatchFrames(text);
    }
    if (!ended) {
      let tail;
      try { tail = decoder.decode(); } catch { throw new Error('BEDROCK_STREAM_INVALID_UTF8'); }
      await dispatchFrames(tail);
      if (pending.trim()) throw new Error('BEDROCK_STREAM_INCOMPLETE_FRAME');
      throw new Error('BEDROCK_STREAM_MISSING_DONE');
    }
    return { totalBytes };
  } finally {
    signal?.removeEventListener('abort', abortReader);
    if (!sourceDone) await reader.cancel().catch(() => {});
    reader.releaseLock?.();
  }
}

module.exports = { MAX_SSE_FRAME_BYTES, MAX_SSE_CONTENT_BYTES, readSseEvents };
