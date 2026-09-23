"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { usePermissoes } from "@/lib/permissoes";
import { useApiQuery } from "@/lib/client-api";
import { cn } from "@/lib/utils";

/**
 * TELAS-IRMÃS COMO ABAS de um item só do menu.
 *
 * Regra decidida com o dono em 23/09/2026: configuração que só serve a uma
 * tela mora DENTRO dela, como aba — quem está em Locais pensando "por que o
 * app não achou a pedreira?" não tinha como adivinhar que a resposta estava em
 * Ajustes. O item do menu correspondente usa `ou` (sidebar.tsx) com as mesmas
 * rotas, pra abrir na primeira aba que a pessoa pode ver.
 *
 * Cada aba mantém a permissão (e o módulo) que a tela já tinha. `perm: null`
 * = qualquer um (o Contrato: quem é obrigado a aceitar tem que poder reler).
 *
 * `config: true` põe a engrenagem na aba — avisa, antes do clique, que ali é
 * ajuste de comportamento e não a lista do dia a dia (pedido do dono).
 *
 * `contador` mostra, na própria aba, quantos casos esperam alguém — só onde o
 * número é exatamente "o que precisa de você" (um contador que conta outra
 * coisa é pior que nenhum).
 */
type Aba = {
  href: string;
  label: string;
  perm: string | null;
  config?: boolean;
  contador?: { path: string; ler: (dados: unknown) => number };
};

export const ABAS = {
  permissoes: [
    { href: "/configuracoes/permissoes", label: "Painel do escritório", perm: "permissoes.gerenciar" },
    { href: "/acesso-app", label: "App do motorista", perm: "perfis-acesso.ver" },
  ],
  "minha-empresa": [
    { href: "/configuracoes/empresa", label: "Dados da empresa", perm: "minha-empresa.editar" },
    { href: "/configuracoes/cte", label: "Emissor de CT-e", perm: "cte.ver", config: true },
    // O que a transportadora pede de documento (ao motorista, ao registrado,
    // ou em nome de um cliente). A lista geral mora aqui; a de cada cliente
    // aparece também na página dele.
    { href: "/documentos-exigidos", label: "Documentos que pedimos", perm: "documentos-exigidos.ver" },
    { href: "/configuracoes/contrato", label: "Contrato", perm: null },
  ],
  locais: [
    { href: "/locais", label: "Locais", perm: "locais.ver" },
    { href: "/configuracoes/busca-locais", label: "Como o app acha o local", perm: "config-busca-locais.ver", config: true },
  ],
  mapa: [
    { href: "/mapa", label: "Mapa", perm: "mapa.ver" },
    { href: "/configuracoes/tracking", label: "Posição durante a viagem", perm: "config-tracking.ver", config: true },
  ],
  // Decidido em 23/09/2026: conferir a planilha que o cliente manda e mandar
  // a nossa são as duas metades do mesmo fechamento — eram três itens soltos
  // em dois grupos do menu (o "como ler" morava em Ajustes).
  fechamento: [
    { href: "/fechamentos", label: "Conferir a planilha dele", perm: "fechamentos.ver" },
    { href: "/envios", label: "Mandar a minha planilha", perm: "envios.ver" },
    { href: "/configuracoes/campos-layout", label: "Como ler a planilha", perm: "config-campos-layout.ver", config: true },
  ],
  // Mínimo é quanto se CONTA, preço é quanto vale o que foi contado — duas
  // regras que a pessoa procura juntas quando pensa "quanto cobro deste
  // cliente". Continuam com chaves separadas (ver permissoes.ts).
  preco: [
    { href: "/tabelas-preco", label: "Preço", perm: "tabelas-preco.ver" },
    { href: "/regras-minimo", label: "Mínimo (km e tonelada)", perm: "regras-minimo.ver" },
  ],
  torre: [
    { href: "/torre", label: "Torre de controle", perm: "programacao.ver" },
    { href: "/configuracoes/torre", label: "Quando avisar", perm: "programacao.ver", config: true },
  ],
  viagens: [
    { href: "/viagens", label: "Viagens", perm: "viagens.ver" },
    { href: "/conferencias", label: "Conferir tickets", perm: "conferencia-ticket.ver" },
    {
      href: "/lancamentos-travados",
      label: "Não chegaram",
      perm: "lancamentos-resgatados.ver",
      contador: {
        path: "/admin/lancamentos-resgatados?status=abertos&limit=300",
        ler: (d) => (Array.isArray(d) ? d.length : 0),
      },
    },
    { href: "/configuracoes/km-atipico", label: "Km fora do padrão", perm: "config-km-atipico.ver", config: true },
  ],
} satisfies Record<string, Aba[]>;

export function AbasDaTela({ grupo }: { grupo: keyof typeof ABAS }) {
  const path = usePathname();
  const { temPermissao, temModulo } = usePermissoes();
  const abas = (ABAS[grupo] as Aba[]).filter(
    (a) => a.perm === null || (temPermissao(a.perm) && temModulo(a.perm)),
  );
  // Uma aba só não é escolha: a pessoa vê a tela como sempre viu.
  if (abas.length < 2) return null;
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-border">
      {abas.map((a) => (
        <AbaLink key={a.href} aba={a} ativa={path === a.href || path.startsWith(`${a.href}/`)} />
      ))}
    </div>
  );
}

function AbaLink({ aba, ativa }: { aba: Aba; ativa: boolean }) {
  const dados = useApiQuery<unknown>(aba.contador?.path, { staleTime: 60_000 });
  const n = aba.contador && dados.data !== undefined ? aba.contador.ler(dados.data) : 0;
  return (
    <Link
      href={aba.href as Route}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors",
        ativa
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {aba.config && <Settings className="h-3.5 w-3.5" aria-hidden />}
      {aba.label}
      {n > 0 && (
        <span className="rounded-full bg-destructive px-1.5 text-[11px] font-semibold leading-5 text-white">
          {n}
        </span>
      )}
    </Link>
  );
}
