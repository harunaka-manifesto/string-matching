export type SafeEvent = {
  requestId: string;
  route: string;
  status: number;
  durationMs: number;
  pluginVersion?: string;
  errorCode?: string;
  returnedCount?: number;
  scannedRowCount?: number;
};

export function safeSheetEvent(input: SafeEvent): SafeEvent {
  return {
    requestId: input.requestId,
    route: input.route,
    status: input.status,
    durationMs: input.durationMs,
    pluginVersion: input.pluginVersion,
    errorCode: input.errorCode,
    returnedCount: input.returnedCount,
    scannedRowCount: input.scannedRowCount,
  };
}
