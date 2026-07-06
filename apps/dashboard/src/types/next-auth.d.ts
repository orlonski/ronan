import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    // "RefreshAccessTokenError" = o refresh token morreu de verdade (401/403 no
    // refresh: expirou ou usuário inativo). Sinaliza logout real pro cliente;
    // ausência de erro em 401 = transitório (não desloga).
    error?: string;
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
  }
}
