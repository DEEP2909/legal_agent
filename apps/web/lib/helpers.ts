/**
 * Password validation helper
 * Checks for minimum length, uppercase, lowercase, number, and special character
 */
export function validatePassword(password: string): string[] {
  const errors: string[] = [];
  if (password.length < 12) errors.push("Password must be at least 12 characters");
  if (!/[A-Z]/.test(password)) errors.push("Password must contain at least one uppercase letter");
  if (!/[a-z]/.test(password)) errors.push("Password must contain at least one lowercase letter");
  if (!/[0-9]/.test(password)) errors.push("Password must contain at least one number");
  if (!/[^A-Za-z0-9]/.test(password)) errors.push("Password must contain at least one special character");
  return errors;
}

/**
 * Clear authentication-related query parameters from the URL
 */
export function clearAuthQueryParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("authExchange");
  url.searchParams.delete("authError");
  url.searchParams.delete("loggedOut");
  url.searchParams.delete("mfaChallenge");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}
