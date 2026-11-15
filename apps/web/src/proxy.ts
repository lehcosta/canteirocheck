import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Barreira barata (sem banco): sem cookie de sessão, vai para /login.
 * A checagem de verdade (sessão válida + usuário ativo + tenant) é feita em lib/sessao.ts.
 */
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/obras/:path*", "/configuracoes/:path*"] };
