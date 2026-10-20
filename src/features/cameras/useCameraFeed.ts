import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from '../../../config/client';
import { useRefreshRequests } from '../../utils/appEvents';
import { fetchCameras } from './cameraClient';
import type { CameraCard } from './types';
export function useCameraFeed() {
  const [cameras, setCameras] = useState<CameraCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [feedFailed, setFeedFailed] = useState(false);
  const [latestCapture, setLatestCapture] = useState('');
  const [liveSourceDesc, setLiveSourceDesc] = useState('LTA Traffic Images');
  const mounted = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (pending.current) return pending.current;
    setRefreshing(true);
    pending.current = fetchCameras()
      .then((answer) => {
        if (!mounted.current) return;
        setCameras(answer.cameras);
        if (answer.timestamp) setLatestCapture(answer.timestamp);
        setLiveSourceDesc(answer.source);
        setFeedFailed(answer.offline);
      })
      .catch(() => {
        if (mounted.current) setFeedFailed(true);
      })
      .finally(() => {
        pending.current = null;
        if (mounted.current) setRefreshing(false);
      });
    return pending.current;
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = setInterval(refresh, config.poll.cameras);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [refresh]);
  useRefreshRequests(refresh);
  return { cameras, refreshing, feedFailed, latestCapture, liveSourceDesc, refresh };
}
