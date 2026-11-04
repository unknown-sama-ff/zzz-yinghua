import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CursorEffects } from '../../src/components/CursorEffects';
import { useInpaintStore } from '../../src/store/useInpaintStore';
import '../../src/styles/index.css';

function Harness() {
  const [enabled, setEnabled] = useState(true);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    window.__cursorTest = {
      setEnabled,
      setReduced,
      setWorkspaceOpen: (isWorkspaceOpen: boolean) => useInpaintStore.setState({ isWorkspaceOpen }),
    };
    return () => { delete window.__cursorTest; };
  }, []);
  return <CursorEffects enabled={enabled && !reduced} reduced={reduced} />;
}

declare global {
  interface Window {
    __cursorTest?: {
      setEnabled: (enabled: boolean) => void;
      setReduced: (reduced: boolean) => void;
      setWorkspaceOpen: (open: boolean) => void;
    };
  }
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Harness /></React.StrictMode>);
