import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { apiRaw } from "./api";

type LoginRes = { accessToken: string; refreshToken: string };

// Decodifica `exp` do JWT (base64url) sem verificar assinatura — só pra saber
// quando renovar. A verificação real fica no backend a cada request.
function decodeJwtExp(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<LoginRes | null> {
  try {
    return await apiRaw.post<LoginRes>("/admin/auth/refresh", { refreshToken });
  } catch {
    return null;
  }
}

// Sessão do NextAuth dura até 90d (mesmo limite do refresh token do backend).
// Access token (15min default) é renovado transparente quando perto de expirar.
const SESSION_MAX_AGE = 60 * 60 * 24 * 90;
// Renova 1min antes do access expirar pra evitar corrida.
const REFRESH_THRESHOLD_MS = 60_000;

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        senha: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.senha) return null;
        try {
          const tokens = await apiRaw.post<LoginRes>("/admin/auth/login", {
            email: credentials.email,
            senha: credentials.senha,
          });
          // valida e busca user
          const me = await fetch(
            `${process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"}/admin/users/me`,
            { headers: { authorization: `Bearer ${tokens.accessToken}` } },
          ).then((r) => (r.ok ? r.json() : null));
          if (!me) return null;
          return {
            id: me.id,
            name: me.nome,
            email: me.email,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          } as any;
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // Primeiro login: hidrata token com dados do usuário e expiração do access.
      if (user) {
        token.accessToken = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.accessTokenExpires = decodeJwtExp((user as any).accessToken);
        return token;
      }

      // Access ainda válido (com folga de REFRESH_THRESHOLD_MS): mantém.
      const exp = token.accessTokenExpires as number | null | undefined;
      if (exp && Date.now() < exp - REFRESH_THRESHOLD_MS) {
        return token;
      }

      // Access expirou ou está prestes a expirar: rotaciona via refresh token.
      const refreshed = await refreshAccessToken(token.refreshToken as string);
      if (!refreshed) {
        // Refresh falhou (refresh token expirou, usuário inativo, etc).
        // Marca a sessão como inválida — chamadas API vão dar 401 e o cliente
        // redireciona pra login.
        return { ...token, error: "RefreshAccessTokenError" };
      }
      return {
        ...token,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        accessTokenExpires: decodeJwtExp(refreshed.accessToken),
        error: undefined,
      };
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      (session as any).error = (token as any).error;
      return session;
    },
  },
};
