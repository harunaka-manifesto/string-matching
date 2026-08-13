// UX Copy Sync — Figma plugin thread
figma.showUI(__html__, { width: 520, height: 720 });

const SUPPORTED_CONTAINERS = new Set(["FRAME", "COMPONENT", "INSTANCE", "GROUP", "SECTION"]);
const previews = new Map();
let activeToken = null;
let ignoreNextSelectionChange = false;

function error(code, message, details) { return { code, message, details }; }
function messageError(err) { return err && err.message ? err.message : String(err); }
function boxValue(node, key) { return node.absoluteBoundingBox ? node.absoluteBoundingBox[key] : node[key] || 0; }
function containingPageId(node) {
  let current = node;
  while (current && current.type !== "PAGE") current = current.parent;
  return current ? current.id : null;
}
function lockedAncestorName(node) {
  let current = node;
  while (current && current.type !== "PAGE") {
    if (current.locked === true) return current.name;
    current = current.parent;
  }
  return null;
}

function readingOrder(nodes) {
  return nodes.slice().sort((a, b) => {
    const dy = boxValue(a, "y") - boxValue(b, "y");
    if (Math.abs(dy) > 4) return dy;
    const dx = boxValue(a, "x") - boxValue(b, "x");
    if (dx !== 0) return dx;
    return a.id.localeCompare(b.id);
  });
}

function walkVisibleText(node, out, ancestorsVisible) {
  const visible = ancestorsVisible && node.visible !== false;
  if (!visible) return;
  if (node.type === "TEXT") { out.push(node); return; }
  if ("children" in node) for (const child of node.children) walkVisibleText(child, out, visible);
}

function targetsFor(container) {
  const nodes = [];
  walkVisibleText(container, nodes, true);
  return readingOrder(nodes);
}

function snapshot(nodes) {
  return nodes.map((node) => ({
    id: node.id, name: node.name, characters: node.characters, visible: node.visible !== false,
    absoluteX: boxValue(node, "x"), absoluteY: boxValue(node, "y"), hasMissingFont: !!node.hasMissingFont,
  }));
}

function selectionContext() {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) throw error("INVALID_SELECTION", "Select exactly one frame, component, instance, group, or section.");
  const container = selection[0];
  if (!SUPPORTED_CONTAINERS.has(container.type)) throw error("UNSUPPORTED_SELECTION", "Select a frame, component, instance, group, or section — not a text layer.");
  const targets = snapshot(targetsFor(container));
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const previousToken = activeToken;
  for (const storedToken of previews.keys()) if (storedToken !== previousToken) previews.delete(storedToken);
  activeToken = token;
  previews.set(token, { token, previousToken, pageId: figma.currentPage.id, containerId: container.id, containerName: container.name, containerType: container.type, targets, applied: false });
  return { previewToken: token, selection: { containerId: container.id, containerName: container.name, containerType: container.type, visibleTextCount: targets.length }, targets };
}

function equalSnapshot(a, b) {
  if (a.length !== b.length) return false;
  return a.every((before, index) => {
    const after = b[index];
    return after && before.id === after.id && before.characters === after.characters &&
      before.visible === after.visible && Math.abs(before.absoluteX - after.absoluteX) <= .01 && Math.abs(before.absoluteY - after.absoluteY) <= .01;
  });
}

async function validateFresh(preview) {
  if (figma.currentPage.id !== preview.pageId) throw error("PREVIEW_STALE", "The preview belongs to a different page.");
  const container = await figma.getNodeByIdAsync(preview.containerId);
  if (!container || !SUPPORTED_CONTAINERS.has(container.type) || containingPageId(container) !== preview.pageId) throw error("PREVIEW_STALE", "The selected container no longer exists on this page.");
  const current = snapshot(targetsFor(container));
  if (!equalSnapshot(preview.targets, current)) throw error("PREVIEW_STALE", "The frame changed after this preview was built. Refresh the preview before applying.");
}

async function loadFonts(node) {
  const len = node.characters.length;
  const fonts = len ? node.getRangeAllFontNames(0, len) : [node.fontName];
  const uniqueFonts = [];
  const seen = new Set();
  for (const font of fonts) {
    const key = `${font.family}\n${font.style}`;
    if (!seen.has(key)) { seen.add(key); uniqueFonts.push(font); }
  }
  try { for (const font of uniqueFonts) await figma.loadFontAsync(font); }
  catch (_) { throw error("FONT_LOAD_FAILED", `Could not load the font used by “${node.name}”.`, { layers: [node.name] }); }
}

async function applyPairs(payload) {
  if (!payload || typeof payload.previewToken !== "string") throw error("PREVIEW_NOT_FOUND", "This preview is no longer active. Build a new preview.");
  const preview = previews.get(payload.previewToken);
  if (!preview || payload.previewToken !== activeToken) throw error("PREVIEW_NOT_FOUND", "This preview is no longer active. Build a new preview.");
  if (preview.applied) throw error("PREVIEW_ALREADY_APPLIED", "This preview has already been applied.");
  if (preview.applying) throw error("PREVIEW_ALREADY_APPLIED", "These changes are already being applied.");
  const pairs = Array.isArray(payload.pairs) ? payload.pairs : [];
  if (!pairs.length) throw error("WRITE_FAILED", "Choose at least one paired layer to apply.");
  if (pairs.length > preview.targets.length) throw error("WRITE_FAILED", "The reviewed pairing is invalid.");
  const known = new Set(preview.targets.map((t) => t.id)); const used = new Set();
  for (const pair of pairs) {
    if (!pair || !known.has(pair.layerId) || used.has(pair.layerId) || typeof pair.value !== "string") throw error("WRITE_FAILED", "The reviewed pairing is invalid.");
    used.add(pair.layerId);
  }
  preview.applying = true;
  try {
    await validateFresh(preview);
    const nodes = [];
    for (const pair of pairs) {
      const node = await figma.getNodeByIdAsync(pair.layerId);
      if (!node || node.type !== "TEXT") throw error("PREVIEW_STALE", "A reviewed text layer was deleted or changed.");
      nodes.push({ node, value: pair.value, original: node.characters });
    }
    const missing = nodes.filter((item) => item.node.hasMissingFont).map((item) => item.node.name);
    if (missing.length) throw error("MISSING_FONT", `Missing font in ${missing.map((name) => `“${name}”`).join(", ")}.`, { layers: missing });
    const locked = nodes.map((item) => ({ layer: item.node.name, lockedBy: lockedAncestorName(item.node) })).filter((item) => item.lockedBy);
    if (locked.length) throw error("WRITE_FAILED", `Unlock ${locked.map((item) => `“${item.lockedBy}”`).join(", ")} before applying changes.`, { layers: locked.map((item) => item.layer) });
    for (const item of nodes) await loadFonts(item.node);

    const written = [];
    try {
      for (const item of nodes) { item.node.characters = item.value; written.push(item); }
    } catch (cause) {
      let rollbackFailed = false;
      for (const item of written.reverse()) { try { item.node.characters = item.original; } catch (_) { rollbackFailed = true; } }
      throw error(rollbackFailed ? "ROLLBACK_FAILED" : "WRITE_FAILED", `Could not update all layers: ${messageError(cause)}`, { rollbackFailed });
    }
    preview.applied = true; previews.clear(); activeToken = null;
    return { appliedCount: nodes.length, layerIds: nodes.map((item) => item.node.id) };
  } finally {
    preview.applying = false;
  }
}

function postSelectionState() {
  const selection = figma.currentPage.selection;
  const node = selection.length === 1 ? selection[0] : null;
  figma.ui.postMessage({ type: "selection-state", valid: !!node && SUPPORTED_CONTAINERS.has(node.type), count: selection.length, selection: node && SUPPORTED_CONTAINERS.has(node.type) ? { containerId: node.id, containerName: node.name, containerType: node.type, visibleTextCount: targetsFor(node).length } : null });
}

figma.on("selectionchange", () => {
  if (ignoreNextSelectionChange) { ignoreNextSelectionChange = false; postSelectionState(); return; }
  if (activeToken) {
    const preview = previews.get(activeToken); const selected = figma.currentPage.selection;
    if (!preview || selected.length !== 1 || selected[0].id !== preview.containerId) figma.ui.postMessage({ type: "preview-stale", previewToken: activeToken, reason: "Selection changed after this preview was built." });
  }
  postSelectionState();
});

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === "get-selection-context") {
      const result = selectionContext(); figma.ui.postMessage({ type: "selection-context-result", ok: true, ...result }); return;
    }
    if (msg.type === "get-selection-state") { postSelectionState(); return; }
    if (msg.type === "discard-preview") {
      if (msg.payload && msg.payload.previewToken === activeToken) {
        const discarded = previews.get(activeToken);
        previews.delete(activeToken);
        activeToken = discarded && previews.has(discarded.previousToken) ? discarded.previousToken : null;
      }
      return;
    }
    if (msg.type === "select-node") {
      const payload = msg.payload || {};
      const preview = previews.get(payload.previewToken);
      if (preview && preview.targets.some((target) => target.id === payload.layerId)) {
        const node = await figma.getNodeByIdAsync(payload.layerId);
        if (node) {
          const selection = figma.currentPage.selection;
          if (selection.length !== 1 || selection[0].id !== node.id) {
            ignoreNextSelectionChange = true;
            figma.currentPage.selection = [node];
          }
          figma.viewport.scrollAndZoomIntoView([node]);
        }
      }
      return;
    }
    if (msg.type === "apply-reviewed-pairs") {
      const result = await applyPairs(msg.payload); figma.ui.postMessage({ type: "apply-reviewed-pairs-result", ok: true, result }); figma.notify(`Updated ${result.appliedCount} text layers.`); return;
    }
    if (msg.type === "close") figma.closePlugin();
  } catch (err) {
    const out = err && err.code ? err : error("WRITE_FAILED", messageError(err));
    const type = msg.type === "get-selection-context" ? "selection-context-result" : "apply-reviewed-pairs-result";
    figma.ui.postMessage({ type, ok: false, error: out });
  }
};

postSelectionState();
