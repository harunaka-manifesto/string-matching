import { z } from 'zod';
import {
  ApplySummarySchema,
  LayerDecisionSchema,
  LibraryListingItemSchema,
  SelectionInfoSchema,
  VariableValuesSchema,
} from './models';

const BytesSchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array);

export const UiToPluginMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ui:ready') }),
  /** Re-read the canvas selection, even if it is inside the current frame. */
  z.object({ type: z.literal('selection:refresh') }),
  /** Import values for every library variable whose key is not in `knownKeys`. */
  z.object({ type: z.literal('index:sync'), knownKeys: z.array(z.string()) }),
  z.object({ type: z.literal('index:save'), bytes: BytesSchema }),
  /** Selects the layer on canvas; `zoom` also scrolls and zooms to it. */
  z.object({ type: z.literal('layer:focus'), layerId: z.string(), zoom: z.boolean().optional() }),
  z.object({ type: z.literal('layers:select'), layerIds: z.array(z.string()) }),
  z.object({ type: z.literal('flags:select') }),
  z.object({
    type: z.literal('apply'),
    frameId: z.string(),
    decisions: z.array(LayerDecisionSchema),
  }),
]);
export type UiToPluginMessage = z.infer<typeof UiToPluginMessageSchema>;

export const PluginToUiMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('index:cached'), bytes: BytesSchema.nullable() }),
  z.object({
    type: z.literal('index:listing'),
    listing: z.array(LibraryListingItemSchema),
    toImport: z.number().int(),
  }),
  z.object({
    type: z.literal('index:values'),
    values: z.array(VariableValuesSchema),
    done: z.number().int(),
    total: z.number().int(),
  }),
  z.object({ type: z.literal('index:synced'), failed: z.number().int() }),
  z.object({ type: z.literal('selection'), selection: SelectionInfoSchema.nullable() }),
  z.object({ type: z.literal('apply:done'), summary: ApplySummarySchema }),
  z.object({ type: z.literal('flags:selected'), count: z.number().int() }),
  /** Variable keys already bound somewhere on the current page (ranks search results). */
  z.object({ type: z.literal('usage'), keys: z.array(z.string()) }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type PluginToUiMessage = z.infer<typeof PluginToUiMessageSchema>;
