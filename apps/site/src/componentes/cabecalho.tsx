import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { CADASTRO_URL, PAINEL_URL, WHATSAPP_URL } from "../lib/config";
import { useCadastroAberto } from "../lib/cadastro-aberto";

const LINKS = [
  { href: "#como-funciona", texto: "Como funciona" },
  { href: "#app", texto: "App do motorista" },
  { href: "#painel", texto: "Painel" },
  { href: "#por-dentro", texto: "Por dentro" },
  { href: "#perguntas", texto: "Perguntas" },
];

export function Cabecalho() {
  // `aberto` aqui é o menu do celular; o do cadastro tem nome próprio.
  const { aberto: cadastroAberto } = useCadastroAberto();
  const [aberto, setAberto] = useState(false);
  const [rolou, setRolou] = useState(false);

  useEffect(() => {
    const aoRolar = () => setRolou(window.scrollY > 8);
    aoRolar();
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  useEffect(() => {
    document.body.style.overflow = aberto ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [aberto]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-shadow duration-300 ${
        rolou ? "border-b border-borda bg-fundo/92 backdrop-blur-md" : "bg-transparent"
      }`}
    >
      <div className="caixa flex h-[68px] items-center justify-between gap-4">
        <a href="#topo" className="flex items-center" aria-label="Movatruck, início">
          <img
            src="/marca/movatruck-logo.svg"
            alt="Movatruck"
            width={1795}
            height={390}
            className="h-7 w-auto sm:h-8"
          />
        </a>

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Seções do site">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[0.94rem] font-medium text-tinta-media transition-colors hover:text-azul"
            >
              {l.texto}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <a
            href={PAINEL_URL}
            className="text-[0.94rem] font-medium text-tinta-media transition-colors hover:text-azul"
          >
            Entrar no painel
          </a>
          {/* Com a porta aberta, criar conta é o caminho principal do topo. */}
          {cadastroAberto ? (
            <a href={CADASTRO_URL} className="btn-primario">
              Criar conta grátis
            </a>
          ) : (
            <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="btn-primario">
              Agendar demonstração
            </a>
          )}
        </div>

        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          aria-controls="menu-mobile"
          aria-label={aberto ? "Fechar menu" : "Abrir menu"}
          className="-mr-2 inline-flex h-12 w-12 items-center justify-center rounded-lg text-tinta lg:hidden"
        >
          {aberto ? <X size={24} aria-hidden /> : <Menu size={24} aria-hidden />}
        </button>
      </div>

      {/* Fica sempre no DOM: o aria-controls do botão precisa achar o id
          mesmo com o menu fechado. */}
      <div
        id="menu-mobile"
        hidden={!aberto}
        className="fixed inset-x-0 bottom-0 top-[68px] z-40 overflow-y-auto border-t border-borda bg-fundo px-5 pb-10 pt-6 lg:hidden"
      >
        <nav className="flex flex-col" aria-label="Seções do site">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setAberto(false)}
              className="border-b border-borda py-4 text-lg font-medium text-tinta"
            >
              {l.texto}
            </a>
          ))}
        </nav>
        <div className="mt-8 flex flex-col gap-3">
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-primario w-full"
            onClick={() => setAberto(false)}
          >
            Agendar demonstração
          </a>
          <a href={PAINEL_URL} className="btn-secundario w-full">
            Entrar no painel
          </a>
        </div>
      </div>
    </header>
  );
}
