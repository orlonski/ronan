"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function PwaRegister() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    // O comprovante público (/v/<token>) é aberto no celular do CLIENTE, que
    // não é usuário do painel: instalar o service worker e oferecer "adicionar
    // à tela inicial" do Schaba ali é invasivo e confuso.
    if (pathname?.startsWith("/v/")) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // sem SW o painel funciona igual; só não fica "instalável"
    });
  }, [pathname]);

  return null;
}
