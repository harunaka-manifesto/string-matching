import { z } from 'zod';

/** Persisted per-layer writer decision, stored in shared pluginData `copy/state`. */
export const StoredLayerStateSchema = z.enum(['skip', 'needs-new', 'include']);
export type StoredLayerState = z.infer<typeof StoredLayerStateSchema>;

export const PLUGIN_DATA_NAMESPACE = 'copy';
export const PLUGIN_DATA_STATE_KEY = 'state';

/** One variable as listed by `figma.teamLibrary` (cheap, no values). */
export const LibraryListingItemSchema = z.object({
  key: z.string(),
  name: z.string(),
  collection: z.string(),
  /** Position inside the library collection listing. */
  order: z.number().int(),
  /** Defined in this file rather than imported from a published library. */
  local: z.boolean().optional(),
});
export type LibraryListingItem = z.infer<typeof LibraryListingItemSchema>;

/** Values read after importing a variable. */
export const VariableValuesSchema = z.object({
  key: z.string(),
  en: z.string(),
  id: z.string(),
  description: z.string(),
});
export type VariableValues = z.infer<typeof VariableValuesSchema>;

export const LayerInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  characters: z.string(),
  /** True when the layer sits inside a component instance. */
  inInstance: z.boolean(),
  contextNames: z.array(z.string()).optional(),
  boundKey: z.string().nullable(),
  boundName: z.string().nullable(),
  stored: StoredLayerStateSchema.nullable(),
  /** Why the layer looks like non-copy, when it does. */
  autoSkipReason: z.string().nullable(),
});
export type LayerInfo = z.infer<typeof LayerInfoSchema>;

export const SelectionInfoSchema = z.object({
  frameId: z.string(),
  frameName: z.string(),
  /** Frame, ancestor, and section names, used to rank search results. */
  contextNames: z.array(z.string()),
  layers: z.array(LayerInfoSchema),
  /** Page holding the frame, with the product writers chose (or the plugin guessed) for it. */
  page: z
    .object({
      id: z.string(),
      name: z.string(),
      scope: z.object({ product: z.string(), confirmed: z.boolean() }).nullable(),
    })
    .optional(),
});
export type SelectionInfo = z.infer<typeof SelectionInfoSchema>;

export const LayerDecisionSchema = z.discriminatedUnion('action', [
  z.object({ layerId: z.string(), action: z.literal('bind'), key: z.string() }),
  z.object({ layerId: z.string(), action: z.literal('unbind') }),
  z.object({ layerId: z.string(), action: z.literal('skip') }),
  z.object({ layerId: z.string(), action: z.literal('flag') }),
  z.object({ layerId: z.string(), action: z.literal('include') }),
]);
export type LayerDecision = z.infer<typeof LayerDecisionSchema>;

export const LayerRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  frameName: z.string(),
});
export type LayerRef = z.infer<typeof LayerRefSchema>;

export const ApplySummarySchema = z.object({
  boundInFrame: z.number().int(),
  boundAcrossPage: z.number().int(),
  framesTouched: z.number().int(),
  skipsCopied: z.number().int(),
  conflicts: z.array(LayerRefSchema),
  failures: z.array(LayerRefSchema.extend({ reason: z.string() })),
  propagated: z.array(LayerRefSchema),
});
export type ApplySummary = z.infer<typeof ApplySummarySchema>;
