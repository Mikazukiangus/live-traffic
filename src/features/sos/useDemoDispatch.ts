import { useState } from 'react';
import type { ActiveDispatch } from '../../types/traffic';
import { createDemoDispatch } from './demoDispatch';
export function useDemoDispatch(locationMarker: string) {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [activeDispatch, setActiveDispatch] = useState<ActiveDispatch | null>(null);
  const handleToggleBroadcast = () => {
    setIsBroadcasting((prev) => !prev);
    if (!isBroadcasting && !activeDispatch) {
      // Auto-assign a rapid emergency responder
      setActiveDispatch(createDemoDispatch(locationMarker));
    }
  };
  const handleConfirmDispatch = (dispatch: ActiveDispatch) => {
    setActiveDispatch(dispatch);
    setIsBroadcasting(true);
  };

  return {
    isBroadcasting,
    activeDispatch,
    handleToggleBroadcast,
    handleConfirmDispatch,
    cancelDispatch: () => {
      setActiveDispatch(null);
      setIsBroadcasting(false);
    },
  };
}
