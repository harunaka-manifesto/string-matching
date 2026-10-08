import { z } from 'zod';
import {
  WorkflowActionSchema,
  ApplyPreviewSchema,
  CopyRecordSchema,
  MappingSchema,
  ProductConfigSchema,
} from './registry';
import {
  ApplySummarySchema,
  LayerDecisionSchema,
  LibraryListingItemSchema,
  SelectionInfoSchema,
  VariableValuesSchema,
} from './models';

const BytesSchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array);

export const UiToPluginMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('workflow'),
    operationId: z.string(),
    action: WorkflowActionSchema,
    data: z.unknown(),
  }),
  z.object({ type: z.literal('ui:ready') }),
  /** Re-read the canvas selection, even if it is inside the current frame. */
  z.object({ type: z.literal('selection:refresh') }),
  /** Re-read the working frame (text edits, renames) without changing which frame it is. */
  z.object({ type: z.literal('frame:reread') }),
  /** Resize the plugin window; `persist` remembers the size for next launch. */
  z.object({
    type: z.literal('window:resize'),
    width: z.number(),
    height: z.number(),
    persist: z.boolean().optional(),
  }),
  /** List library and local strings. Library values are never bulk-imported. */
  z.object({ type: z.literal('index:sync') }),
  /** Values for a few library strings the registry does not know (shown in search or bound). */
  z.object({ type: z.literal('index:resolve'), keys: z.array(z.string()).max(100) }),
  /** Gzipped catalog JSON for private storage; the UI compresses it natively. */
  z.object({ type: z.literal('catalog:save'), bytes: BytesSchema }),
  /** The UI's answer to `catalog:query`: only the records the controller asked for. */
  z.object({
    type: z.literal('catalog:answer'),
    queryId: z.string(),
    seq: z.number().int(),
    records: z.array(CopyRecordSchema),
    mappings: z.array(MappingSchema),
    products: z.array(ProductConfigSchema),
    /** False when a fresh catalog was asked for but the registry could not be reached. */
    online: z.boolean(),
    error: z.string().optional(),
  }),
  /** Selects the layer on canvas; `zoom` also scrolls and zooms to it. */
  z.object({ type: z.literal('layer:focus'), layerId: z.string(), zoom: z.boolean().optional() }),
  z.object({ type: z.literal('layers:select'), layerIds: z.array(z.string()) }),
  z.object({ type: z.literal('flags:select') }),
  z.object({
    type: z.literal('apply'),
    frameId: z.string(),
    decisions: z.array(LayerDecisionSchema),
    preview: ApplyPreviewSchema.optional(),
  }),
]);
export type UiToPluginMessage = z.infer<typeof UiToPluginMessageSchema>;

export const PluginToUiMessageSchema = z.discriminatedUnion('type', [
  /** Stored catalog (gzipped JSON) for the UI to decode; null on first run. */
  z.object({ type: z.literal('catalog:cached'), bytes: BytesSchema.nullable() }),
  /**
   * The controller needs a few saved records. The UI holds the catalog and answers with
   * `catalog:answer`: records for `copyIds` (following merges), their mappings and products.
   * `fresh` pulls registry changes first.
   */
  z.object({
    type: z.literal('catalog:query'),
    queryId: z.string(),
    copyIds: z.array(z.string()),
    fresh: z.boolean(),
  }),
  /**
   * Long controller work, shown in the plugin instead of a silent freeze. `label: null`
   * ends the activity.
   */
  z.object({
    type: z.literal('activity'),
    key: z.string(),
    label: z.string().nullable(),
    done: z.number().int().optional(),
    total: z.number().int().optional(),
  }),
  z.object({ type: z.literal('workflow:result'), operationId: z.string(), data: z.unknown() }),
  z.object({
    type: z.literal('workflow:error'),
    operationId: z.string(),
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
  /** Every library and local string (metadata only), plus values of the local ones. */
  z.object({
    type: z.literal('index:listing'),
    listing: z.array(LibraryListingItemSchema),
    values: z.array(VariableValuesSchema),
  }),
  /** Values answering `index:resolve`. */
  z.object({ type: z.literal('index:values'), values: z.array(VariableValuesSchema) }),
  /** Local string variables were created or changed; replaces every local entry. */
  z.object({
    type: z.literal('index:local'),
    listing: z.array(LibraryListingItemSchema),
    values: z.array(VariableValuesSchema),
  }),
  /** Text inside the working frame changed on canvas. */
  z.object({ type: z.literal('canvas:changed'), frameId: z.string() }),
  z.object({ type: z.literal('selection'), selection: SelectionInfoSchema.nullable() }),
  z.object({ type: z.literal('apply:done'), summary: ApplySummarySchema }),
  z.object({ type: z.literal('flags:selected'), count: z.number().int() }),
  /** Variable keys already bound somewhere on the current page (ranks search results). */
  z.object({ type: z.literal('usage'), keys: z.array(z.string()) }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type PluginToUiMessage = z.infer<typeof PluginToUiMessageSchema>;
