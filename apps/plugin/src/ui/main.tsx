import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Studio } from './Studio';
import { productionBridge } from './bridge';
import { mockBridge } from './mock-bridge';
import './styles.css';

const bridge = import.meta.env.DEV ? mockBridge() : productionBridge();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Studio bridge={bridge} />
  </StrictMode>,
);
