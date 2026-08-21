import { z } from 'zod';
import { ErrorPayloadSchema } from './errors';

export const RootTypeSchema = z.enum(['FRAME', 'COMPONENT', 'INSTANCE']);
export type RootType = z.infer<typeof RootTypeSchema>;

export const RuntimeModeSchema = z.enum(['authenticated', 'public-test']);
export type RuntimeMode = z.infer<typeof RuntimeModeSchema>;

export const SheetValueSchema = z.object({
  id: z.string(),
  value: z.string(),
  row: z.number().int().positive(),
  cell: z.string(),
});
export type SheetValue = z.infer<typeof SheetValueSchema>;

export const SheetSourceSchema = z.object({
  cellUrl: z.string().url(),
  spreadsheetId: z.string(),
  spreadsheetTitle: z.string().optional(),
  sheetId: z.number().int(),
  sheetTitle: z.string(),
  startCell: z.string(),
  scannedThroughCell: z.string(),
  requestedCount: z.number().int().nonnegative(),
  fingerprint: z.string().length(64),
});
export type SheetSource = z.infer<typeof SheetSourceSchema>;

export const SheetCopyResponseSchema = z.object({
  source: SheetSourceSchema,
  values: z.array(SheetValueSchema),
  meta: z.object({
    requestedCount: z.number().int().nonnegative(),
    returnedCount: z.number().int().nonnegative(),
    scannedRowCount: z.number().int().nonnegative(),
    scanLimitReached: z.boolean(),
  }),
});
export type SheetCopyResponse = z.infer<typeof SheetCopyResponseSchema>;

export const SheetCopyRequestSchema = z.object({
  cellUrl: z.string().min(1),
  requestedCount: z.number().int().min(0).max(1000),
});
export type SheetCopyRequest = z.infer<typeof SheetCopyRequestSchema>;

export const SheetVerifyRequestSchema = SheetCopyRequestSchema.extend({
  expectedFingerprint: z.string().length(64),
});
export type SheetVerifyRequest = z.infer<typeof SheetVerifyRequestSchema>;

export const SheetVerifyResponseSchema = z.object({
  unchanged: z.boolean(),
  currentFingerprint: z.string().length(64),
});
export type SheetVerifyResponse = z.infer<typeof SheetVerifyResponseSchema>;

export const TargetSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  originalCharacters: z.string(),
  originalName: z.string(),
  originalAutoRename: z.boolean(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  visible: z.boolean(),
});
export type TargetSnapshot = z.infer<typeof TargetSnapshotSchema>;

export const ReviewedPairSchema = z.object({
  layerId: z.string(),
  replacementId: z.string(),
  value: z.string(),
});
export type ReviewedPair = z.infer<typeof ReviewedPairSchema>;

export const PreviewSnapshotSchema = z.object({
  token: z.string(),
  pageId: z.string(),
  rootId: z.string(),
  rootType: RootTypeSchema,
  rootName: z.string(),
  targets: z.array(TargetSnapshotSchema),
  createdAt: z.number(),
  applied: z.boolean(),
  applying: z.boolean().optional(),
  mode: RuntimeModeSchema,
  source: SheetSourceSchema.optional(),
});
export type PreviewSnapshot = z.infer<typeof PreviewSnapshotSchema>;

export const UserSchema = z.object({ email: z.string().email() });
export type User = z.infer<typeof UserSchema>;

export const AuthStartResponseSchema = z.object({
  flowId: z.string(),
  readKey: z.string(),
  browserUrl: z.string().url(),
  expiresAt: z.string(),
});
export type AuthStartResponse = z.infer<typeof AuthStartResponseSchema>;

export const AuthPollResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('complete'), sessionToken: z.string(), user: UserSchema }),
  z.object({ status: z.literal('failed'), error: ErrorPayloadSchema }),
]);
export type AuthPollResponse = z.infer<typeof AuthPollResponseSchema>;

export const SessionResponseSchema = z.object({ authenticated: z.literal(true), user: UserSchema });
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const AuthErrorResponseSchema = z.object({
  authenticated: z.literal(false),
  error: ErrorPayloadSchema.optional(),
});

export function buildFingerprintInput(input: {
  spreadsheetId: string;
  sheetId: number;
  startCell: string;
  requestedCount: number;
  values: Array<Pick<SheetValue, 'cell' | 'value'>>;
}): string {
  return JSON.stringify([
    input.spreadsheetId,
    input.sheetId,
    input.startCell,
    input.requestedCount,
    input.values.map((value) => [value.cell, value.value]),
  ]);
}
