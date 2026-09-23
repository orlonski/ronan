import { z } from "zod";

/**
 * Catálogo de permissões do RBAC — fonte ÚNICA, usada pelo backend (seed +
 * papéis sistema + guard) e pelo frontend (sidebar, TelaGuard, matriz de papéis).
 *
 * Permissão = `recurso.acao` (ex.: "viagens.editar"). `recurso.ver` = acesso à
 * tela; as demais ações gatam botões (frontend) e endpoints de escrita (backend).
 *
 * ESTRUTURA DINÂMICA — pra colocar uma TELA ou AÇÃO nova sob permissão, são 3
 * passos, sem refactor:
 *   1) Adicionar a chave aqui (no RESOURCE_DEFS).
 *   2) Gatar a UI: `temPermissao("recurso.acao")` no botão (ou <RequerTela>).
 *   3) Anotar o endpoint: `@RequerPermissao("recurso.acao")`.
 * O seed sincroniza o catálogo (upsert + poda), o papel Administrador ganha a
 * chave nova automaticamente e a matriz de papéis exibe sozinha.
 */
export type PermissaoCatalogo = {
  chave: string;
  modulo: string;
  titulo: string;
  descricao?: string;
  ordem: number;
};

// Rótulo amigável de cada ação (usado como label da checkbox na matriz).
const ACAO_TITULO: Record<string, string> = {
  ver: "Ver / acessar",
  "ver-comercial": "Ver dados comerciais",
  "alterar-valor": "Alterar valor faturado (com motivo)",
  criar: "Criar",
  editar: "Editar",
  excluir: "Excluir",
  validar: "Pré-validar",
  compartilhar: "Compartilhar (link público)",
  corrigir: "Corrigir local",
  conferir: "Conferir / resolver",
  exportar: "Exportar",
  aprovar: "Aprovar cadastro",
  documentos: "Documentos",
  layouts: "Layouts (envio/import)",
  homologar: "Homologar / mesclar",
  importar: "Importar",
  resolver: "Resolver",
  reprocessar: "Mandar reler (gasta leitura paga)",
  avisar: "Publicar aviso",
  publicar: "Publicar (avisa o motorista)",
  moderar: "Moderar denúncias",
  gerenciar: "Gerenciar",
  aplicar: "Aplicar a vários motoristas",
  gerar: "Gerar / lançar item",
  faturar: "Faturar / lançar conta",
  baixar: "Dar baixa (dinheiro entrou/saiu)",
  fechar: "Fechar (vira combinado)",
  pagar: "Marcar como pago",
  expurgar: "Expurgar histórico",
  desligar: "Registrar desligamento",
  lancar: "Lançar correção (com motivo)",
  decidir: "Aprovar ou recusar correção",
  reabrir: "Reabrir competência fechada (com motivo)",
  // ⚠️ Estas seis apareciam na matriz como a CHAVE CRUA ("ver-localizacao",
  // "executar"), porque o fallback é `ACAO_TITULO[acao] ?? acao`. A pior era
  // `ver-localizacao`: a permissão mais sensível de privacidade do sistema era
  // justamente a que aparecia sem tradução, num lugar onde alguém decide se
  // libera ou não.
  encerrar: "Encerrar alocação",
  configurar: "Configurar o espelho",
  "ver-localizacao": "Ver onde a pessoa bateu o ponto",
  executar: "Rodar a importação",
  emitir: "Emitir CT-e",
  cancelar: "Cancelar CT-e",
};

/**
 * Rótulo de ação que muda de sentido conforme o RECURSO.
 *
 * ⚠️ `ACAO_TITULO` é uma tabela plana por nome de ação, então o texto escrito
 * pensando num recurso vazava pros outros: `importar` estava descrito como
 * "Importar (OSM)" — verdade pra praça de pedágio, e mentira na linha de
 * funcionários, onde importar planilha de gente aparecia como importar do
 * OpenStreetMap.
 */
const ACAO_TITULO_POR_RECURSO: Record<string, string> = {
  "pedagios.importar": "Importar praças de base pública (OSM)",
  "funcionarios.importar": "Importar funcionários por planilha",
  "prospeccao.importar": "Importar a base da ANTT",
};

type ResourceDef = { recurso: string; label: string; modulo: string; acoes: string[] };

// Ordem aqui = ordem na matriz. `acoes` em ordem de exibição.
const RESOURCE_DEFS: ResourceDef[] = [
  // ---- Operação ----
  // "ver-comercial" libera o que é da relação Schaba↔cliente dentro da viagem:
  // cliente/empresa, mínimo aplicado, km e toneladas faturados, fechamento.
  // Sem ela o backend OMITE esses campos do payload — quem não precisa (gestor
  // de frota terceira) vê só o operacional.
  // "compartilhar" gera link público do comprovante pro cliente. Exige TAMBÉM
  // "ver-comercial" no endpoint: o comprovante mostra km/toneladas faturados,
  // então quem não enxerga isso no painel não pode gerar link que mostre.
  { recurso: "viagens", label: "Viagens (lista e ao vivo)", modulo: "Operação", acoes: ["ver", "ver-comercial", "editar", "excluir", "validar", "compartilhar", "alterar-valor"] },
  { recurso: "abastecimentos", label: "Abastecimentos", modulo: "Operação", acoes: ["ver", "editar", "excluir"] },
  { recurso: "fechamentos", label: "Fechamento com o cliente — conferir a planilha dele", modulo: "Operação", acoes: ["ver", "criar", "conferir", "exportar", "excluir"] },
  { recurso: "envios", label: "Fechamento com o cliente — mandar a minha planilha", modulo: "Operação", acoes: ["ver", "criar", "excluir"] },
  // O que a empresa deve a cada motorista no período. Três ações separadas de
  // propósito: montar o acerto é trabalho de escritório; dizer que está
  // combinado (fechar) e que o dinheiro saiu (pagar) é decisão de quem responde
  // pelo caixa, e raramente é a mesma pessoa.
  { recurso: "acertos", label: "Acertos com motorista", modulo: "Operação", acoes: ["ver", "gerar", "fechar", "pagar"] },
  // O que o cliente pediu, e o quadro de quem leva o quê. Recursos separados
  // porque quem negocia o pedido com o cliente raramente é quem monta a escala
  // do dia. `publicar` é à parte de `editar` pelo mesmo motivo que em marketing:
  // montar é rascunho, publicar avisa gente de fora e vira combinado.
  { recurso: "pedidos", label: "Pedidos do cliente", modulo: "Operação", acoes: ["ver", "criar", "editar", "excluir"] },
  // A admissão: o que o contratante exige antes do caminhão entrar na obra, e
  // o link por onde esses papéis chegam. `coletas.criar` é separado de `ver`
  // porque gerar link é expor documento de alguém a quem tiver a URL — é ação
  // com consequência, não consulta.
  { recurso: "documentos-exigidos", label: "Documentos que pedimos (Minha empresa)", modulo: "Cadastros", acoes: ["ver", "editar"] },
  { recurso: "coletas", label: "Link de coleta de documentos", modulo: "Operação", acoes: ["ver", "criar"] },

  // ---- Pessoas: o ponto eletrônico (funcionário CLT) ----
  //
  // ⚠️ GRUPO PRÓPRIO, e isso não é organização visual: `PERMISSOES_OPERADOR`
  // filtra literalmente por `modulo === "Operação" || "Cadastros"`. Pôr ponto
  // em qualquer um dos dois entregaria o espelho e o fechamento de jornada pro
  // papel Operador de TODA conta, de graça, no próximo seed.
  //
  // As separações de ação são deliberadas: `lancar` (o gestor incluir uma
  // marcação em nome de alguém) é outro poder que `decidir` (aprovar o que a
  // pessoa pediu), e `reabrir` uma competência fechada é outro poder que
  // `fechar`.
  // `ver-localizacao` é ação SEPARADA de propósito: ver que alguém bateu às
  // 7h12 e ver ONDE a pessoa estava às 7h12 não são o mesmo poder. Sem a
  // separação, dar a tela do dia pra quem confere presença entregaria junto a
  // localização de todo mundo, todo dia.
  { recurso: "ponto", label: "Ponto do dia", modulo: "Pessoas", acoes: ["ver", "ver-localizacao"] },
  { recurso: "funcionarios", label: "Quem bate ponto", modulo: "Pessoas", acoes: ["ver", "criar", "editar", "desligar", "importar"] },
  { recurso: "jornadas", label: "Jornadas e escalas", modulo: "Pessoas", acoes: ["ver", "editar"] },
  { recurso: "espelho-ponto", label: "Espelho de ponto", modulo: "Pessoas", acoes: ["ver", "exportar"] },
  { recurso: "correcoes-ponto", label: "Acerto de ponto", modulo: "Pessoas", acoes: ["ver", "lancar", "decidir"] },
  { recurso: "fechamento-ponto", label: "Fechar o mês", modulo: "Pessoas", acoes: ["ver", "fechar", "reabrir"] },
  { recurso: "config-ponto", label: "Regras de ponto", modulo: "Pessoas", acoes: ["ver", "editar"] },
  // Contas a receber e a pagar. `baixar` é separado de `faturar` porque emitir a
  // cobrança é trabalho de escritório e dizer que o dinheiro entrou é de quem
  // responde pelo caixa — e quase nunca é a mesma pessoa.
  { recurso: "financeiro", label: "Contas a pagar e receber", modulo: "Operação", acoes: ["ver", "faturar", "baixar"] },
  { recurso: "fornecedores", label: "Fornecedores", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "custos-veiculo", label: "Custos fixos do veículo", modulo: "Cadastros", acoes: ["ver", "editar"] },
  // Manutenção, pneu, documento do veículo e multa — o que some do radar e vira
  // caminhão parado ou multa vencida.
  { recurso: "manutencao", label: "Manutenção e vencimentos do caminhão", modulo: "Operação", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "pneus", label: "Pneus", modulo: "Operação", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "multas", label: "Multas", modulo: "Operação", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "documentos-veiculo", label: "Documentos do veículo", modulo: "Cadastros", acoes: ["ver", "editar"] },
  { recurso: "programacao", label: "Torre de controle, programação e alertas", modulo: "Operação", acoes: ["ver", "editar", "publicar"] },
  // Relatório de produção por período. Agrupar por cliente/empresa (ou filtrar
  // por eles) exige TAMBÉM "viagens.ver-comercial" no endpoint: o agrupamento
  // por cliente É a carteira, e as colunas de km/toneladas faturados são as
  // mesmas que `admin/viagens/comercial.ts` omite de quem não tem a chave.
  { recurso: "relatorios", label: "Relatórios", modulo: "Operação", acoes: ["ver", "exportar"] },
  // Lançamentos que o app não conseguiu enviar e ficaram guardados aqui pra não
  // se perder. "resolver" é o que encerra o caso (lançado na mão / descartado) —
  // separado do "ver" porque encerrar é decisão, não leitura.
  { recurso: "lancamentos-resgatados", label: "Lançamentos que não subiram", modulo: "Operação", acoes: ["ver", "resolver"] },
  { recurso: "notificacoes", label: "Avisos enviados ao app", modulo: "Operação", acoes: ["ver", "excluir"] },
  { recurso: "demandas", label: "Pedidos de melhoria", modulo: "Operação", acoes: ["ver", "criar"] },
  // Captação de clientes para a plataforma: leads do site e prospecção ativa.
  // É trabalho comercial da Movatruck, não da transportadora que usa o sistema
  // — por isso está em RECURSOS_PLATAFORMA logo abaixo. "importar" dispara a
  // carga do RNTRC, que é cara e bate em serviço de fora; fica separada de
  // "editar" de propósito.
  // `excluir` é chave à parte de `editar`: arrumar um telefone errado e apagar
  // um lead da base com a conversa junto não são o mesmo poder.
  { recurso: "prospeccao", label: "Captação de clientes", modulo: "Operação", acoes: ["ver", "editar", "importar", "excluir"] },
  // `publicar` é separado de `criar` pelo mesmo motivo que `importar` é separado
  // em prospeccao: criar um post é rascunho, publicar é irreversível e sai na
  // cara da marca.
  { recurso: "marketing", label: "Instagram da Movatruck", modulo: "Sistema", acoes: ["ver", "criar", "publicar"] },
  // Chat dos motoristas. "ver" abre a tela (avisos + denúncias), "avisar"
  // publica no canal, "moderar" resolve denúncia e remove mensagem. Conversa
  // de motorista com motorista NÃO é acessível por nenhuma dessas chaves —
  // só o que chegou por denúncia aparece.
  { recurso: "chat", label: "Chat dos motoristas", modulo: "Operação", acoes: ["ver", "avisar", "moderar"] },
  // ---- Cadastros ----
  { recurso: "motoristas", label: "Motoristas", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir", "aprovar", "documentos"] },
  // O controller de veículos já exigia veiculos.criar/editar/excluir, mas o
  // recurso nunca existiu aqui — o seed podava as chaves órfãs e ninguém
  // conseguia mexer em veículo pelo painel. Declarado agora.
  { recurso: "veiculos", label: "Veículos", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "transportadoras", label: "Transportadoras (frotas)", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  // `expurgar` apaga posições de GPS com mais de 90 dias — é destrutivo, então
  // não pode viver sob a chave de leitura (foi o que aconteceu e virou furo).
  { recurso: "mapa", label: "Mapa", modulo: "Cadastros", acoes: ["ver", "expurgar"] },
  { recurso: "empresas", label: "Clientes", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir", "layouts"] },
  { recurso: "clientes", label: "Obras", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "locais", label: "Locais", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir", "homologar"] },
  { recurso: "pedagios", label: "Praças de pedágio", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir", "importar"] },
  { recurso: "materiais", label: "Materiais", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "tipos-servico", label: "Viagens — campos da viagem no app", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "modalidades", label: "Motoristas — modalidades", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  // O molde de acessos do app. `aplicar` é chave à parte de `editar` porque
  // aplicar reescreve TRINTA pessoas de uma vez: é poder de outra ordem que
  // corrigir o nome do perfil.
  { recurso: "perfis-acesso", label: "Permissões do app", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "aplicar", "excluir"] },
  { recurso: "regras-minimo", label: "Clientes — mínimo por viagem (km e tonelada)", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  // Quanto cada empresa paga por tonelada/km/viagem. Chave própria e separada de
  // `regras-minimo` porque são decisões diferentes: mínimo é quanto se CONTA
  // (operacional, quem confere mexe), preço é quanto se COBRA (comercial, nem
  // todo mundo que confere viagem pode mexer no preço do contrato).
  { recurso: "tabelas-preco", label: "Clientes — preço", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "tipos-evento-viagem", label: "Viagens — paradas e imprevistos", modulo: "Cadastros", acoes: ["ver", "criar", "editar", "excluir"] },
  // ---- Sistema ----
  { recurso: "usuarios", label: "Usuários", modulo: "Sistema", acoes: ["ver", "criar", "editar", "excluir"] },
  { recurso: "permissoes", label: "Papéis e permissões", modulo: "Sistema", acoes: ["gerenciar"] },
  // A empresa mexendo na marca dela mesma (logo do painel). Não confundir com a
  // gestão de EMPRESAS da plataforma, que não passa por permissão nenhuma —
  // é gateada por `User.plataforma`, fora da matriz de propósito.
  { recurso: "minha-empresa", label: "Minha empresa (marca e regras)", modulo: "Sistema", acoes: ["editar"] },
  // Trazer a base que a transportadora já tem (planilha de clientes, frota,
  // motoristas, locais). É ato de IMPLANTAÇÃO, e não a criação avulsa de um
  // cadastro: quem pode criar um cliente não deveria, por isso, poder
  // reescrever a base inteira — por isso recurso próprio.
  { recurso: "importacao", label: "Importar dados", modulo: "Sistema", acoes: ["ver", "executar"] },
  // Emitir documento fiscal é ato com consequência jurídica: quem lança uma
  // viagem não deveria, por isso, poder emitir em nome da empresa. Cancelar é
  // ação à parte porque tem prazo legal e é contada pela SEFAZ.
  { recurso: "cte", label: "CT-e (emitidos e configuração do emissor)", modulo: "Sistema", acoes: ["ver", "emitir", "cancelar"] },
  { recurso: "whatsapp", label: "WhatsApp", modulo: "Sistema", acoes: ["ver", "gerenciar"] },
  { recurso: "erros", label: "Erros", modulo: "Sistema", acoes: ["ver", "resolver"] },
  { recurso: "diagnosticos", label: "Diagnóstico do app", modulo: "Sistema", acoes: ["ver"] },
  { recurso: "config-tracking", label: "Tracking GPS", modulo: "Sistema", acoes: ["ver", "editar"] },
  { recurso: "config-busca-locais", label: "Busca de locais", modulo: "Sistema", acoes: ["ver", "editar"] },
  // Não gateia mais tela nenhuma: os modelos de IA de cada empresa são editados
  // em Assinantes, atrás da flag `plataforma`. A chave fica pra não mexer nos
  // papéis que já a têm (e no módulo "conferencia", que é dono do recurso).
  { recurso: "config-ia", label: "Inteligência Artificial", modulo: "Sistema", acoes: ["ver", "editar"] },
  // A tela que mostra o que o robô leu de cada ticket, o custo por leitura e a
  // fila do worker. Estava gateada por `viagens.ver`, que todo mundo tem — daí
  // aparecer no menu de quem não deveria e não ter linha própria na matriz.
  {
    recurso: "conferencia-ticket",
    label: "Conferência de ticket (IA)",
    modulo: "Sistema",
    acoes: ["ver", "reprocessar"],
  },
  { recurso: "config-agente", label: "Agente WhatsApp", modulo: "Sistema", acoes: ["ver", "editar"] },
  { recurso: "config-campos-layout", label: "Fechamento com o cliente — como ler a planilha do cliente", modulo: "Sistema", acoes: ["ver", "editar"] },
  { recurso: "config-forca-atualizacao", label: "Força-atualização do app", modulo: "Sistema", acoes: ["ver", "editar"] },
  { recurso: "config-km-atipico", label: "Alerta de km fora do padrão", modulo: "Sistema", acoes: ["ver", "editar"] },
];

/** Mapa recurso → rótulo amigável (usado na matriz de papéis). */
/**
 * Os recursos declarados, expostos pro catálogo de MÓDULOS poder validar que
 * nenhum ficou órfão. Só leitura — quem manda na estrutura é o RESOURCE_DEFS.
 */
export const RESOURCE_DEFS_PUBLICO: ReadonlyArray<{ recurso: string; label: string; modulo: string }> =
  RESOURCE_DEFS.map((r) => ({ recurso: r.recurso, label: r.label, modulo: r.modulo }));

export const RECURSOS_LABEL: Record<string, string> = Object.fromEntries(
  RESOURCE_DEFS.map((r) => [r.recurso, r.label]),
);

export const CATALOGO_PERMISSOES: PermissaoCatalogo[] = RESOURCE_DEFS.flatMap((r, ri) =>
  r.acoes.map((acao, ai) => ({
    chave: `${r.recurso}.${acao}`,
    modulo: r.modulo,
    titulo: ACAO_TITULO_POR_RECURSO[`${r.recurso}.${acao}`] ?? ACAO_TITULO[acao] ?? acao,
    ordem: ri * 100 + ai,
  })),
);

export const TODAS_AS_CHAVES: string[] = CATALOGO_PERMISSOES.map((p) => p.chave);

/**
 * Recursos que são da PLATAFORMA, não da empresa que assina.
 *
 * A régua é: mexer nisso afeta gente de fora da empresa, ou custa dinheiro/marca
 * de quem opera a plataforma.
 *
 * - `whatsapp` e `config-agente`: a instância do WhatsApp é UMA só, dividida por
 *   todas as empresas. O dono de uma delas desconectando a sessão derruba os
 *   avisos de todas — inclusive das outras.
 * - `config-ia`: as chaves de API e a conta que paga são da plataforma.
 * - `conferencia-ticket`: cada leitura é uma chamada paga na conta da
 *   plataforma, e a tela expõe o custo em dólar dessa conta. Mandar reler em
 *   massa é gastar dinheiro que não é da empresa que assina.
 * - `config-forca-atualizacao`: decide qual versão do app é aceita, e o app é
 *   publicado nas lojas pela plataforma.
 * - `erros` e `diagnosticos`: telemetria técnica do sistema, não da operação.
 *
 * Fica de fora das permissões que uma empresa nova recebe. O dono da plataforma
 * ainda pode conceder caso a caso pela matriz, se um dia quiser.
 */
export const RECURSOS_PLATAFORMA: string[] = [
  "whatsapp",
  "config-agente",
  "config-ia",
  "conferencia-ticket",
  "config-forca-atualizacao",
  "erros",
  "diagnosticos",
  // A fila de tarefas do agente de desenvolvimento. É ferramenta de quem
  // constrói o sistema — não tem o que uma transportadora faça aqui.
  "demandas",
  // Captação de clientes da plataforma. Uma transportadora cliente não tem o
  // que fazer com a lista de outras transportadoras que a gente está
  // prospectando — nem deve enxergar que ela existe.
  "prospeccao",
  // A base de praças de pedágio é COMPARTILHADA por todas as empresas (o model
  // não tem dono, é dado do OSM). Uma empresa apagando uma praça mudaria o
  // cálculo de pedágio das outras — parece menu de operação e não é.
  "pedagios",
  // O Instagram da própria Movatruck. O que sai daqui vai pro feed público da
  // marca da plataforma — uma transportadora cliente postando ali seria um
  // estranho falando pela empresa.
  "marketing",
];

/** Chaves de plataforma (`recurso.acao`), derivadas de RECURSOS_PLATAFORMA. */
export const CHAVES_PLATAFORMA: string[] = CATALOGO_PERMISSOES.filter((p) =>
  RECURSOS_PLATAFORMA.includes(p.chave.split(".")[0] ?? ""),
).map((p) => p.chave);

/**
 * O que o Administrador de uma empresa cliente recebe: tudo menos o que é da
 * plataforma. Inclui `permissoes.gerenciar` de propósito — ele monta os papéis
 * da equipe DELE, e não consegue conceder o que ele mesmo não tem.
 */
export const PERMISSOES_ADMIN_EMPRESA: string[] = TODAS_AS_CHAVES.filter(
  (chave) => !CHAVES_PLATAFORMA.includes(chave),
);

/** Ações que hoje são restritas a ADMIN (DELETEs sensíveis + importar OSM).
 * O papel Operador NÃO recebe estas — preserva o comportamento atual. */
export const ADMIN_ONLY: string[] = [
  "viagens.excluir",
  "abastecimentos.excluir",
  "fechamentos.excluir",
  "envios.excluir",
  "pedagios.excluir",
  "pedagios.importar",
];

/** Permissões do papel Operador: tudo de Operação + Cadastros, menos as
 * ADMIN-only. Sem o módulo Sistema. Espelha o acesso de hoje. */
export const PERMISSOES_OPERADOR: string[] = CATALOGO_PERMISSOES.filter(
  (p) => (p.modulo === "Operação" || p.modulo === "Cadastros") && !ADMIN_ONLY.includes(p.chave),
).map((p) => p.chave);

/**
 * Papel-modelo publicado pela plataforma, pra empresa copiar em vez de montar do
 * zero. Só quem opera a plataforma escreve isto.
 */
export const PapelModeloInput = z.object({
  nome: z.string().min(2).max(60),
  descricao: z.string().max(200).optional(),
  permissoes: z.array(z.string()).default([]),
  ativo: z.boolean().optional(),
});
export type PapelModeloInput = z.infer<typeof PapelModeloInput>;

/**
 * A empresa copiando um modelo. `nome` só é necessário quando o nome do modelo
 * já está em uso lá dentro.
 */
export const CriarPapelDoModeloInput = z.object({
  modeloId: z.string().uuid(),
  nome: z.string().min(2).max(60).optional(),
});
export type CriarPapelDoModeloInput = z.infer<typeof CriarPapelDoModeloInput>;

/**
 * O teto de uma empresa: o que o administrador dela pode conceder. Lista vazia
 * devolve ao padrão do código (`PERMISSOES_ADMIN_EMPRESA`).
 */
export const TetoDaContaInput = z.object({
  permissoes: z.array(z.string()),
});
export type TetoDaContaInput = z.infer<typeof TetoDaContaInput>;

/**
 * Promover ou rebaixar um operador da plataforma. Só quem já é pode chamar, e o
 * backend recusa promover quem está fora da empresa da plataforma.
 */
export const DefinirPlataformaInput = z.object({
  plataforma: z.boolean(),
});
export type DefinirPlataformaInput = z.infer<typeof DefinirPlataformaInput>;

export const CriarPapelInput = z.object({
  nome: z.string().min(2).max(60),
  descricao: z.string().max(200).optional(),
  permissoes: z.array(z.string().min(1).max(60)).max(300).default([]),
});
export type CriarPapelInput = z.infer<typeof CriarPapelInput>;

export const AtualizarPapelInput = CriarPapelInput.partial();
export type AtualizarPapelInput = z.infer<typeof AtualizarPapelInput>;
