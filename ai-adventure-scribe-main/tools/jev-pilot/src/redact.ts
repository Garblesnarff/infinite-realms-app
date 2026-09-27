/** Remove a secret from text before it is printed or thrown. */
export function redactSecret(text: string, secret: string | null | undefined): string {
  if (!secret) {
    return text;
  }
  return text.split(secret).join('[REDACTED]');
}
