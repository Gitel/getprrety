import { useCallback, useEffect, useState } from 'react';
import { Camera } from '@capacitor/camera';

export function useCameraPermission() {
  const [granted, setGranted] = useState(false);

  const checkPermission = useCallback(async () => {
    const status = await Camera.checkPermissions();
    const allowed = status.camera === 'granted';
    setGranted(allowed);
    return allowed;
  }, []);

  useEffect(() => {
    checkPermission().catch(() => setGranted(false));
  }, [checkPermission]);

  const ensurePermission = useCallback(async () => {
    if (await checkPermission()) return true;
    const status = await Camera.requestPermissions({ permissions: ['camera'] });
    const allowed = status.camera === 'granted';
    setGranted(allowed);
    return allowed;
  }, [checkPermission]);

  return { granted, ensurePermission };
}
