import { z } from 'zod';
import { LayerDecisionSchema } from './models';

export const LocaleSchema = z.enum(['en', 'id']);
export type Locale = z.infer<typeof LocaleSchema>;
export const CopyContextSchema = z.object({
  feature: z.string().default(''),
  screen: z.string().default(''),
  context: z.string().default(''),
  role: z.string(),
  qualifier: z.enum(['primary', 'secondary', 'tertiary']).optional(),
  note: z.string().default(''),
});
export const CopyRecordSchema = z.object({
  copyId: z.string().regex(/^cp_[0-7][0-9A-HJKMNP-TV-Z]{25}$/u),
  platformKey: z.string(),
  revision: z.number().int().positive(),
  en: z.string(),
  id: z.string(),
  product: z.string(),
  context: CopyContextSchema,
  status: z
    .enum(['active', 'deprecated', 'archived', 'held', 'merged', 'deleted', 'draft'])
    .default('active'),
  forkedFrom: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  mergedInto: z.string().nullable().optional(),
  legacy: z.record(z.unknown()).optional(),
});
export type CopyRecord = z.infer<typeof CopyRecordSchema>;
export const ProductConfigSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  keyToken: z.string().regex(/^[a-z0-9]+$/u),
  legacyGroups: z.array(z.string()).default([]),
});
export type ProductConfig = z.infer<typeof ProductConfigSchema>;
export const MappingSchema = z.object({
  libraryId: z.string(),
  copyId: z.string(),
  variableKey: z.string(),
  variableId: z.string(),
  syncedRevision: z.number().int(),
  publishedRevision: z.number().int().nullable(),
  fingerprint: z.string(),
});
export type LibraryMapping = z.infer<typeof MappingSchema>;
export const CatalogSchema = z.object({
  seq: z.number().int(),
  records: z.array(CopyRecordSchema),
  products: z.array(ProductConfigSchema),
  mappings: z.array(MappingSchema).default([]),
});
export type Catalog = z.infer<typeof CatalogSchema>;
const create = z.object({
  action: z.literal('create'),
  copyId: z.string(),
  product: z.string(),
  context: CopyContextSchema,
  en: z.string(),
  id: z.string(),
  forkedFrom: z.string().optional(),
});
const edit = z.object({
  action: z.literal('edit'),
  copyId: z.string(),
  expectedRevision: z.number().int().positive(),
  context: CopyContextSchema,
  en: z.string(),
  id: z.string(),
});
const reuse = z.object({
  action: z.literal('reuse'),
  copyId: z.string(),
  expectedRevision: z.number().int().positive(),
});
export const MutationSchema = z.discriminatedUnion('action', [create, edit, reuse]);
export type Mutation = z.infer<typeof MutationSchema>;
export const MutationBatchSchema = z.object({
  requestId: z.string().min(8).max(128),
  operations: z.array(MutationSchema).min(1).max(1000),
  attribution: z.object({ deviceId: z.string(), name: z.string().optional() }).optional(),
});
export type MutationBatch = z.infer<typeof MutationBatchSchema>;
export const MutationResultSchema = z.object({
  requestId: z.string(),
  records: z.array(CopyRecordSchema),
  seq: z.number().int(),
});
export type MutationResult = z.infer<typeof MutationResultSchema>;
export const TargetSchema = z.object({
  nodeId: z.string(),
  sourceId: z.string(),
  copyId: z.string(),
  locale: LocaleSchema,
  fingerprint: z.string(),
  variableFingerprint: z.string().optional(),
  frameName: z.string(),
  layerName: z.string().optional(),
  duplicate: z.boolean(),
});
export type BindingTarget = z.infer<typeof TargetSchema>;
export const BindingResultSchema = z.object({
  applied: z.array(z.string()),
  failures: z.array(z.object({ nodeId: z.string(), reason: z.string() })),
  conflicts: z.array(z.string()),
});
export type BindingResult = z.infer<typeof BindingResultSchema>;
export const ApplyPreviewSchema = z.object({
  sources: z.array(z.object({ nodeId: z.string(), fingerprint: z.string() })),
  targets: z.array(
    z.object({
      nodeId: z.string(),
      sourceId: z.string(),
      fingerprint: z.string(),
      frameName: z.string(),
      layerName: z.string().optional(),
      /** Whether applying changes this target, or it already matches its source. */
      change: z.enum(['bind', 'skip', 'none']).optional(),
    }),
  ),
});
export type ApplyPreview = z.infer<typeof ApplyPreviewSchema>;

export const DraftRowSchema = z.object({
  layerId: z.string(),
  /** Canvas text when the row was drafted; a rename alone is not a canvas change. */
  canvasText: z.string().optional(),
  action: z.enum(['keep', 'create', 'reuse', 'edit', 'variant']),
  restoreLocal: z.boolean().optional(),
  locale: LocaleSchema,
  copyId: z.string(),
  baseline: CopyRecordSchema.optional(),
  canvasFingerprint: z.string(),
  product: z.string(),
  context: CopyContextSchema,
  en: z.string(),
  id: z.string(),
});
export type DraftRow = z.infer<typeof DraftRowSchema>;
export const AuthoringDraftSchema = z.object({
  frameId: z.string(),
  frameName: z.string(),
  locale: LocaleSchema,
  rows: z.array(DraftRowSchema),
  /** Writer choices for rows that bind existing copy, so they survive frame switches. */
  picks: z
    .record(
      z.object({
        status: z.enum(['include', 'skip', 'flag']),
        pick: z.string().nullable(),
        unbind: z.boolean(),
        shift: z.number().int(),
      }),
    )
    .optional(),
  pending: z
    .object({
      batch: MutationBatchSchema,
      targets: z.array(TargetSchema),
      result: MutationResultSchema.optional(),
      deliveryRecords: z.array(CopyRecordSchema).optional(),
      /** Bindings of existing copy committed together with the saved copy. */
      decisions: z.array(LayerDecisionSchema).optional(),
      applyPreview: ApplyPreviewSchema.optional(),
    })
    .optional(),
});
export type AuthoringDraft = z.infer<typeof AuthoringDraftSchema>;
export const LocalCopySchema = z.object({
  variableId: z.string(),
  variableKey: z.string(),
  name: z.string(),
  collection: z.string(),
  copyId: z.string().nullable(),
  baseline: CopyRecordSchema.nullable(),
  en: z.string(),
  id: z.string(),
  context: CopyContextSchema.nullable(),
  error: z.string().optional(),
});
export type LocalCopy = z.infer<typeof LocalCopySchema>;
export const WorkflowActionSchema = z.enum([
  /** Raw registry response bytes; the UI parses them so the Figma main thread never does. */
  'registry:fetch',
  'changes',
  'submit',
  'request',
  'scan',
  'preflight',
  'deliver',
  'refresh',
  'draft:get',
  'draft:save',
  'settings:get',
  'settings:save',
  'device',
  'library:scan',
  'library:start',
  'library:apply',
  'library:ack',
  'library:publish',
  'library:manifest',
  'library:pending',
  'apply:preview',
  'scope:set',
  'writer:commit',
]);
export type WorkflowAction = z.infer<typeof WorkflowActionSchema>;

export const SyncEntrySchema = z.object({
  copyId: z.string(),
  revision: z.number().int().positive(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
});
export const LibraryRequestSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('start'),
    args: z.object({
      libraryId: z.string().min(1).max(128),
      fileKey: z.string().min(1).max(128),
      runId: z.string().min(1).max(128),
      owner: z.string().min(1).max(128),
      manifest: z.array(SyncEntrySchema).min(1).max(25000),
    }),
  }),
  z.object({
    operation: z.literal('ack'),
    args: z.object({
      runId: z.string().min(1).max(128),
      owner: z.string().min(1).max(128),
      mappings: z.array(MappingSchema).max(25000),
    }),
  }),
  z.object({
    operation: z.literal('publish'),
    args: z.object({ runId: z.string().min(1).max(128), owner: z.string().min(1).max(128) }),
  }),
  z.object({
    operation: z.literal('renew'),
    args: z.object({ runId: z.string().min(1).max(128), owner: z.string().min(1).max(128) }),
  }),
  z.object({
    operation: z.literal('manifest'),
    args: z.object({ runId: z.string().min(1).max(128) }),
  }),
]);

export const FrameOccurrenceSchema = z.object({
  frameId: z.string(),
  nodeId: z.string(),
  layerName: z.string(),
  displayedText: z.string(),
});
export const FrameBundleSchema = z.object({
  schemaVersion: z.literal(1),
  fileLabel: z.string(),
  frames: z.array(z.object({ id: z.string(), name: z.string() })),
  records: z.array(CopyRecordSchema),
  occurrences: z.array(
    FrameOccurrenceSchema.extend({
      copyId: z.string(),
      platformKey: z.string(),
      revision: z.number().int().positive(),
      locale: LocaleSchema,
      variableKey: z.string(),
    }),
  ),
  unmanaged: z.array(FrameOccurrenceSchema),
  issues: z.array(z.record(z.unknown())),
  ready: z.boolean(),
});
export type FrameBundle = z.infer<typeof FrameBundleSchema>;
