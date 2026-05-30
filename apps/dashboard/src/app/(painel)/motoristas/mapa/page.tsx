import type { Route } from "next";
import { redirect } from "next/navigation";

// Rota antiga substituída pelo /mapa unificado (motoristas + locais + pedágios).
// Redirect preserva bookmarks dos admins.
export default function MotoristasMapaRedirect() {
  redirect("/mapa" as Route);
}
