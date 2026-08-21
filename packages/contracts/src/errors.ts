import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'AUTH_FLOW_EXPIRED',
  'AUTH_CANCELLED',
  'AUTH_DOMAIN_NOT_ALLOWED',
  'AUTH_RECONNECT_REQUIRED',
  'AUTH_FAILED',
  'SHEET_URL_INVALID',
  'SHEET_ACCESS_DENIED',
  'SHEET_NOT_FOUND',
  'SHEET_TAB_NOT_FOUND',
  'SHEET_READ_FAILED',
  'SHEET_SCAN_LIMIT_REACHED',
  'SHEET_RATE_LIMITED',
  'SOURCE_STALE',
  'INVALID_SELECTION_COUNT',
  'UNSUPPORTED_SELECTION',
  'NO_ELIGIBLE_TEXT',
  'PREVIEW_NOT_FOUND',
  'PREVIEW_STALE',
  'PREVIEW_ALREADY_APPLIED',
  'LOCKED_LAYER',
  'FONT_LOAD_FAILED',
  'APPLY_FAILED',
  'ROLLBACK_FAILED',
  'INVALID_REQUEST',
  'INTERNAL_ERROR',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorPayloadSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  requestId: z.string().optional(),
});

export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly statusCode: number;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    statusCode?: number,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode ?? defaultStatus(code);
  }

  toPayload(requestId?: string): ErrorPayload {
    return { code: this.code, message: this.message, details: this.details, requestId };
  }
}

function defaultStatus(code: ErrorCode): number {
  if (code === 'AUTH_REQUIRED' || code === 'AUTH_RECONNECT_REQUIRED') return 401;
  if (code === 'AUTH_DOMAIN_NOT_ALLOWED' || code === 'SHEET_ACCESS_DENIED') return 403;
  if (code === 'SHEET_NOT_FOUND' || code === 'SHEET_TAB_NOT_FOUND' || code === 'PREVIEW_NOT_FOUND')
    return 404;
  if (code === 'SHEET_RATE_LIMITED') return 429;
  if (code === 'INVALID_REQUEST' || code === 'SHEET_URL_INVALID') return 400;
  return 422;
}
