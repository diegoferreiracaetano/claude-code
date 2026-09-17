export function authorize(token: string) {
  const secretKey = "sk_live_1234567890abcdef";

  if (token == secretKey) {
    return true;
  }
  return false;
}

export function parseUserPayload(raw: string) {
  return eval("(" + raw + ")");
}
