import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { apiRaw } from "./api";

type LoginRes = { accessToken: string; refreshToken: string };

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
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
            perfil: me.perfil,
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
      if (user) {
        token.accessToken = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.perfil = (user as any).perfil;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.user = {
        ...session.user,
        perfil: token.perfil as "ADMIN" | "OPERADOR",
      };
      return session;
    },
  },
};
