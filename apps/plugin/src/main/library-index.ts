import type { LibraryListingItem, VariableValues } from '@string-binder/contracts';
import { catalog, WorkflowError } from './registry-api';
import { recordFingerprint } from '@string-binder/domain';
import {
  materialize,
  baselineOf,
  copyIdOf,
  actual,
  sameValues,
  allTexts,
  fonts,
  verifiesSaved,
} from './delivery';

/** Parallel imports per batch; one batch is also one progress message to the UI. */
export const IMPORT_BATCH_SIZE = 40;

/** Lists every string variable in the libraries enabled for this file. No values yet. */
export async function listLibraryStrings(): Promise<LibraryListingItem[]> {
  const collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
  const items: LibraryListingItem[] = [];
  for (const collection of collections) {
    const variables = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(collection.key);
    variables.forEach((variable, order) => {
      if (variable.resolvedType !== 'STRING') return;
      items.push({ key: variable.key, name: variable.name, collection: collection.name, order });
    });
  }
  return items;
}

/** Local (unpublished) string variables in this file, keyed by variable key. */
const localByKey = new Map<string, Variable>();

/**
 * Lists string variables defined in this file, in panel order. Unlike library
 * variables they need no import, so values are read right away and always
 * fresh.
 */
export async function listLocalStrings(): Promise<{
  listing: LibraryListingItem[];
  values: VariableValues[];
}> {
  localByKey.clear();
  const listing: LibraryListingItem[] = [];
  const values: VariableValues[] = [];
  for (const collection of await figma.variables.getLocalVariableCollectionsAsync()) {
    let order = 0;
    for (const id of collection.variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(id);
      if (!variable || variable.resolvedType !== 'STRING') continue;
      localByKey.set(variable.key, variable);
      listing.push({ key: variable.key, name: variable.name, collection: collection.name, order });
      values.push(await readVariableValues(variable));
      order += 1;
    }
  }
  return { listing, values };
}

/** Local variables resolve directly; library variables are imported by key. */
export async function variableByKey(key: string): Promise<Variable> {
  if (key.startsWith('registry:')) {
    const [, id, rev] = key.split(':');
    let online = true;
    const cat = await catalog(true).catch(async () => {
      online = false;
      return catalog();
    });
    const record = cat.records.find((r) => r.copyId === id);
    if (!record || record.revision !== Number(rev))
      throw new WorkflowError(
        'REVISION_CONFLICT',
        'Copy changed since selection; refresh the catalog and review again',
      );
    const mapping = cat.mappings.find(
      (m) =>
        m.copyId === record.copyId &&
        m.publishedRevision === record.revision &&
        m.syncedRevision === record.revision &&
        m.fingerprint === recordFingerprint(record),
    );
    if (mapping) {
      try {
        const v = await figma.variables.importVariableByKeyAsync(mapping.variableKey);
        if (await verifiesSaved(v, record)) return v;
      } catch {
        /* Published copy can be temporarily unavailable. */
      }
    }
    if (!online) {
      for (const v of await figma.variables.getLocalVariablesAsync('STRING'))
        if (await verifiesSaved(v, record)) return v;
      throw new WorkflowError(
        'UNAVAILABLE',
        'This saved revision is not available in Figma while offline',
      );
    }
    const mirrors = await figma.variables.getLocalVariablesAsync('STRING');
    const changing = new Set(
      mirrors
        .filter(
          (v) =>
            copyIdOf(v) === record.copyId &&
            v.getSharedPluginData('copy', 'delivery') === '1' &&
            baselineOf(v)?.revision !== record.revision,
        )
        .map((v) => v.id),
    );
    if (changing.size) {
      const usages = (await allTexts()).filter((n) => {
        const b = n.boundVariables?.characters;
        return b && !Array.isArray(b) && changing.has(b.id);
      });
      await Promise.all(usages.map(fonts));
    }
    return materialize(
      record,
      cat.products.find((p) => p.id === record.product)?.displayName ?? record.product,
    );
  }
  return localByKey.get(key) ?? figma.variables.importVariableByKeyAsync(key);
}

type ModeLanguage = 'en' | 'id' | null;

const modeLanguages = new Map<string, Promise<Map<string, ModeLanguage>>>();

function languageOf(modeName: string): ModeLanguage {
  const name = modeName.trim().toLowerCase();
  if (name === 'en' || name.startsWith('en-') || name.startsWith('english')) return 'en';
  if (
    name === 'id' ||
    name.startsWith('id-') ||
    name.startsWith('indo') ||
    name.startsWith('bahasa')
  )
    return 'id';
  return null;
}

/** Modes are resolved by name, never by index (docs/plugin-copy-rules.md). */
function modesOf(collectionId: string): Promise<Map<string, ModeLanguage>> {
  let modes = modeLanguages.get(collectionId);
  if (!modes) {
    modes = figma.variables
      .getVariableCollectionByIdAsync(collectionId)
      .then(
        (collection) =>
          new Map((collection?.modes ?? []).map((mode) => [mode.modeId, languageOf(mode.name)])),
      );
    modeLanguages.set(collectionId, modes);
  }
  return modes;
}

async function stringValue(
  value: VariableValue,
  language: ModeLanguage,
  seen = new Set<string>(),
): Promise<string> {
  if (typeof value === 'string') return value;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('type' in value) ||
    value.type !== 'VARIABLE_ALIAS'
  )
    return '';
  if (seen.has(value.id)) throw new Error('Circular string variable alias.');
  seen.add(value.id);
  const target = await figma.variables.getVariableByIdAsync(value.id);
  if (!target) throw new Error('String variable alias target is missing.');
  const modes = await modesOf(target.variableCollectionId);
  const modeId = language ? [...modes].find(([, locale]) => locale === language)?.[0] : undefined;
  const next = modeId
    ? target.valuesByMode[modeId]
    : language
      ? undefined
      : Object.values(target.valuesByMode)[0];
  if (next === undefined)
    throw new Error('String variable alias is missing the requested language mode.');
  return stringValue(next, language, seen);
}

export async function readVariableValues(variable: Variable): Promise<VariableValues> {
  const modes = await modesOf(variable.variableCollectionId).catch(
    () => new Map<string, ModeLanguage>(),
  );
  const values = { en: '', id: '' };
  const unnamed: string[] = [];
  for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
    const language = modes.get(modeId) ?? null;
    const text = await stringValue(value, language);
    if (language) values[language] = text;
    else unnamed.push(text);
  }
  // Collections whose modes are not named EN/ID: ID is the first mode in GoPay Strings.
  if (!values.id && unnamed.length) values.id = unnamed.shift()!;
  if (!values.en && unnamed.length) values.en = unnamed.shift()!;
  return { key: variable.key, ...values, description: variable.description ?? '' };
}

export async function importValues(
  keys: readonly string[],
): Promise<{ values: VariableValues[]; failed: number }> {
  const settled = await Promise.allSettled(
    keys.map(async (key) =>
      readVariableValues(await figma.variables.importVariableByKeyAsync(key)),
    ),
  );
  const values: VariableValues[] = [];
  let failed = 0;
  for (const result of settled) {
    if (result.status === 'fulfilled') values.push(result.value);
    else failed += 1;
  }
  return { values, failed };
}
