export class CircuitOpenError extends Error {
  constructor(name, retryAt) { super(`${name} circuit is open`); this.name = 'CircuitOpenError'; this.code = 'CIRCUIT_OPEN'; this.retryAt = retryAt; }
}

export class CircuitBreaker {
  constructor({ name = 'dependency', failureThreshold = 3, openMs = 10_000, now = () => Date.now() } = {}) {
    this.name = name; this.failureThreshold = failureThreshold; this.openMs = openMs; this.now = now;
    this.failures = 0; this.openUntil = 0; this.probing = false;
  }
  async acquire() {
    if (this.openUntil > this.now()) throw new CircuitOpenError(this.name, this.openUntil);
    if (this.openUntil && !this.probing) { this.probing = true; return; }
    if (this.probing) throw new CircuitOpenError(this.name, this.now() + this.openMs);
  }
  success() { this.failures = 0; this.openUntil = 0; this.probing = false; }
  failure() {
    this.probing = false;
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openUntil = this.now() + this.openMs;
  }
  snapshot() { return { state: this.openUntil > this.now() ? 'open' : this.probing ? 'half_open' : 'closed', failures: this.failures, open_until: this.openUntil || null }; }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetriesAndCircuit(operation, {
  name = 'dependency', timeoutMs = 5_000, deadlineMs = timeoutMs,
  maxAttempts = 3, baseDelayMs = 100, maxDelayMs = 1_500,
  random = Math.random, sleepImpl = sleep, circuitBreaker = null,
  shouldRetry = (error) => error?.retryable !== false && error?.code !== 'CIRCUIT_OPEN'
} = {}) {
  const started = Date.now();
  await circuitBreaker?.acquire();
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const remaining = deadlineMs - (Date.now() - started);
    if (remaining <= 0) break;
    const controller = new AbortController();
    const callTimeout = Math.min(timeoutMs, remaining);
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); const error = new Error(`${name} call timed out`); error.code = 'CALL_TIMEOUT'; reject(error); }, callTimeout);
      });
      const result = await Promise.race([Promise.resolve().then(() => operation({ signal: controller.signal, attempt, timeoutMs: callTimeout })), timeout]);
      circuitBreaker?.success();
      return result;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error)) break;
      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const delay = Math.floor(exponential * (0.5 + Math.max(0, Math.min(1, random()))));
      if (Date.now() - started + delay >= deadlineMs) break;
      await sleepImpl(delay);
    } finally { clearTimeout(timer); }
  }
  circuitBreaker?.failure();
  throw lastError || new Error(`${name} call deadline exceeded`);
}
