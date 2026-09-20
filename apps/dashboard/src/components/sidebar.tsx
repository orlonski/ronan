"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpCircle,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Briefcase,
  Building,
  Building2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  FileSpreadsheet,
  Fuel,
  HardHat,
  IdCard,
  Instagram,
  Landmark,
  Lightbulb,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LogOut,
  Map,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Package,
  Radio,
  Satellite,
  Search,
  ShieldAlert,
  TowerControl,
  Upload,
  FileCheck2,
  CalendarDays,
  ClipboardList,
  Columns3,
  HandCoins,
  Gauge,
  Ruler,
  Tag,
  Wallet,
  Wrench,
  ScanEye,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  TrafficCone,
  Truck,
  UserCircle,
  Users2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/lib/permissoes";
import { Button } from "@/components/ui/button";
import { ContaSwitcher } from "@/components/conta-switcher";
import { LogoConta } from "@/components/logo-conta";
import { limparMarca, useMarcaConta } from "@/lib/marca-conta";
import { ThemeSwitcher } from "@/components/theme-switcher";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  // Chave de permissão (catálogo RBAC). Item só aparece se o papel tiver.
  //
  // OPCIONAL: item sem `perm` aparece pra todo usuário do painel. É exceção, e
  // hoje só o "Contrato" usa — o aceite dos Termos bloqueia todo mundo, então
  // esconder de alguém o que ela foi obrigada a aceitar seria incoerente.
  perm?: string;
};

type Grupo = {
  titulo: string;
  itens: Item[];
  /**
   * Grupo das ferramentas internas da Movatruck. Some inteiro pra quem não é da
   * plataforma — igual ao tratamento que o item "Empresas" já tinha. Antes
   * estavam espalhadas entre "Operação" (no meio da rotina do cliente) e
   * "Sistema".
   */
  soPlataforma?: boolean;
};

const DASHBOARD_ITEM = { href: "/", label: "Dashboard", icon: LayoutDashboard };
/**
 * Relatórios fica FORA dos grupos: é transversal e de uso diário, e o accordion
 * de um grupo por vez transformaria cada consulta em dois cliques. O href é o
 * hub (/relatorios), não uma das abas — apontar pra folha deixava o menu sem
 * nada aceso em 3 das 4 telas de relatório.
 */
const RELATORIOS_ITEM = {
  href: "/relatorios",
  label: "Relatórios",
  icon: BarChart3,
  perm: "relatorios.ver",
};

/**
 * O menu, agrupado por JORNADA — o que a pessoa está fazendo agora — e não pela
 * natureza técnica do registro.
 *
 * O desenho anterior tinha três grupos (Operação/Cadastros/Sistema) e "Operação"
 * havia virado o depósito do que não era cadastro nem configuração: 19 itens,
 * misturando a rotina do despachante com ferramentas internas da Movatruck.
 * Dezenove itens não se varrem com o olho; viram leitura linha a linha.
 *
 * Os grupos também acompanham os módulos vendidos (shared-types/modulos.ts)
 * sempre que o módulo é coeso. Isso importa comercialmente: contratar Fiscal
 * fazia surgir dois itens no meio de "Sistema", entre Importar dados e
 * WhatsApp — o cliente pagava o adicional e não via nada mudar num lugar que
 * reconhecesse.
 *
 * Um ícone, um conceito: `MapPin` marcava cinco itens diferentes, e ícone
 * repetido deixa de servir como pista de varredura.
 */
const GRUPOS: Grupo[] = [
  {
    titulo: "Dia a dia",
    itens: [
      { href: "/torre", label: "Torre de controle", icon: TowerControl, perm: "programacao.ver" },
      { href: "/programacao", label: "Programação do dia", icon: CalendarDays, perm: "programacao.ver" },
      { href: "/viagens-andamento", label: "Ao vivo", icon: Radio, perm: "viagens.ver" },
      { href: "/mapa", label: "Mapa", icon: Map, perm: "mapa.ver" },
      { href: "/pedidos", label: "Pedidos do cliente", icon: ClipboardList, perm: "pedidos.ver" },
      { href: "/obras", label: "Obras e diárias", icon: HardHat, perm: "alocacoes.ver" },
    ],
  },
  {
    titulo: "Lançamentos",
    itens: [
      { href: "/viagens", label: "Viagens", icon: ClipboardCheck, perm: "viagens.ver" },
      { href: "/abastecimentos", label: "Abastecimentos", icon: Fuel, perm: "abastecimentos.ver" },
      { href: "/conferencias", label: "Conferência de ticket", icon: ScanEye, perm: "conferencia-ticket.ver" },
      { href: "/descargas-suspeitas", label: "Descargas fora do local", icon: ShieldAlert, perm: "descargas-suspeitas.ver" },
      { href: "/lancamentos-travados", label: "Lançamentos que não subiram", icon: LifeBuoy, perm: "lancamentos-resgatados.ver" },
    ],
  },
  {
    titulo: "Faturamento",
    itens: [
      { href: "/fechamentos", label: "Planilhas dos clientes", icon: FileSpreadsheet, perm: "fechamentos.ver" },
      { href: "/envios", label: "Planilhas enviadas", icon: Send, perm: "envios.ver" },
      { href: "/tabelas-preco", label: "Tabela de preços", icon: Tag, perm: "tabelas-preco.ver" },
      { href: "/regras-minimo", label: "Mínimo faturado por km", icon: Ruler, perm: "regras-minimo.ver" },
      { href: "/cte", label: "CT-e emitidos", icon: FileCheck2, perm: "cte.ver" },
    ],
  },
  {
    titulo: "Financeiro",
    itens: [
      { href: "/financeiro", label: "Contas a pagar e receber", icon: Wallet, perm: "financeiro.ver" },
      { href: "/acertos", label: "Acertos com motorista", icon: HandCoins, perm: "acertos.ver" },
    ],
  },
  {
    titulo: "Frota e pessoas",
    itens: [
      { href: "/motoristas", label: "Motoristas", icon: HardHat, perm: "motoristas.ver" },
      { href: "/veiculos", label: "Veículos", icon: Truck, perm: "veiculos.ver" },
      { href: "/frota", label: "Manutenção e documentos", icon: Wrench, perm: "manutencao.ver" },
      { href: "/transportadoras", label: "Transportadoras", icon: Building, perm: "transportadoras.ver" },
      { href: "/pedagios-rodovia", label: "Praças de pedágio", icon: TrafficCone, perm: "pedagios.ver" },
    ],
  },
  {
    titulo: "Cadastros",
    itens: [
      // "Empresas" nomeava DUAS entidades diferentes em dois itens de menu
      // adjacentes. Este é o tomador do serviço — e é o nome que a própria tela
      // sempre usou no h1.
      { href: "/empresas", label: "Empresas-cliente", icon: Building2, perm: "empresas.ver" },
      { href: "/clientes", label: "Clientes", icon: Boxes, perm: "clientes.ver" },
      { href: "/locais", label: "Locais", icon: MapPin, perm: "locais.ver" },
      { href: "/materiais", label: "Materiais", icon: Package, perm: "materiais.ver" },
      { href: "/tipos-servico", label: "Como a viagem é cobrada", icon: Timer, perm: "tipos-servico.ver" },
      { href: "/modalidades", label: "Vínculos do motorista", icon: IdCard, perm: "modalidades.ver" },
      { href: "/tipos-evento-viagem", label: "Paradas e ocorrências", icon: ListChecks, perm: "tipos-evento-viagem.ver" },
      { href: "/documentos-exigidos", label: "Documentos exigidos pela obra", icon: FileCheck2, perm: "documentos-exigidos.ver" },
    ],
  },
  {
    titulo: "Comunicação",
    itens: [
      { href: "/chat", label: "Chat dos motoristas", icon: MessagesSquare, perm: "chat.ver" },
      // O sininho do topo também se chama "Notificações" e é outra coisa: são os
      // avisos PRA VOCÊ. Este é o histórico do que foi disparado pros motoristas.
      { href: "/notificacoes", label: "Avisos enviados ao app", icon: Bell, perm: "notificacoes.ver" },
      { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, perm: "whatsapp.ver" },
    ],
  },
  {
    titulo: "Configurações",
    itens: [
      { href: "/configuracoes/empresa", label: "Minha empresa", icon: Landmark, perm: "minha-empresa.editar" },
      // SEM permissão, de propósito. O modal de aceite bloqueia TODO usuário
      // do painel — ele não pode ser gateado, senão quem não tem a chave
      // ficaria preso nele pra sempre. Se a pessoa é obrigada a aceitar, ela
      // tem que conseguir reler o que aceitou; esconder isso seria obrigar a
      // assinar e negar a cópia.
      { href: "/configuracoes/contrato", label: "Contrato", icon: FileText },
      { href: "/usuarios", label: "Usuários", icon: Users2, perm: "usuarios.ver" },
      { href: "/configuracoes/permissoes", label: "Papéis e permissões", icon: ShieldCheck, perm: "permissoes.gerenciar" },
      { href: "/importacao", label: "Importar dados", icon: Upload, perm: "importacao.ver" },
      { href: "/configuracoes/campos-layout", label: "Colunas da planilha do cliente", icon: Columns3, perm: "config-campos-layout.ver" },
      { href: "/configuracoes/cte", label: "Configurar emissor de CT-e", icon: Settings, perm: "cte.ver" },
      { href: "/configuracoes/tracking", label: "Tracking GPS", icon: Satellite, perm: "config-tracking.ver" },
      { href: "/configuracoes/busca-locais", label: "Busca de locais", icon: Search, perm: "config-busca-locais.ver" },
      { href: "/configuracoes/ia", label: "Inteligência Artificial", icon: Sparkles, perm: "config-ia.ver" },
      { href: "/configuracoes/agente-whatsapp", label: "Agente WhatsApp", icon: Bot, perm: "config-agente.ver" },
      { href: "/configuracoes/km-atipico", label: "Alerta de km fora do padrão", icon: Gauge, perm: "config-km-atipico.ver" },
    ],
  },
  {
    titulo: "Movatruck",
    soPlataforma: true,
    itens: [
      { href: "/demandas", label: "Pedidos de melhoria", icon: Lightbulb, perm: "demandas.ver" },
      { href: "/prospeccao", label: "Captação de clientes", icon: Target, perm: "prospeccao.ver" },
      { href: "/marketing", label: "Instagram da Movatruck", icon: Instagram, perm: "marketing.ver" },
      { href: "/erros", label: "Erros", icon: AlertCircle, perm: "erros.ver" },
      { href: "/diagnosticos", label: "Diagnóstico do app", icon: Activity, perm: "diagnosticos.ver" },
      { href: "/configuracoes/forca-atualizacao", label: "Força-atualização do app", icon: ArrowUpCircle, perm: "config-forca-atualizacao.ver" },
    ],
  },
];

/**
 * Item do menu está ativo? Prefixo cru não serve: `/viagens-andamento` começa
 * com `/viagens`, então "Viagens" acendia junto de "Viagens em andamento".
 * Ativo é a rota exata ou algo abaixo dela (`/viagens/123`).
 */
export function isRotaAtiva(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  mobileOpen = false,
  onMobileClose,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { temPermissao, temModulo, papelNome, plataforma } = usePermissoes();
  const { marca } = useMarcaConta();

  // Itens visíveis por permissão; grupo só aparece se sobrar algum item.
  const gruposVisiveis = GRUPOS.filter((g) => !g.soPlataforma || plataforma)
    .map((g) => ({
      ...g,
      // Menu não é vitrine: item de módulo não contratado SOME, não fica cinza.
      // O upsell mora na tela de quem chegou por URL direta e no ponto de dor
      // dentro de um módulo que a empresa já tem.
      itens: g.itens.filter((i) => !i.perm || (temPermissao(i.perm) && temModulo(i.perm))),
    }))
    .filter((g) => g.itens.length > 0);

  // Accordion: só um grupo aberto por vez. "Dia a dia" é o default ao abrir o
  // painel — é o que a operação usa primeiro. Ao mudar de rota, abre o grupo
  // correspondente.
  const [grupoAberto, setGrupoAberto] = useState<string>("Dia a dia");

  function toggleGrupo(titulo: string) {
    setGrupoAberto((prev) => (prev === titulo ? "" : titulo));
  }

  // Se a rota atual pertence a outro grupo, abre esse grupo
  useEffect(() => {
    for (const grupo of GRUPOS) {
      if (grupo.itens.some((i) => isRotaAtiva(pathname, i.href))) {
        if (grupoAberto !== grupo.titulo) setGrupoAberto(grupo.titulo);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Esc fecha a gaveta — é o gesto que todo mundo tenta antes de procurar o X.
  useEffect(() => {
    if (!mobileOpen) return;
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") onMobileClose?.();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [mobileOpen, onMobileClose]);

  // Fecha gaveta automaticamente quando muda de rota no mobile
  useEffect(() => {
    onMobileClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <>
      {/* Backdrop mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <aside
        className={cn(
          "z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground px-4 py-6",
          "fixed inset-y-0 left-0 transform transition-[transform,visibility]",
          "md:relative md:translate-x-0 md:visible",
          // Fechada, a gaveta só saía de vista por `transform` — continuava no
          // fluxo de foco, então no celular o Tab entrava num menu invisível de
          // 50 links. `invisible` tira do foco; no desktop ela volta a valer.
          mobileOpen
            ? "translate-x-0 shadow-xl"
            : "-translate-x-full invisible md:translate-x-0",
        )}
      >
        <div className="mb-1 flex items-center px-2">
          <LogoConta width={160} className="shrink-0 text-sidebar-foreground" />
          {/* Botão fechar (só mobile) */}
          {onMobileClose && (
            <button
              type="button"
              onClick={onMobileClose}
              className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:hidden"
              aria-label="Fechar menu"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Trocar de empresa: só a equipe da plataforma vê (o componente se
            esconde sozinho). Fica encostado na logo porque é ela que ele troca. */}
        <ContaSwitcher />

        {/* De qual empresa é o que está na tela. Com mais de uma no ar, saber
            onde você está deixa de ser detalhe. Some quando há logo: a logo já
            identifica a empresa, repetir o nome embaixo é redundante. E some
            também pra quem tem o seletor acima, que já diz o nome com todas as
            letras. */}
        {/* Mesma marca lembrada do logo: sem isso o nome aparecia do nada um
            segundo depois e empurrava o menu pra baixo. */}
        {!marca?.logoUrl && !plataforma && (
          <div className="mb-4 h-4 px-2 text-xs font-medium text-muted-foreground">
            {marca?.nome ?? ""}
          </div>
        )}

        <nav className="flex-1 space-y-2 overflow-y-auto">
          {/* Dashboard fora dos grupos — sempre visível */}
          {(() => {
            const Icon = DASHBOARD_ITEM.icon;
            const active = pathname === DASHBOARD_ITEM.href;
            return (
              <Link
                href={DASHBOARD_ITEM.href as any}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {DASHBOARD_ITEM.label}
              </Link>
            );
          })()}

          {/* Relatórios fora dos grupos: transversal, e de uso diário demais pra
              custar dois cliques num accordion de um grupo por vez. */}
          {temPermissao(RELATORIOS_ITEM.perm) && temModulo(RELATORIOS_ITEM.perm) && (
            <Link
              href={RELATORIOS_ITEM.href as any}
              aria-current={isRotaAtiva(pathname, RELATORIOS_ITEM.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isRotaAtiva(pathname, RELATORIOS_ITEM.href)
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <RELATORIOS_ITEM.icon className="h-4 w-4" />
              {RELATORIOS_ITEM.label}
            </Link>
          )}

          {/* Assinantes: só a equipe da plataforma. Não passa pela matriz de
              papéis de propósito — não é permissão que um administrador de
              empresa possa ganhar por engano. O rótulo era "Empresas
              (plataforma)", vizinho de um "Empresas" que abria outra coisa. */}
          {plataforma && (
            <Link
              href={"/contas" as any}
              aria-current={isRotaAtiva(pathname, "/contas") ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                isRotaAtiva(pathname, "/contas")
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Briefcase className="h-4 w-4" />
              Assinantes
            </Link>
          )}

          {gruposVisiveis.map((grupo) => {
            const aberto = grupoAberto === grupo.titulo;
            return (
              <div key={grupo.titulo} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleGrupo(grupo.titulo)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-muted-foreground"
                >
                  <span>{grupo.titulo}</span>
                  {aberto ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
                {aberto &&
                  grupo.itens.map(({ href, label, icon: Icon }) => {
                    const active = isRotaAtiva(pathname, href);
                    return (
                      <Link
                        key={href}
                        href={href as any}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </Link>
                    );
                  })}
              </div>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-sidebar-border pt-4">
          <ThemeSwitcher />
          <div className="flex items-center gap-2 px-2 text-sm">
            <UserCircle className="h-5 w-5 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate font-medium">{session?.user?.name ?? "—"}</p>
              {/* Quem opera a plataforma é outro nível, não um papel da matriz —
                  por isso aparece por cima do papel, e não como um deles. */}
              <p className="truncate text-xs text-muted-foreground">
                {plataforma ? "Super administrador" : (papelNome ?? "—")}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => {
              limparMarca();
              void signOut({ callbackUrl: "/login" });
            }}
          >
            <LogOut className="h-4 w-4" />
            Sair
          </Button>
        </div>
      </aside>
    </>
  );
}
