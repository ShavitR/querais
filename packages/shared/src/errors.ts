/**
 * Typed error hierarchy shared across layers. Each carries a stable `code` and an
 * HTTP `status` so the gateway can translate them into OpenAI-style error responses.
 */
export class QueraisError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

/** Bad/missing API key or signature. */
export class AuthError extends QueraisError {
  constructor(message = 'Unauthorized') {
    super(message, 'unauthorized', 401);
  }
}

/** Request failed schema validation. */
export class ValidationError extends QueraisError {
  constructor(message: string) {
    super(message, 'invalid_request', 400);
  }
}

/** No node can serve the requested model within the requester's constraints. */
export class NoEligibleNodesError extends QueraisError {
  constructor(message = 'No eligible nodes available for this request') {
    super(message, 'no_eligible_nodes', 503);
  }
}

/** A result failed Layer-B verification (empty, malformed, looping, hash mismatch). */
export class VerificationError extends QueraisError {
  constructor(message: string) {
    super(message, 'verification_failed', 502);
  }
}

/** The assigned node did not complete the job before its deadline. */
export class JobTimeoutError extends QueraisError {
  constructor(message = 'Job timed out') {
    super(message, 'job_timeout', 504);
  }
}
