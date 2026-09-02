const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isAllowedRequestOrigin(
  method: string,
  origin: string | undefined,
  requestOrigin: string,
  webOrigin: string,
) {
  if (SAFE_METHODS.has(method.toUpperCase()) || !origin) return true;
  return origin === webOrigin || origin === requestOrigin;
}
