// UX Copy Sync — main plugin thread
// Matches Figma text-layer names to keys in a copy map (from CSV) and
// writes the writer's approved strings into those layers.

figma.showUI(__html__, { width: 440, height: 680 });

// ---- helpers -------------------------------------------------------------

/**
 * Recursively collect TEXT nodes under a node, stopping at (not descending
 * into) any node whose own `visible` flag is false. A plain findAll() would
 * keep traversing into hidden component instances / toggled-off states and
 * pick up copy that isn't actually shown anywhere on the canvas — this walk
 * mirrors what you'd actually see when looking at the frame.
 */
function walkTextNodes(node, out, includeHidden) {
  if (!includeHidden && node.visible === false) return;
  if (node.type === "TEXT") {
    out.push(node);
    return;
  }
  if ("children" in node) {
    for (const child of node.children) {
      walkTextNodes(child, out, includeHidden);
    }
  }
}

/** Collect every (visible, by default) TEXT node under a list of roots. */
function collectTextNodes(roots, includeHidden) {
  const out = [];
  for (const root of roots) {
    walkTextNodes(root, out, includeHidden);
  }
  return out;
}

/** Load every font used across a text node's characters. */
async function loadFontsForNode(node) {
  const len = node.characters.length;
  if (len === 0) {
    await figma.loadFontAsync(node.fontName);
    return;
  }
  const fonts = node.getRangeAllFontNames(0, len);
  for (const font of fonts) {
    await figma.loadFontAsync(font);
  }
}

function normalizeKey(key, caseSensitive) {
  const trimmed = key.trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

/**
 * Sort text nodes into reading order (top-to-bottom, then left-to-right)
 * using absolute canvas position. Nodes whose Y positions are within a small
 * threshold are treated as being on the same "line" and ordered by X.
 * This is used for sheets where copy is listed in the same sequence it
 * appears on a screen, rather than keyed by a stable layer name.
 */
function readingOrderSort(nodes) {
  const Y_THRESHOLD = 4;
  return nodes.slice().sort((a, b) => {
    const aBox = a.absoluteBoundingBox;
    const bBox = b.absoluteBoundingBox;
    const ay = aBox ? aBox.y : a.y;
    const by = bBox ? bBox.y : b.y;
    if (Math.abs(ay - by) > Y_THRESHOLD) return ay - by;
    const ax = aBox ? aBox.x : a.x;
    const bx = bBox ? bBox.x : b.x;
    return ax - bx;
  });
}

function rootsForScope(scope) {
  return scope === "selection" && figma.currentPage.selection.length > 0
    ? figma.currentPage.selection
    : [figma.currentPage];
}

// ---- main apply routine (name-based matching) ------------------------------

async function applyCopy({ map, scope, caseSensitive, includeHidden }) {
  const roots = rootsForScope(scope);

  const textNodes = collectTextNodes(roots, includeHidden);

  // Build a lookup of normalized key -> { value, originalKey }
  const lookup = new Map();
  for (const [rawKey, value] of Object.entries(map)) {
    lookup.set(normalizeKey(rawKey, caseSensitive), { value, rawKey });
  }

  const applied = [];
  const skippedMissingFont = [];
  const unmatchedLayers = [];
  const usedKeys = new Set();

  for (const node of textNodes) {
    const nodeKey = normalizeKey(node.name, caseSensitive);
    const hit = lookup.get(nodeKey);

    if (!hit) {
      unmatchedLayers.push(node.name);
      continue;
    }

    if (node.hasMissingFont) {
      skippedMissingFont.push(node.name);
      continue;
    }

    try {
      await loadFontsForNode(node);
      node.characters = hit.value;
      applied.push({ layer: node.name, value: hit.value });
      usedKeys.add(hit.rawKey);
    } catch (err) {
      skippedMissingFont.push(node.name);
    }
  }

  const unusedRows = Object.keys(map).filter((k) => !usedKeys.has(k));

  return {
    appliedCount: applied.length,
    applied,
    unmatchedLayers,
    skippedMissingFont,
    unusedRows,
    scannedCount: textNodes.length,
  };
}

// ---- sequence-based matching (no stable keys, order-driven) ---------------

/** Build a read-only preview of layers in reading order, without writing. */
function buildSequencePreview(scope, includeHidden) {
  const roots = rootsForScope(scope);
  const nodes = readingOrderSort(collectTextNodes(roots, includeHidden));
  return nodes.map((n) => ({
    id: n.id,
    name: n.name,
    characters: n.characters,
  }));
}

async function applySequence({ rows, scope, includeHidden }) {
  const roots = rootsForScope(scope);
  const nodes = readingOrderSort(collectTextNodes(roots, includeHidden));

  const pairCount = Math.min(nodes.length, rows.length);
  const applied = [];
  const skippedMissingFont = [];

  for (let i = 0; i < pairCount; i++) {
    const node = nodes[i];
    const value = rows[i];

    if (node.hasMissingFont) {
      skippedMissingFont.push(node.name);
      continue;
    }

    try {
      await loadFontsForNode(node);
      node.characters = value;
      applied.push({ layer: node.name, value });
    } catch (err) {
      skippedMissingFont.push(node.name);
    }
  }

  return {
    appliedCount: applied.length,
    applied,
    skippedMissingFont,
    layerCount: nodes.length,
    rowCount: rows.length,
    leftoverLayers: nodes.length > rows.length ? nodes.length - rows.length : 0,
    leftoverRows: rows.length > nodes.length ? rows.length - nodes.length : 0,
  };
}

// ---- message bridge --------------------------------------------------------

figma.ui.onmessage = async (msg) => {
  if (msg.type === "get-selection-count") {
    figma.ui.postMessage({
      type: "selection-info",
      count: figma.currentPage.selection.length,
    });
    return;
  }

  if (msg.type === "apply") {
    try {
      const result = await applyCopy(msg.payload);
      figma.ui.postMessage({ type: "apply-result", ok: true, result });
      if (result.appliedCount > 0) {
        figma.notify(`Updated ${result.appliedCount} text layer(s).`);
      } else {
        figma.notify("No matching layers found — check layer names.", {
          error: true,
        });
      }
    } catch (err) {
      figma.ui.postMessage({
        type: "apply-result",
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type === "get-sequence-preview") {
    try {
      const layers = buildSequencePreview(msg.payload.scope, msg.payload.includeHidden);
      figma.ui.postMessage({ type: "sequence-preview", ok: true, layers });
    } catch (err) {
      figma.ui.postMessage({
        type: "sequence-preview",
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type === "apply-sequence") {
    try {
      const result = await applySequence(msg.payload);
      figma.ui.postMessage({ type: "apply-sequence-result", ok: true, result });
      if (result.appliedCount > 0) {
        figma.notify(`Updated ${result.appliedCount} text layer(s) in order.`);
      } else {
        figma.notify("Nothing applied — check the selection and row count.", {
          error: true,
        });
      }
    } catch (err) {
      figma.ui.postMessage({
        type: "apply-sequence-result",
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
    return;
  }

  if (msg.type === "select-node") {
    try {
      const node = await figma.getNodeByIdAsync(msg.payload.id);
      if (node && "type" in node) {
        figma.currentPage.selection = [node];
        figma.viewport.scrollAndZoomIntoView([node]);
      }
    } catch (err) {
      // Node may no longer exist (e.g. deleted since preview was built) — ignore.
    }
    return;
  }

  if (msg.type === "close") {
    figma.closePlugin();
  }
};
