import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Re-fetch when the user navigates back to this route or returns to the browser tab. */
export function useReloadOnReturn(load) {
  const location = useLocation();

  useEffect(() => {
    load();
  }, [load, location.key]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);
}
