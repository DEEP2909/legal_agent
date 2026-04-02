import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js middleware to inject CSP nonce for XSS protection.
 * 
 * This removes the need for 'unsafe-inline' and 'unsafe-eval' in the CSP,
 * which would otherwise completely negate XSS protection.
 * 
 * Note: Next.js dev mode still requires 'unsafe-eval' for hot reload.
 * In production, this provides proper nonce-based script validation.
 */
export function middleware(request: NextRequest) {
  // Generate a random nonce for this request
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // Build CSP with nonce (stricter in production)
  const isDev = process.env.NODE_ENV === "development";
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:4000";

  // In development, we still need 'unsafe-eval' for hot reload
  // In production, we use strict nonce-based CSP
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;

  const cspDirectives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'", // CSS-in-JS often needs this
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${apiBaseUrl}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "upgrade-insecure-requests"
  ];

  const csp = cspDirectives.join("; ");

  // Clone the request headers and set the nonce
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  // Create the response with updated headers
  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });

  // Set CSP header on response
  response.headers.set("Content-Security-Policy", csp);

  return response;
}

// Apply middleware to all routes except static files and API routes
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder files
     */
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" }
      ]
    }
  ]
};
