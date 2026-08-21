import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { productionBridge } from './bridge';
import { mockBridge } from './mock-bridge';

const bridge = import.meta.env.DEV ? mockBridge() : productionBridge();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App bridge={bridge} />
  </StrictMode>,
);
