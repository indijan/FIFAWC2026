export function countryCodeToFlagEmoji(input?: string) {
  const code = input?.trim().toUpperCase();

  if (!code || code.length !== 2 || /[^A-Z]/.test(code)) {
    return "🏳️";
  }

  return [...code]
    .map((char) => String.fromCodePoint(char.charCodeAt(0) + 127397))
    .join("");
}

