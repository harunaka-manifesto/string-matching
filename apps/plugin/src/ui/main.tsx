import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import { productionBridge } from './bridge';
import { mockBridge } from './mock-bridge';
import './styles.css';

/** Shows what broke instead of an empty plugin window. */
class Crash extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="intro" role="alert">
        <h2>String Binder hit an error</h2>
        <p className="intro__text">{this.state.error.message}</p>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => location.reload()}
        >
          Reload plugin
        </button>
      </main>
    );
  }
}

const bridge = import.meta.env.DEV ? mockBridge() : productionBridge();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Crash>
      <Shell bridge={bridge} />
    </Crash>
  </StrictMode>,
);
