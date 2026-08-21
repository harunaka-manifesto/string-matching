import { z } from 'zod';
import {
  ReviewedPairSchema,
  RuntimeModeSchema,
  SheetCopyResponseSchema,
  TargetSnapshotSchema,
  UserSchema,
} from './models';
import { ErrorPayloadSchema } from './errors';

const requestId = z.string().min(1);

export const UiToPluginMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('auth:check') }),
  z.object({ type: z.literal('auth:start') }),
  z.object({ type: z.literal('auth:poll-tick') }),
  z.object({ type: z.literal('auth:cancel') }),
  z.object({ type: z.literal('auth:enter-public-test') }),
  z.object({ type: z.literal('auth:exit-public-test') }),
  z.object({ type: z.literal('auth:logout') }),
  z.object({ type: z.literal('auth:disconnect') }),
  z.object({ type: z.literal('get-selection-state') }),
  z.object({
    type: z.literal('fetch-preview'),
    payload: z.object({ requestId, cellUrl: z.string(), mode: RuntimeModeSchema }),
  }),
  z.object({ type: z.literal('cancel-fetch'), payload: z.object({ requestId }) }),
  z.object({
    type: z.literal('refresh-preview'),
    payload: z.object({
      requestId,
      previewToken: z.string(),
      cellUrl: z.string(),
      mode: RuntimeModeSchema,
    }),
  }),
  z.object({ type: z.literal('discard-preview'), payload: z.object({ previewToken: z.string() }) }),
  z.object({
    type: z.literal('apply-reviewed-pairs'),
    payload: z.object({ previewToken: z.string(), pairs: z.array(ReviewedPairSchema) }),
  }),
  z.object({
    type: z.literal('select-node'),
    payload: z.object({ previewToken: z.string(), layerId: z.string() }),
  }),
  z.object({
    type: z.literal('preview-target'),
    payload: z.object({ previewToken: z.string(), layerId: z.string().nullable() }),
  }),
]);
export type UiToPluginMessage = z.infer<typeof UiToPluginMessageSchema>;

export const PluginToUiMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth-state'),
    enabledPublicTestMode: z.boolean(),
    authenticated: z.boolean(),
    user: UserSchema.optional(),
    mode: RuntimeModeSchema.optional(),
  }),
  z.object({ type: z.literal('auth-started'), flowId: z.string(), expiresAt: z.string() }),
  z.object({
    type: z.literal('auth-poll'),
    status: z.enum(['pending', 'complete', 'failed']),
    user: UserSchema.optional(),
    error: ErrorPayloadSchema.optional(),
  }),
  z.object({ type: z.literal('auth-cancelled') }),
  z.object({
    type: z.literal('selection-state'),
    selection: z
      .object({
        containerId: z.string(),
        containerName: z.string(),
        containerType: z.string(),
        visibleTextCount: z.number(),
      })
      .nullable(),
    valid: z.boolean(),
    count: z.number(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal('preview-ready'),
    requestId,
    previewToken: z.string(),
    selection: z.object({
      containerId: z.string(),
      containerName: z.string(),
      containerType: z.string(),
      visibleTextCount: z.number(),
    }),
    targets: z.array(TargetSnapshotSchema),
    source: SheetCopyResponseSchema.shape.source,
    values: SheetCopyResponseSchema.shape.values,
    partial: z.boolean(),
  }),
  z.object({
    type: z.literal('preview-stale'),
    previewToken: z.string(),
    kind: z.enum(['figma', 'source']),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('apply-reviewed-pairs-result'),
    previewToken: z.string(),
    ok: z.boolean(),
    result: z.object({ appliedCount: z.number(), layerIds: z.array(z.string()) }).optional(),
    error: ErrorPayloadSchema.optional(),
  }),
  z.object({
    type: z.literal('error'),
    requestId: requestId.optional(),
    error: ErrorPayloadSchema,
  }),
]);
export type PluginToUiMessage = z.infer<typeof PluginToUiMessageSchema>;
