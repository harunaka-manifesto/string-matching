export type TargetPreviewNode = {
  id: string;
  type: string;
};

export type TargetPreviewAdapter<Node extends TargetPreviewNode = TargetPreviewNode> = {
  getSelection: () => readonly Node[];
  setSelection: (nodes: readonly Node[]) => void;
  resolveNode: (id: string) => Promise<Node | null>;
  resolveRoot?: (id: string) => Promise<Node | null>;
};

type PreviewSession = {
  previewToken: string;
  rootId?: string;
  originalSelectionIds: string[];
  activeLayerId?: string;
  restoring: boolean;
  expectedSelectionIds: string[][];
};

export type TargetPreviewRequest = {
  previewToken: string;
  layerId: string;
  targetIds: readonly string[];
  rootId?: string;
};

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/**
 * Owns the temporary selection used to connect a review row to its canvas node.
 * It never changes the viewport and never mutates the Figma file.
 */
export class TargetPreviewManager<Node extends TargetPreviewNode = TargetPreviewNode> {
  private session: PreviewSession | undefined;
  private sequence = 0;

  public constructor(private readonly adapter: TargetPreviewAdapter<Node>) {}

  private async resolveNode(id: string): Promise<Node | null> {
    try {
      return await this.adapter.resolveNode(id);
    } catch {
      return null;
    }
  }

  private async resolveRoot(id: string): Promise<Node | null> {
    if (!this.adapter.resolveRoot) return null;
    try {
      return await this.adapter.resolveRoot(id);
    } catch {
      return null;
    }
  }

  public get isActive(): boolean {
    return Boolean(this.session && !this.session.restoring);
  }

  public get activeLayerId(): string | undefined {
    return this.session?.activeLayerId;
  }

  public get hasSession(): boolean {
    return this.session !== undefined;
  }

  public async preview(request: TargetPreviewRequest): Promise<boolean> {
    if (!request.targetIds.includes(request.layerId)) return false;

    let session = this.session;
    if (!session || session.previewToken !== request.previewToken) {
      this.sequence += 1;
      session = {
        previewToken: request.previewToken,
        rootId: request.rootId,
        originalSelectionIds: this.adapter.getSelection().map((node) => node.id),
        restoring: false,
        expectedSelectionIds: [],
      };
      this.session = session;
    } else {
      session.rootId = request.rootId ?? session.rootId;
      session.restoring = false;
    }

    session.activeLayerId = request.layerId;
    const requestSequence = ++this.sequence;
    const node = await this.resolveNode(request.layerId);
    if (
      requestSequence !== this.sequence ||
      this.session !== session ||
      session.activeLayerId !== request.layerId
    )
      return false;
    if (!node || node.type !== 'TEXT') {
      session.activeLayerId = undefined;
      return false;
    }

    session.expectedSelectionIds.push([node.id]);
    this.adapter.setSelection([node]);
    return true;
  }

  public async clear(options: { restore?: boolean; rootId?: string } = {}): Promise<boolean> {
    const session = this.session;
    this.sequence += 1;
    if (!session) return false;
    if (options.restore === false) {
      this.session = undefined;
      return false;
    }

    session.activeLayerId = undefined;
    session.restoring = true;
    const clearSequence = this.sequence;
    const originalNodes = (await Promise.all(
      session.originalSelectionIds.map((id) => this.resolveNode(id)),
    )) as Array<Node | null>;
    if (clearSequence !== this.sequence || this.session !== session) return false;

    const survivingNodes = originalNodes.filter((node): node is Node => node !== null);
    let restoreNodes = survivingNodes;
    if (!restoreNodes.length) {
      const fallbackRoot = options.rootId ?? session.rootId;
      const root = fallbackRoot ? await this.resolveRoot(fallbackRoot) : null;
      if (clearSequence !== this.sequence || this.session !== session) return false;
      restoreNodes = root ? [root] : [];
    }

    session.expectedSelectionIds.push(restoreNodes.map((node) => node.id));
    this.adapter.setSelection(restoreNodes);
    return true;
  }

  public cancelWithoutRestore(): void {
    this.sequence += 1;
    this.session = undefined;
  }

  public cancelForExternalSelection(): void {
    this.cancelWithoutRestore();
  }

  /** Returns true only for a selection change caused by this manager. */
  public consumeSelectionChange(selectionIds: readonly string[]): boolean {
    const session = this.session;
    if (!session) return false;
    const expectedIndex = session.expectedSelectionIds.findIndex((expected) =>
      sameIds(expected, selectionIds),
    );
    if (expectedIndex < 0) return false;
    session.expectedSelectionIds.splice(expectedIndex, 1);
    if (session.restoring && session.expectedSelectionIds.length === 0) this.session = undefined;
    return true;
  }
}
