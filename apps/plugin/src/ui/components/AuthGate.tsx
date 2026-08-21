type AuthGateProps = {
  state: 'checking' | 'required' | 'connecting';
  enabledPublicTestMode: boolean;
  error?: string;
  onConnect: () => void;
  onReopen: () => void;
  onPublicTest: () => void;
  onCancel: () => void;
};

export function AuthGate({
  state,
  enabledPublicTestMode,
  error,
  onConnect,
  onReopen,
  onPublicTest,
  onCancel,
}: AuthGateProps) {
  return (
    <main className="auth-gate">
      <div className="auth-mark" aria-hidden="true">
        UX
      </div>
      <h1>UX Copy Sync</h1>
      <p>Bring approved UX copy from Google Sheets into your Figma designs.</p>
      {state === 'checking' ? (
        <div className="loading-line" role="status">
          Checking your connection…
        </div>
      ) : (
        <>
          <button
            className="primary auth-button"
            onClick={onConnect}
            disabled={state === 'connecting'}
          >
            {state === 'connecting' ? 'Opening sign-in…' : 'Continue with Google'}
          </button>
          <span className="helper">Company Workspace accounts only</span>
          {enabledPublicTestMode && (
            <>
              <div className="auth-divider">
                <span>or</span>
              </div>
              <button className="secondary auth-button" onClick={onPublicTest}>
                Test with a public Sheet
              </button>
              <span className="helper">Public Sheet test mode · development only</span>
            </>
          )}
          {state === 'connecting' && (
            <div className="notice" role="status">
              Finish signing in in your browser, then return to Figma.
              <br />
              <button className="text-button" onClick={onReopen}>
                Open sign-in again
              </button>
              {' · '}
              <button className="text-button" onClick={onCancel}>
                Cancel
              </button>
            </div>
          )}
        </>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </main>
  );
}
