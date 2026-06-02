export function useCameraPermission() {
  return { granted: false, ensurePermission: async () => false };
}
