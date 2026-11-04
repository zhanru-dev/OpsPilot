/** Credential-bearing URLs must never become persisted error evidence. */
export function redactDiagnostic(value: string) {
  return value
    .replace(/([a-z]+:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(
      /([?&](?:ticket|token|pass|password|secret|key|streamKey)=)[^\s&#]*/gi,
      '$1[REDACTED]',
    )
    .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9+/_=.:-]+/g, '$1 [REDACTED]')
    .replace(/\b[a-f0-9]{64}\b/gi, '[REDACTED]');
}
export function diagnosticPath(value?: string) {
  return value
    ? redactDiagnostic(value.split(/[?#]/, 1)[0]).slice(0, 300)
    : undefined;
}
