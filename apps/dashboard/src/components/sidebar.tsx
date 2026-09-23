"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Fragment, useEffect, useState } from "react";
import {
  Activity,
  Compass,
  AlertCircle,
  ArrowUpCircle,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Briefcase,
  Building,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Columns3,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Fuel,
  Gauge,
  SignalHigh,
  HandCoins,
  HardHat,
  IdCard,
  Instagram,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  Lightbulb,
  ListChecks,
  LogOut,
  Map,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Package,
  PenLine,
  Radio,
  Ruler,
  Satellite,
  ScanEye,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Target,
  Timer,
  TowerControl,
  TrafficCone,
  Truck,
  Upload,
  UserCircle,
  Users,
  Users2,
  Wallet,
  Wrench,
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
  /**
   * Abre uma seção DENTRO do grupo, com este rótulo.
   *
   * ⚠️ Existe por causa de "Ajustes", que é longo por natureza — e longo não é
   * defeito num lugar onde a pessoa chega já sabendo que quer configurar algo.
   * O defeito é catorze linhas sem nenhuma pista de onde parar de ler. A seção
   * só aparece se sobrar item nela depois do filtro de permissão: rótulo de
   * seção vazia é pior que rótulo nenhum.
   *
   * ⚠️ TODO item da seção declara o rótulo, não só o primeiro. Declarar só no
   * primeiro parece economia e é defeito: quando é justamente ele que o filtro
   * de permissão remove, os outros ficam órfãos e o cabeçalho some — que é o
   * contrário do que este comentário promete. Repetir é o que faz o rótulo
   * nascer no primeiro item que SOBREVIVER.
   */
  secao?: string;
};

type Grupo = {
  titulo: string;
  /** Âncora estável do passo a passo. Não muda quando o rótulo muda. */
  coach: string;
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
 * "Começar" fica fora dos grupos e SEM permissão, como o Contrato.
 *
 * Sem permissão porque é a tela que explica o caminho: exigir uma chave pra
 * vê-la calaria justamente quem ainda não tem papel configurado — e os passos
 * lá dentro já vêm podados pelo que a pessoa consegue fazer.
 *
 * Aqui em cima, e não no rodapé, porque quem procura por onde começar olha
 * onde começa a lista. Continua valendo depois de pronto: é por esta tela que
 * o dono explica o sistema pro auxiliar que entrou em março.
 */
const COMECAR_ITEM = { href: "/comecar", label: "Começar", icon: Compass };
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
    coach: "grupo-dia-a-dia",
    itens: [
      { href: "/torre", label: "Torre de controle", icon: TowerControl, perm: "programacao.ver" },
      { href: "/programacao", label: "Programação do dia", icon: CalendarDays, perm: "programacao.ver" },
      { href: "/viagens-andamento", label: "Ao vivo", icon: Radio, perm: "viagens.ver" },
      { href: "/mapa", label: "Mapa", icon: Map, perm: "mapa.ver" },
      { href: "/pedidos", label: "Pedidos do cliente", icon: ClipboardList, perm: "pedidos.ver" },
    ],
  },
  {
    titulo: "Lançamentos",
    coach: "grupo-lancamentos",
    itens: [
      { href: "/viagens", label: "Viagens", icon: ClipboardCheck, perm: "viagens.ver" },
      { href: "/abastecimentos", label: "Abastecimentos", icon: Fuel, perm: "abastecimentos.ver" },
      { href: "/conferencias", label: "Conferência de ticket", icon: ScanEye, perm: "conferencia-ticket.ver" },
      { href: "/lancamentos-travados", label: "Lançamentos que não subiram", icon: LifeBuoy, perm: "lancamentos-resgatados.ver" },
    ],
  },
  {
    /**
     * ⚠️ "Faturamento" e "Financeiro" eram DOIS grupos, e pra quem não é
     * contador as duas palavras querem dizer a mesma coisa. Quem procurava
     * "onde vejo o que tenho a receber" abria o errado — e o errado tinha
     * cinco itens plausíveis, então a pessoa nem percebia que tinha errado.
     *
     * Um grupo com a palavra que ela usaria. Dentro, a ordem conta a
     * história: o que eu cobro do cliente primeiro, o que eu pago depois.
     */
    titulo: "Dinheiro",
    coach: "grupo-dinheiro",
    itens: [
      { href: "/fechamentos", label: "Planilhas dos clientes", icon: FileSpreadsheet, perm: "fechamentos.ver" },
      { href: "/envios", label: "Planilhas enviadas", icon: Send, perm: "envios.ver" },
      { href: "/tabelas-preco", label: "Tabela de preços", icon: Tag, perm: "tabelas-preco.ver" },
      { href: "/regras-minimo", label: "Mínimo faturado por km", icon: Ruler, perm: "regras-minimo.ver" },
      { href: "/cte", label: "CT-e emitidos", icon: FileCheck2, perm: "cte.ver" },
      { href: "/financeiro", label: "Contas a pagar e receber", icon: Wallet, perm: "financeiro.ver" },
      { href: "/acertos", label: "Acertos com motorista", icon: HandCoins, perm: "acertos.ver" },
    ],
  },
  {
    /**
     * Quem roda e o que rola — e o que se fala com eles.
     *
     * "Comunicação" era um grupo de três itens raros, e grupo raro custa uma
     * linha de menu o tempo todo pra ser aberto uma vez por mês. Chat e avisos
     * são sobre os motoristas: moram com eles. O WhatsApp foi pra "Ajustes",
     * que é onde se liga e desliga integração.
     */
    titulo: "Frota e pessoas",
    coach: "grupo-frota-e-pessoas",
    itens: [
      { href: "/motoristas", label: "Motoristas", icon: HardHat, perm: "motoristas.ver" },
      { href: "/veiculos", label: "Veículos", icon: Truck, perm: "veiculos.ver" },
      { href: "/frota", label: "Manutenção e documentos", icon: Wrench, perm: "manutencao.ver" },
      { href: "/transportadoras", label: "Transportadoras", icon: Building, perm: "transportadoras.ver" },
      // Veio de "Cadastros", onde ficava no fim de uma lista de tabelas fixas.
      // Não é tabela de apoio: é o que você exige das PESSOAS, e quem procura
      // isso está pensando em motorista, não em cadastro.
      { href: "/documentos-exigidos", label: "Documentos exigidos", icon: FileCheck2, perm: "documentos-exigidos.ver" },
      { href: "/pedagios-rodovia", label: "Praças de pedágio", icon: TrafficCone, perm: "pedagios.ver" },
      { href: "/chat", label: "Chat dos motoristas", icon: MessagesSquare, perm: "chat.ver" },
      // O sininho do topo também se chama "Notificações" e é outra coisa: são os
      // avisos PRA VOCÊ. Este é o histórico do que foi disparado pros motoristas.
      { href: "/notificacoes", label: "Avisos enviados ao app", icon: Bell, perm: "notificacoes.ver" },
    ],
  },
  {
    /**
     * QUEM É REGISTRADO EM CARTEIRA: o ponto eletrônico. (Dividia o grupo com
     * "Obras e diárias", que saiu do sistema em 22/09/2026.)
     */
    titulo: "Registrados",
    coach: "grupo-mensalista",
    itens: [
      { href: "/ponto", label: "Ponto do dia", icon: Clock, perm: "ponto.ver" },
      { href: "/ponto/competencia", label: "Fechar o mês", icon: CalendarCheck, perm: "fechamento-ponto.ver" },
      { href: "/ponto/correcoes", label: "Acerto de ponto", icon: PenLine, perm: "correcoes-ponto.ver" },
      { href: "/ponto/funcionarios", label: "Quem bate ponto", icon: Users, perm: "funcionarios.ver" },
      { href: "/ponto/jornadas", label: "Jornadas e escalas", icon: CalendarRange, perm: "jornadas.ver" },
      { href: "/ponto/configuracoes", label: "Regras de ponto", icon: SlidersHorizontal, perm: "config-ponto.ver" },
    ],
  },
  {
    // Só tabela de apoio: o que se preenche uma vez e se consulta o ano
    // inteiro. Nada que se faça todo dia, e nada que se configure.
    titulo: "Cadastros",
    coach: "grupo-cadastros",
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
      // Fica em Cadastros, não em Frota e pessoas: é tabela que se preenche uma
      // vez e vale pra todo mundo, como as outras deste grupo.
      { href: "/tipos-evento-viagem", label: "Paradas e ocorrências", icon: ListChecks, perm: "tipos-evento-viagem.ver" },
    ],
  },
  {
    /**
     * O que se mexe uma vez e se esquece. É longo de propósito — quem chega
     * aqui já sabe que quer configurar alguma coisa, e o custo de um menu
     * longo só existe pra quem está PROCURANDO. As seções de dentro dão onde
     * parar de ler.
     */
    titulo: "Ajustes",
    coach: "grupo-ajustes",
    itens: [
      { href: "/configuracoes/empresa", label: "Minha empresa", icon: Landmark, perm: "minha-empresa.editar", secao: "Sua conta" },
      // SEM permissão, de propósito. O modal de aceite bloqueia TODO usuário
      // do painel — ele não pode ser gateado, senão quem não tem a chave
      // ficaria preso nele pra sempre. Se a pessoa é obrigada a aceitar, ela
      // tem que conseguir reler o que aceitou; esconder isso seria obrigar a
      // assinar e negar a cópia.
      { href: "/configuracoes/contrato", label: "Contrato", icon: FileText, secao: "Sua conta" },
      { href: "/usuarios", label: "Usuários", icon: Users2, perm: "usuarios.ver", secao: "Sua conta" },
      { href: "/configuracoes/permissoes", label: "Papéis e permissões", icon: ShieldCheck, perm: "permissoes.gerenciar", secao: "Sua conta" },
      // O app do motorista é a outra metade de "Papéis e permissões" (abas no
      // topo das duas telas). Item próprio porque a permissão é outra.
      { href: "/acesso-app", label: "Permissões do app", icon: SlidersHorizontal, perm: "perfis-acesso.ver", secao: "Sua conta" },
      { href: "/importacao", label: "Importar dados", icon: Upload, perm: "importacao.ver", secao: "Sua conta" },

      { href: "/configuracoes/campos-layout", label: "Colunas da planilha do cliente", icon: Columns3, perm: "config-campos-layout.ver", secao: "Como o sistema se comporta" },
      { href: "/configuracoes/cte", label: "Configurar emissor de CT-e", icon: Settings, perm: "cte.ver", secao: "Como o sistema se comporta" },
      { href: "/configuracoes/tracking", label: "Tracking GPS", icon: Satellite, perm: "config-tracking.ver", secao: "Como o sistema se comporta" },
      { href: "/configuracoes/busca-locais", label: "Busca de locais", icon: Search, perm: "config-busca-locais.ver", secao: "Como o sistema se comporta" },
      { href: "/configuracoes/km-atipico", label: "Alerta de km fora do padrão", icon: Gauge, perm: "config-km-atipico.ver", secao: "Como o sistema se comporta" },
      { href: "/configuracoes/torre", label: "Alertas da torre", icon: SignalHigh, perm: "programacao.ver", secao: "Como o sistema se comporta" },

      /**
       * Chaves de `RECURSOS_PLATAFORMA`: a empresa não as recebe, então na
       * prática esta seção só existe pra nós.
       *
       * ⚠️ NÃO foram pro grupo "Movatruck", e isso é decisão: a chave PODE ser
       * concedida a um cliente caso a caso pela matriz (está escrito lá), e num
       * grupo `soPlataforma` ele receberia a permissão e continuaria sem o
       * menu. A seção rotula sem esconder.
       */
      { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, perm: "whatsapp.ver", secao: "Ferramentas da Movatruck" },
      { href: "/configuracoes/ia", label: "Inteligência Artificial", icon: Sparkles, perm: "config-ia.ver", secao: "Ferramentas da Movatruck" },
      { href: "/configuracoes/agente-whatsapp", label: "Agente WhatsApp", icon: Bot, perm: "config-agente.ver", secao: "Ferramentas da Movatruck" },
    ],
  },
  {
    titulo: "Movatruck",
    coach: "grupo-movatruck",
    soPlataforma: true,
    itens: [
      /**
       * ⚠️ Vivia SOLTO acima dos grupos, como caso especial escrito à mão —
       * uma ferramenta da plataforma no meio do menu do cliente.
       *
       * Não tem chave de permissão nenhuma de propósito (o gate é a flag
       * `plataforma`), e é justamente por isso que aqui é seguro: este grupo
       * tem o MESMO gate. Os outros recursos de plataforma continuam fora
       * daqui porque a chave deles pode ser concedida a um cliente caso a
       * caso — a deste não pode.
       */
      { href: "/contas", label: "Assinantes", icon: Briefcase },
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

          {(() => {
            const Icon = COMECAR_ITEM.icon;
            const active = isRotaAtiva(pathname, COMECAR_ITEM.href);
            return (
              <Link
                href={COMECAR_ITEM.href as any}
                aria-current={active ? "page" : undefined}
                // Âncora do passo a passo. Fica num item SOLTO de propósito:
                // dentro de grupo do accordion, o alvo mede 0x0 quando o grupo
                // está fechado, e o furo sairia no canto da tela.
                data-coach="comecar"
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {COMECAR_ITEM.label}
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

          {gruposVisiveis.map((grupo) => {
            const aberto = grupoAberto === grupo.titulo;
            return (
              <div key={grupo.titulo} className="space-y-1">
                <button
                  type="button"
                  // O cabeçalho do grupo é medível mesmo fechado — por isso o
                  // tour aponta pra ele, e não pro item lá dentro.
                  //
                  // A chave é declarada no grupo, não derivada do título: o
                  // título tem acento ("Lançamentos") e pode ser renomeado, e
                  // nos dois casos o alvo do tour deixaria de casar EM SILÊNCIO.
                  data-coach={grupo.coach}
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
                  grupo.itens.map(({ href, label, icon: Icon, secao }, i) => {
                    const active = isRotaAtiva(pathname, href);
                    /**
                     * O rótulo da seção sai no PRIMEIRO item dela que
                     * sobreviveu ao filtro de permissão.
                     *
                     * ⚠️ Por isso a comparação é com o item anterior da lista
                     * JÁ FILTRADA, e não com a declaração: quando a pessoa não
                     * tem nenhuma chave da seção, o rótulo simplesmente não
                     * chega a existir. Renderizar pela declaração deixaria um
                     * título de seção sobre o vazio.
                     */
                    const abreSecao = secao != null && secao !== grupo.itens[i - 1]?.secao;
                    return (
                      <Fragment key={href}>
                        {abreSecao && (
                          <p className="mt-3 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                            {secao}
                          </p>
                        )}
                        <Link
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
                      </Fragment>
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
