// PhotoLynk Mobile App - Utility Functions

// Sleep helper
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Retry with exponential backoff (capped at maxDelayMs)
export const withRetries = async (fn, { retries, baseDelayMs, shouldRetry, maxDelayMs = 30000 }) => {
  const n = Math.max(0, Number(retries) || 0);
  const base = Math.max(0, Number(baseDelayMs) || 0);
  const maxDelay = Math.max(base, Number(maxDelayMs) || 30000);
  let lastErr = null;
  for (let attempt = 0; attempt <= n; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const ok = attempt < n && (typeof shouldRetry === 'function' ? shouldRetry(e) : true);
      if (!ok) break;
      // Exponential backoff with jitter, capped at maxDelay
      const expDelay = base * Math.pow(2, attempt);
      const jitter = Math.random() * 0.3 * expDelay; // 0-30% jitter
      const delay = Math.min(expDelay + jitter, maxDelay);
      await sleep(delay);
    }
  }
  throw lastErr;
};

// Check if chunk upload error is retryable - very aggressive, retry almost everything
export const shouldRetryChunkUpload = (e) => {
  const msg = (e && e.message ? e.message : '').toLowerCase();
  // Only give up on authentication errors (401/403) or permanent client errors (400)
  if (msg.includes(' 401') || msg.includes(' 403') || msg.includes('unauthorized') || msg.includes('forbidden')) return false;
  if (msg.includes(' 400') && !msg.includes('timeout')) return false;
  // Retry everything else: network issues, server errors, timeouts, etc.
  return true;
};

// Normalize file path (strip file:// prefix and query params)
export const normalizeFilePath = (uri) => {
  if (!uri || typeof uri !== 'string') return null;
  let s = uri;
  if (s.startsWith('file://')) s = s.replace('file://', '');
  s = s.split('#')[0];
  s = s.split('?')[0];
  return s;
};

// Create chunk nonce from base nonce and chunk index
export const makeChunkNonce = (baseNonce16, chunkIndex) => {
  const nonce = new Uint8Array(24);
  nonce.set(baseNonce16, 0);
  let x = BigInt(chunkIndex);
  for (let i = 0; i < 8; i++) {
    nonce[16 + i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return nonce;
};

// Sanitize headers object (remove null/undefined values)
export const sanitizeHeaders = (headers) => {
  const out = {};
  const src = headers && typeof headers === 'object' ? headers : {};
  for (const [k, v] of Object.entries(src)) {
    if (v === undefined || v === null) continue;
    out[k] = String(v);
  }
  return out;
};

// Strip Content-Type header
export const stripContentType = (headers) => {
  const out = { ...(headers || {}) };
  for (const k of Object.keys(out)) {
    if (k.toLowerCase() === 'content-type') delete out[k];
  }
  return out;
};

// Normalize host input (strip protocol, port, path)
export const normalizeHostInput = (value) => {
  const raw = (value || '').trim();
  if (!raw) return '';
  let cleaned = raw.replace(/^https?:\/\//i, '');
  cleaned = cleaned.split('/')[0].split('?')[0].split('#')[0].replace(/:\d+$/, '');
  return cleaned;
};

// Compute server URL from type and host values
export const computeServerUrl = (type, localHostValue, remoteHostValue) => {
  const PORT = '3000';
  if (type === 'stealthcloud') return 'https://stealthlynk.io';
  const host = normalizeHostInput(type === 'remote' ? remoteHostValue : localHostValue);
  if (type === 'remote') return host ? `https://${host}:${PORT}` : `https://localhost:${PORT}`;
  return `http://${host || 'localhost'}:${PORT}`;
};

// Format bytes to human readable (MB/GB/TB)
export const formatBytes = (bytes, decimal = false) => {
  const n = typeof bytes === 'number' ? bytes : (bytes ? Number(bytes) : 0);
  if (!n || Number.isNaN(n) || n <= 0) return '0 MB';
  const divisor = decimal ? 1000 : 1024;
  const mb = n / (divisor * divisor);
  if (mb < divisor) return `${mb.toFixed(decimal ? 0 : 0)} MB`;
  const gb = mb / divisor;
  if (gb < divisor) return `${gb.toFixed(2)} GB`;
  const tb = gb / divisor;
  return `${tb.toFixed(2)} TB`;
};

// Normalize filename for comparison
export const normalizeFilenameForCompare = (name) => {
  if (!name || typeof name !== 'string') return null;
  const s = name.split('?')[0];
  const parts = s.split('/');
  const base = parts.length ? parts[parts.length - 1] : s;
  const trimmed = base.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
};

// Normalize email for device UUID generation
export const normalizeEmailForDeviceUuid = (value) => {
  const raw = value == null ? '' : String(value);
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
};
