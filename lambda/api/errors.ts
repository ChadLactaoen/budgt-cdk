export type ErrorCode =
  | 'MALFORMED_BODY'
  | 'VALIDATION'
  | 'UNKNOWN_CATEGORY'
  | 'UNKNOWN_FUND'
  | 'DUPLICATE_ALLOCATION'
  | 'ALLOCATION_SUM_MISMATCH'
  | 'TOO_MANY_ALLOCATIONS'
  | 'NOT_FOUND'
  | 'NO_PERIOD'
  | 'FUND_OVERDRAW'
  | 'CONCURRENT_MODIFICATION'
  | 'TS_COLLISION'
  | 'INTERNAL';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly detail?: Record<string, unknown>;

  constructor(status: number, code: ErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const badRequest = (code: ErrorCode, message: string, detail?: Record<string, unknown>) =>
  new ApiError(400, code, message, detail);

export const notFound = (message: string) => new ApiError(404, 'NOT_FOUND', message);

export const conflict = (code: ErrorCode, message: string, detail?: Record<string, unknown>) =>
  new ApiError(409, code, message, detail);
