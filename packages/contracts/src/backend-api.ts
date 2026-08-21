import { z } from 'zod';
import {
  AuthPollResponseSchema,
  AuthStartResponseSchema,
  SheetCopyRequestSchema,
  SheetCopyResponseSchema,
  SheetVerifyRequestSchema,
  SheetVerifyResponseSchema,
  SessionResponseSchema,
} from './models';
import { ErrorPayloadSchema } from './errors';

export const BackendErrorResponseSchema = z.object({ error: ErrorPayloadSchema });
export const BackendSchemas = {
  authStart: AuthStartResponseSchema,
  authPoll: AuthPollResponseSchema,
  session: SessionResponseSchema,
  copyRequest: SheetCopyRequestSchema,
  copyResponse: SheetCopyResponseSchema,
  verifyRequest: SheetVerifyRequestSchema,
  verifyResponse: SheetVerifyResponseSchema,
  error: BackendErrorResponseSchema,
};
