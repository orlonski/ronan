/**
 * A DÍVIDA CONHECIDA: endpoints de `admin/*` que não declaram permissão.
 *
 * O `PermissaoGuard` é fail-open — handler sem `@RequerPermissao` passa pra
 * qualquer `ADMIN_USER`. Para o RBAC isso foi uma escolha consciente de
 * compatibilidade; para software vendido por MÓDULO é o produto saindo pela
 * porta lateral, porque o `ModuloGuard` deriva o módulo justamente da permissão
 * declarada: sem ela, não há contrato a checar.
 *
 * Esta lista existe pra virar o jogo sem um big bang. Os endpoints que já
 * estavam assim nascem aqui e nada quebra; endpoint NOVO sem decorator não
 * passa do boot (e, portanto, do CI). A lista só encolhe.
 *
 * Para tirar um item daqui: anote o handler com `@RequerPermissao("recurso.acao")`
 * e apague a linha. Se ele for realmente público pra qualquer admin (caixa
 * pessoal, por exemplo), documente o porquê ao lado.
 */
export const ENDPOINTS_SEM_PERMISSAO: ReadonlySet<string> = new Set([
  // Caixa de entrada pessoal do usuário: o dado já é dele, e exigir permissão
  // deixaria admin sem sininho. Fica de fora por desenho, não por dívida.
  "AdminInboxController.contar",
  "AdminInboxController.listar",
  "AdminInboxController.marcarLida",
  "AdminInboxController.marcarTodasLidas",
  "AdminInboxController.stream",

  // Os dados do próprio usuário logado — inclusive as permissões que a UI usa
  // pra decidir o que mostrar. Gatear isto por permissão seria circular.
  "UsersController.me",

  // O checklist de primeiros passos da própria conta. É o que o admin novo vê
  // antes de ter papel nenhum configurado; exigir permissão aqui deixaria a
  // primeira tela do produto em branco justamente pra quem mais precisa dela.
  "PrimeirosPassosController.listar",

  // "Quero continuar": o cliente cujo teste acabou pedindo pra voltar a ser
  // cliente. Fica de fora por desenho, não por dívida — é o próprio usuário
  // falando da própria conta, como a caixa pessoal acima, e exigir chave aqui
  // calaria justamente quem ainda não tem papel configurado.
  "OnboardingController.querorContinuar",

  // "Já entendi, tira isto da home." É preferência do próprio usuário sobre a
  // própria tela, do mesmo tipo que marcar um aviso como lido.
  "OnboardingController.dispensar",

  // O passo a passo guiado da tela em que a pessoa está, e o "já vi isso".
  // Mesmo motivo dos dois acima: é preferência do próprio usuário sobre a
  // própria tela. Os PASSOS, esses sim, são podados por permissão lá dentro.
  "OnboardingController.tour",
  "OnboardingController.tourVisto",
  "OnboardingController.tourRever",

  // Fora de `admin/*` (o boot-check agora olha o `@Roles("ADMIN_USER")`, não só
  // o prefixo). São do próprio usuário sobre si mesmo, como a caixa pessoal:
  // o painel de qualquer empresa reporta o erro que viu, e quem entra precisa
  // aceitar os Termos ANTES de ter papel configurado.
  "ErrorsController.reportarDashboard",
  "TermosController.status",
  "TermosController.recibos",
  "TermosController.aceitar",

  // DÍVIDA aberta (achada ao estender o boot-check ao `@Roles("ADMIN_USER")`
  // fora de `admin/*`). Não recebem chave nova aqui porque hoje qualquer
  // administrador as usa nos botões de Motoristas/Usuários, e escolher a chave
  // errada tiraria o convite de quem o usa. Decidir com o dono; esta lista só
  // encolhe. O convite gasta mensagem de WhatsApp (recurso medido).
  "WhatsappController.conviteMotorista",
  "WhatsappController.conviteUser",

  // Busca de endereço/CEP/rota: compartilhada com o app do motorista (mesmo
  // controller, `@Roles` de três tipos) e sem dado de empresa. Custa cota do
  // Google Maps, não módulo.
  "GeocodingController.cep",
  "GeocodingController.buscar",
  "GeocodingController.place",
  "GeocodingController.reverso",
]);

/** Nome estável de um handler pro registro acima. */
export function chaveDoHandler(classe: string, metodo: string): string {
  return `${classe}.${metodo}`;
}
