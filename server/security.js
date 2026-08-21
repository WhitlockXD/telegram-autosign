export function helmetOptions(tlsEnabled) {
  if (tlsEnabled) return {};
  return {
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    strictTransportSecurity: false,
  };
}
