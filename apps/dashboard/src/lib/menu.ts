import {
  Activity,
  Compass,
  AlertCircle,
  ArrowUpCircle,
  BarChart3,
  Bell,
  Bot,
  Briefcase,
  Building,
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileCheck2,
  FileSpreadsheet,
  Fuel,
  HandCoins,
  HardHat,
  Home,
  Instagram,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  Map,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Package,
  PenLine,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TowerControl,
  TrafficCone,
  TrendingUp,
  Truck,
  Upload,
  Users,
  Users2,
  Wallet,
  Wrench,
} from "lucide-react";
import type { MenuDescricao } from "@ronan/shared-types";
import { usePermissoes } from "@/lib/permissoes";

/**
 * O MENU DO PAINEL — fonte única. Quem desenha navegação (sidebar no desktop,
 * folha "Mais" e barra inferior no celular) lê daqui, e só daqui: a lista de
 * telas e a regra de quem pode ver o quê (permissão + módulo + aba `ou` +
 * `soPlataforma`) existem UMA vez. Antes a barra inferior tinha lista e filtro
 * próprios e já divergiu da sidebar uma vez.
 *
 * Nada aqui decide acesso por conta própria: `temPermissao`/`temModulo` vêm da
 * matriz de papéis e do contrato da empresa (usePermissoes).
 */

export type Item = {
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
  /**
   * As outras abas do mesmo item, em ordem: quem não tem `perm` cai na
   * primeira aba que pode ver (`perm` ausente = qualquer um), e o item fica
   * aceso em todas as rotas.
   *
   * Existe porque telas-irmãs viraram abas de um item só (23/09/2026): Papéis
   * e permissões (painel + app do motorista) e Minha empresa (dados + emissor
   * de CT-e + contrato). Eram itens separados no menu, com permissões
   * diferentes cada um.
   */
  ou?: { href: string; perm?: string }[];
  /**
   * Partes DENTRO desta tela que têm permissão própria (aba interna, seção,
   * botão que abre outra coisa). Não mudam o menu nem quem abre a tela — só
   * dizem à matriz de papéis onde a permissão mora. Sem isto, Pneus e Multas
   * apareciam em "Sem item próprio no menu" e ninguém achava (24/09/2026).
   */
  partes?: { perm: string; label: string }[];
};

export type Grupo = {
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

export const DASHBOARD_ITEM: Item = { href: "/", label: "Dashboard", icon: LayoutDashboard };

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
export const COMECAR_ITEM: Item = { href: "/comecar", label: "Começar", icon: Compass };
/**
 * Relatórios fica FORA dos grupos: é transversal e de uso diário, e o accordion
 * de um grupo por vez transformaria cada consulta em dois cliques. O href é o
 * hub (/relatorios), não uma das abas — apontar pra folha deixava o menu sem
 * nada aceso em 3 das 4 telas de relatório.
 */
export const RELATORIOS_ITEM = {
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
export const GRUPOS: Grupo[] = [
  {
    titulo: "Dia a dia",
    coach: "grupo-dia-a-dia",
    itens: [
      { href: "/torre", label: "Torre de controle", icon: TowerControl, perm: "torre.ver", ou: [{ href: "/configuracoes/torre", perm: "config-torre.ver" }] },
      { href: "/programacao", label: "Programação do dia", icon: CalendarDays, perm: "programacao.ver" },
      { href: "/viagens-andamento", label: "Ao vivo", icon: Radio, perm: "ao-vivo.ver" },
      { href: "/mapa", label: "Mapa", icon: Map, perm: "mapa.ver", ou: [{ href: "/configuracoes/tracking", perm: "config-tracking.ver" }] },
      { href: "/pedidos", label: "Pedidos do cliente", icon: ClipboardList, perm: "pedidos.ver" },
    ],
  },
  {
    titulo: "Lançamentos",
    coach: "grupo-lancamentos",
    itens: [
      {
        href: "/viagens",
        label: "Viagens",
        icon: ClipboardCheck,
        perm: "viagens.ver",
        // Abas: Conferir tickets, Esqueceu de lançar?, Não chegaram e as
        // engrenagens ⚙ Campos no app, ⚙ Paradas e imprevistos, ⚙ Km fora do
        // padrão e ⚙ Quando perguntar.
        ou: [
          { href: "/conferencias", perm: "conferencia-ticket.ver" },
          { href: "/conferencia-diaria", perm: "conferencia-diaria.ver" },
          { href: "/lancamentos-travados", perm: "lancamentos-resgatados.ver" },
          { href: "/tipos-servico", perm: "tipos-servico.ver" },
          { href: "/tipos-evento-viagem", perm: "tipos-evento-viagem.ver" },
          { href: "/configuracoes/km-atipico", perm: "config-km-atipico.ver" },
          { href: "/configuracoes/conferencia-diaria", perm: "config-conferencia-diaria.ver" },
        ],
      },
      {
        href: "/abastecimentos",
        label: "Abastecimentos",
        icon: Fuel,
        perm: "abastecimentos.ver",
        // Aba: o extrato do cartão combustível ao lado do que foi lançado.
        ou: [{ href: "/cartao-combustivel", perm: "cartao-combustivel.ver" }],
      },
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
      // Abas: conferir a planilha dele, mandar a minha e ⚙ como ler a planilha.
      {
        href: "/fechamentos",
        label: "Fechamento com o cliente",
        icon: FileSpreadsheet,
        perm: "fechamentos.ver",
        ou: [
          { href: "/envios", perm: "envios.ver" },
          { href: "/configuracoes/campos-layout", perm: "config-campos-layout.ver" },
        ],
      },
      // Abas: preço e mínimo (km e tonelada).
      { href: "/cte", label: "CT-e emitidos", icon: FileCheck2, perm: "cte.ver" },
      { href: "/financeiro", label: "Contas a pagar e receber", icon: Wallet, perm: "financeiro.ver" },
      { href: "/acertos", label: "Acertos com motorista", icon: HandCoins, perm: "acertos.ver" },
      { href: "/lucro", label: "Lucro por caminhão", icon: TrendingUp, perm: "lucro-caminhao.ver" },
    ],
  },
  {
    /**
     * Quem roda e o que rola — e o que se fala com eles.
     *
     * "Comunicação" era um grupo de três itens raros, e grupo raro custa uma
     * linha de menu o tempo todo pra ser aberto uma vez por mês. Chat e avisos
     * são sobre os motoristas: moram com eles. O WhatsApp é da plataforma e
     * mora no grupo "Movatruck".
     */
    titulo: "Frota e pessoas",
    coach: "grupo-frota-e-pessoas",
    itens: [
      {
        href: "/motoristas",
        label: "Motoristas",
        icon: HardHat,
        perm: "motoristas.ver",
        ou: [{ href: "/modalidades", perm: "modalidades.ver" }],
        partes: [{ perm: "coletas.ver", label: "Pedir documentos por link" }],
      },
      {
        href: "/veiculos",
        label: "Veículos",
        icon: Truck,
        perm: "veiculos.ver",
        // Bloco "Custos fixos" dentro da página do caminhão.
        partes: [{ perm: "custos-veiculo.ver", label: "Custos fixos" }],
      },
      {
        href: "/frota",
        label: "Manutenção",
        icon: Wrench,
        perm: "manutencao.ver",
        partes: [
          { perm: "pneus.ver", label: "Pneus" },
          { perm: "multas.ver", label: "Multas" },
          { perm: "documentos-veiculo.ver", label: "Documentos do caminhão" },
          { perm: "custos-manutencao.ver", label: "Custos" },
        ],
      },
      { href: "/transportadoras", label: "Transportadoras", icon: Building, perm: "transportadoras.ver" },
      // "Documentos exigidos" saiu daqui em 23/09/2026: virou a aba "Documentos
      // que pedimos" de Minha empresa, e aparece também na página de cada
      // cliente e em Quem bate ponto — onde a pessoa está quando precisa dela.
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
      {
        href: "/ponto/funcionarios",
        label: "Quem bate ponto",
        icon: Users,
        perm: "funcionarios.ver",
        partes: [{ perm: "espelho-ponto.ver", label: "Espelho de ponto" }],
      },
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
      // Nomes decididos em 23/09/2026: o model `Empresa` é o CLIENTE (quem
      // paga) e o model `Cliente` é a OBRA (onde se trabalha). As obras moram
      // dentro da página do cliente — "Obras" solto no menu era o mesmo nome
      // digitado duas vezes em 33 de 34 casos. /clientes continua abrindo.
      {
        href: "/empresas",
        label: "Clientes",
        icon: Building2,
        perm: "empresas.ver",
        // Abas: Preço e Mínimo (km e tonelada) — regras de cada cliente.
        ou: [
          { href: "/tabelas-preco", perm: "tabelas-preco.ver" },
          { href: "/regras-minimo", perm: "regras-minimo.ver" },
        ],
        // As obras moram dentro da página de cada cliente.
        partes: [{ perm: "clientes.ver", label: "Obras" }],
      },
      { href: "/locais", label: "Locais", icon: MapPin, perm: "locais.ver", ou: [{ href: "/configuracoes/busca-locais", perm: "config-busca-locais.ver" }] },
      { href: "/materiais", label: "Materiais", icon: Package, perm: "materiais.ver" },
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
      // Quatro abas num item: dados da empresa, emissor de CT-e, documentos
      // que pedimos e contrato.
      // O Contrato é a última alternativa e SEM permissão, de propósito: o
      // modal de aceite bloqueia TODO usuário do painel, e quem é obrigado a
      // aceitar tem que conseguir reler o que aceitou — por isso o item
      // aparece pra todo mundo, abrindo no Contrato quem não vê as outras.
      {
        href: "/configuracoes/empresa",
        label: "Minha empresa",
        icon: Landmark,
        perm: "minha-empresa.editar",
        ou: [
          { href: "/configuracoes/cte", perm: "config-cte.ver" },
          { href: "/documentos-exigidos", perm: "documentos-exigidos.ver" },
          { href: "/configuracoes/contrato" },
        ],
      },
      { href: "/usuarios", label: "Usuários", icon: Users2, perm: "usuarios.ver" },
      // Um item só pras duas abas (painel do escritório e app do motorista).
      // Quem só pode ver a do app cai direto nela.
      {
        href: "/configuracoes/permissoes",
        label: "Papéis e permissões",
        icon: ShieldCheck,
        perm: "permissoes.gerenciar",
        ou: [{ href: "/acesso-app", perm: "perfis-acesso.ver" }],
      },
      { href: "/importacao", label: "Importar dados", icon: Upload, perm: "importacao.ver" },
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
      /**
       * Chaves que nunca são concedidas a cliente: o número de WhatsApp é um
       * só, dividido por todas as empresas, e o agente está desligado de
       * propósito. (Os modelos de IA de cada empresa moram em Assinantes — o
       * modelo e o custo são decisão da plataforma.) Se um dia uma dessas
       * chaves for dada a um cliente, o item volta pra "Ajustes".
       */
      { href: "/whatsapp", label: "WhatsApp", icon: MessageCircle, perm: "whatsapp.ver" },
      { href: "/configuracoes/agente-whatsapp", label: "Agente WhatsApp", icon: Bot, perm: "config-agente.ver" },
    ],
  },
];

/**
 * O menu sem ícones, na ordem em que aparece — pra matriz de papéis
 * (/configuracoes/permissoes) se agrupar por ele. Derivado de GRUPOS: mover um
 * item de grupo ou transformá-lo em aba aqui já muda a matriz.
 *
 * Relatórios entra como seção própria (é item solto no menu). Dashboard e
 * Começar não entram: não têm permissão, não há o que marcar.
 */
export function estruturaDoMenu(): MenuDescricao {
  return [
    {
      titulo: RELATORIOS_ITEM.label,
      itens: [{ label: RELATORIOS_ITEM.label, href: RELATORIOS_ITEM.href, perm: RELATORIOS_ITEM.perm, abas: [] }],
    },
    ...GRUPOS.map((g) => ({
      titulo: g.titulo,
      soPlataforma: g.soPlataforma,
      itens: g.itens.map((i) => ({
        label: i.label,
        href: i.href,
        perm: i.perm,
        abas: [
          ...(i.ou ?? []).map((o) => ({ href: o.href, perm: o.perm })),
          ...(i.partes ?? []).map((p) => ({ href: i.href, perm: p.perm, label: p.label })),
        ],
      })),
    })),
  ];
}

/**
 * Item do menu está ativo? Prefixo cru não serve: `/viagens-andamento` começa
 * com `/viagens`, então "Viagens" acendia junto de "Viagens em andamento".
 * Ativo é a rota exata ou algo abaixo dela (`/viagens/123`).
 */
/**
 * Âncoras do passo a passo que moram no menu ("Começar" + os grupos). Quando o menu
 * está fora da tela — folha "Mais" do celular, gaveta recolhida do MacBook — o botão
 * que o abre declara todas elas e serve de alvo no lugar (ver `medirAlvo` em lib/tour.ts).
 */
export const ANCORAS_DO_MENU = ["comecar", ...GRUPOS.map((g) => g.coach)].join(" ");

export function isRotaAtiva(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** O item acende na rota dele e na da outra aba (`ou`), quando tem. */
export function itemAtivo(pathname: string, item: Pick<Item, "href" | "ou">): boolean {
  return isRotaAtiva(pathname, item.href) || (item.ou ?? []).some((o) => isRotaAtiva(pathname, o.href));
}

/** O que a pessoa pode ver, item a item. `base` é o href declarado no menu; `href` pode ter caído numa aba `ou`. */
export type ItemVisivel = Item & { base: string };
export type GrupoVisivel = Omit<Grupo, "itens"> & { itens: ItemVisivel[] };

export type ContextoMenu = {
  temPermissao: (chave: string) => boolean;
  temModulo: (chave: string) => boolean;
  plataforma: boolean;
};

/**
 * O filtro do menu, puro (sem React) pra poder ser testado com papéis e módulos
 * variados. `topo` = itens soltos acima dos grupos (Dashboard, Começar e, se a
 * pessoa puder, Relatórios); `grupos` = grupos com pelo menos um item visível.
 */
export function filtrarMenu({ temPermissao, temModulo, plataforma }: ContextoMenu): {
  topo: ItemVisivel[];
  grupos: GrupoVisivel[];
} {
  const topo: ItemVisivel[] = [DASHBOARD_ITEM, COMECAR_ITEM].map((i) => ({ ...i, base: i.href }));
  // Relatórios fora dos grupos: transversal, e de uso diário demais pra custar
  // dois cliques num accordion de um grupo por vez.
  if (temPermissao(RELATORIOS_ITEM.perm) && temModulo(RELATORIOS_ITEM.perm)) {
    topo.push({ ...RELATORIOS_ITEM, base: RELATORIOS_ITEM.href });
  }

  // Itens visíveis por permissão; grupo só aparece se sobrar algum item.
  const grupos = GRUPOS.filter((g) => !g.soPlataforma || plataforma)
    .map((g) => ({
      ...g,
      // Menu não é vitrine: item de módulo não contratado SOME, não fica cinza.
      // O upsell mora na tela de quem chegou por URL direta e no ponto de dor
      // dentro de um módulo que a empresa já tem.
      itens: g.itens.flatMap((i): ItemVisivel[] => {
        if (!i.perm || (temPermissao(i.perm) && temModulo(i.perm))) return [{ ...i, base: i.href }];
        // Sem a principal, mas com a outra aba: o item abre direto nela.
        const aba = (i.ou ?? []).find((o) => !o.perm || (temPermissao(o.perm) && temModulo(o.perm)));
        if (aba) return [{ ...i, href: aba.href, base: i.href }];
        return [];
      }),
    }))
    .filter((g) => g.itens.length > 0);

  return { topo, grupos };
}

/** O menu que ESTA pessoa pode ver. Sidebar, folha "Mais" e barra inferior consomem isto. */
export function useMenuVisivel() {
  const { temPermissao, temModulo, plataforma } = usePermissoes();
  return filtrarMenu({ temPermissao, temModulo, plataforma });
}

/** Tira acento e caixa: "Lançamentos" casa com "lancamen". */
export function normalizarBusca(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/** Todo href que o menu declara (item + abas `ou`), visível ou não. */
function hrefsDoMenu(): string[] {
  const todos: Item[] = [DASHBOARD_ITEM, COMECAR_ITEM, RELATORIOS_ITEM, ...GRUPOS.flatMap((g) => g.itens)];
  return todos.flatMap((i) => [i.href, ...(i.ou ?? []).map((o) => o.href)]);
}

/**
 * Página RAIZ = destino de navegação (barra inferior, sem botão Voltar): a home,
 * qualquer rota de um segmento só e qualquer rota que o menu declara (item ou
 * aba `ou`, ex.: /ponto/competencia, /configuracoes/km-atipico). Filha =
 * /motoristas/[id], /viagens/nova, /motoristas/[id]/editar…
 */
export function ehPaginaRaiz(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/") return true;
  if (p.split("/").filter(Boolean).length <= 1) return true;
  return hrefsDoMenu().includes(p);
}

/** Rota "pai" (uma a menos), pro Voltar quando não há histórico. */
export function rotaPai(pathname: string): string {
  const seg = pathname.split("/").filter(Boolean);
  seg.pop();
  return seg.length ? `/${seg.join("/")}` : "/";
}

/**
 * Título de cabeçalho por rota, vindo do próprio menu: o item cujo href (ou aba
 * `ou`) é o prefixo mais longo da rota. É o FALLBACK — a tela que quiser um
 * título melhor declara o dela (usePageTitle) e ganha deste.
 */
export function tituloDaRota(pathname: string): string | null {
  let melhor: { len: number; label: string } | null = null;
  const candidatos: Item[] = [DASHBOARD_ITEM, COMECAR_ITEM, RELATORIOS_ITEM, ...GRUPOS.flatMap((g) => g.itens)];
  for (const i of candidatos) {
    for (const href of [i.href, ...(i.ou ?? []).map((o) => o.href)]) {
      if (href === "/") continue;
      if (isRotaAtiva(pathname, href) && (!melhor || href.length > melhor.len)) melhor = { len: href.length, label: i.label };
    }
  }
  return melhor?.label ?? null;
}

/**
 * SEMENTE da barra inferior do celular: candidatos em ordem de prioridade. A
 * barra mostra os 4 primeiros que ESTA pessoa pode ver (mesmo filtro do menu):
 * quem não tem um destino ganha o próximo, em vez de uma barra manca.
 *
 * É só a ordem inicial de preferência — nome, ícone, permissão, módulo e o href
 * a abrir (que pode ter caído numa aba `ou`) vêm do menu, nunca daqui. `rotulo`
 * e `icon` só existem quando o nome do menu não cabe embaixo de um ícone.
 */
export const SEMENTE_BARRA: { href: string; rotulo?: string; icon?: Item["icon"] }[] = [
  { href: "/", rotulo: "Início", icon: Home },
  { href: "/viagens" },
  { href: "/viagens-andamento" },
  { href: "/motoristas" },
  { href: "/torre", rotulo: "Torre" },
  { href: "/pedidos", rotulo: "Pedidos" },
  { href: "/veiculos" },
];

export const DESTINOS_NA_BARRA = 4;

export type DestinoBarra = ItemVisivel & { rotulo: string };

/** Os destinos da barra inferior: os primeiros candidatos da semente que o menu visível contém. */
export function destinosDaBarra(menu: { topo: ItemVisivel[]; grupos: GrupoVisivel[] }): DestinoBarra[] {
  const visiveis = [...menu.topo, ...menu.grupos.flatMap((g) => g.itens)];
  const achados: DestinoBarra[] = [];
  for (const cand of SEMENTE_BARRA) {
    const item = visiveis.find((i) => i.base === cand.href);
    if (!item) continue;
    achados.push({ ...item, icon: cand.icon ?? item.icon, rotulo: cand.rotulo ?? item.label });
    if (achados.length === DESTINOS_NA_BARRA) break;
  }
  return achados;
}
