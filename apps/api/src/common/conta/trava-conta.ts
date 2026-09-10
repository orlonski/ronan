import { Prisma } from "@prisma/client";
import { contaAtual } from "./conta-context";

/**
 * A trava de isolamento entre empresas.
 *
 * O sistema atende N empresas na mesma base. Em vez de confiar que cada um dos
 * ~810 pontos que falam com o banco vai lembrar de filtrar por conta, a trava
 * injeta o filtro em TODA operação do Prisma Client: leitura ganha `contaId` no
 * `where`, escrita ganha `contaId` no `data` — inclusive nos `create`
 * aninhados.
 *
 * É fail-closed: consulta sem conta no contexto **lança**, em vez de rodar sem
 * filtro. Um erro barulhento em desenvolvimento é infinitamente melhor que uma
 * empresa lendo os dados da outra em produção.
 *
 * LIMITE IMPORTANTE: extensions não interceptam `$queryRaw`/`$executeRaw`.
 * Todo SQL cru precisa filtrar por `"contaId"` na mão — o teste de vazamento é
 * o que cobra isso.
 *
 * O OUTRO LIMITE: nos `MODELS_GLOBAIS` não há `contaId` pra injetar, então lá a
 * trava não protege nada — quem consulta tem que citar o alvo no `where`. O que
 * dá pra cobrar é o caso silencioso, e `exigirAlvo` cobra: `findFirst` sem
 * `where` dentro de uma requisição lança em vez de devolver linha de qualquer
 * empresa.
 */

/**
 * Models que não pertencem a nenhuma conta: catálogo de sistema, dado público
 * ou infra da plataforma. Manter em sincronia com o schema — model novo nasce
 * escopado por padrão, e só entra aqui por decisão consciente.
 */
const MODELS_GLOBAIS = new Set<string>([
  "Conta", // o próprio tenant
  // A PESSOA (CPF), que existe antes e independente de qualquer empresa — é o
  // que permite cadastro no app sem vínculo. Como a trava não filtra nada aqui,
  // toda consulta precisa levar `id`/`cpf` no where, e o que sai pra fora se
  // monta campo a campo. Ver docs/identidade-motorista.md.
  "MotoristaIdentidade",
  // O cadastro pendente é dessa mesma pessoa, antes dela existir: quem se
  // cadastra pelo app não diz de qual empresa é.
  "CadastroMotoristaPendente",
  // Quem está abrindo uma empresa pelo site. Existe ANTES da conta — é o que
  // impede que um formulário meio preenchido já vire linha em `contas`.
  "ContaCadastroPendente",
  // Os códigos que já saíram, pra sustentar o teto por hora. Não é de empresa
  // nenhuma: o envio acontece antes de existir empresa.
  "EnvioCodigoCadastro",
  // O trabalho por conta própria dele: frete, caderninho e o comprovante que ele
  // manda pra quem vai pagar. É da PESSOA — nenhuma empresa lê. O isolamento é
  // o `identidadeId` em toda consulta (LancamentosPessoaisService).
  "ViagemPessoal",
  "LancamentoPessoal",
  "ComprovantePessoal",
  // A carteira dela: CNH, toxicológico, RNTRC. Documento de pessoa é da pessoa —
  // ela leva de uma transportadora pra outra. Estava faltando aqui e só não
  // quebrou porque todo acesso passa por `comoSistema`: a tabela nem tem coluna
  // `contaId`, então uma consulta dentro de `comConta` derrubaria no Prisma.
  "DocumentoPessoal",
  "Permissao", // catálogo de chaves do RBAC, semeado no boot
  // A régua de quanto uma empresa pode conceder por padrão. É da casa, não de
  // empresa nenhuma — e é lida de DENTRO do contexto de cada conta (o seed roda
  // por empresa), então precisa estar aqui: sem isso a trava tenta filtrar por
  // uma coluna `contaId` que a tabela não tem.
  "ConfiguracaoPermissoes",
  // Papel-modelo publicado pela plataforma. Não tem dono: existe pra qualquer
  // empresa copiar, e o que ela ganha ao copiar é um `Papel` dela (esse sim
  // escopado). Ninguém é autorizado por um modelo — só por papel de conta.
  "PapelModelo",
  // Os interruptores da casa: porta de auto-cadastro e dias de teste.
  "ConfiguracaoPlataforma",
  // A tabela de preço do produto. É da casa: nenhuma empresa tem a sua.
  "FaixaPreco",
  "PedagioRodovia", // praças de pedágio vindas do OSM (dado público)
  "GeocodingCache", // endereço → coordenada
  "RotaCache", // chaveado por par de Local, que já é da conta
  "ExecucaoAgente", // fila interna da plataforma
  // Captação: quem pediu contato pelo site ou quem a prospecção achou. Ainda
  // não é cliente de ninguém — quando vira, vira uma Conta.
  "Lead",
  "InteracaoLead",
  // A conversa do SDR com o prospect. Global pelo mesmo motivo do Lead.
  "MensagemLead",
  "SupressaoContato",
  "EventoSite", // contagem anônima de navegação do site institucional
]);

/**
 * "Me dá qualquer linha" num model que não é de ninguém, dentro de uma
 * requisição de uma empresa.
 *
 * Vira 500 pelo mesmo motivo do `ContaAusenteError`: é bug de código. E é um
 * bug caro — `conta.findFirstOrThrow({ select: { nome: true } })` no convite
 * por CPF fazia o motorista receber "«a primeira conta da tabela» quer te
 * adicionar". O nome de uma empresa aparecendo pra quem não é dela é vazamento,
 * mesmo quando nenhum dado de negócio sai junto.
 *
 * Model global não tem `contaId` pra trava injetar, então quem consulta tem que
 * dizer QUAL linha quer. Sem `where` a resposta é "a primeira que o Postgres
 * devolver" — nunca é isso que se quis.
 */
export class AlvoGlobalAusenteError extends Error {
  constructor(model: string, operation: string) {
    super(
      `${model}.${operation} sem \`where\` dentro de uma requisição. ${model} é ` +
        `global (não pertence a nenhuma conta), então a trava não filtra nada: ` +
        `sem \`where\` isso devolve uma linha QUALQUER, de qualquer empresa. ` +
        `Cite o alvo (\`where: { id: ... }\` — para a conta da requisição, ` +
        `\`contaIdAtual()\`) ou, se varrer tudo é o objetivo, declare com ` +
        `comoSistema(...).`,
    );
    this.name = "AlvoGlobalAusenteError";
  }
}

/** Erro de trava. Vira 500 de propósito: é bug de código, não do usuário. */
export class ContaAusenteError extends Error {
  constructor(model: string, operation: string) {
    super(
      `Consulta em ${model}.${operation} sem conta no contexto. Toda leitura ou ` +
        `escrita de dado de negócio precisa saber de qual empresa é: abra o ` +
        `contexto com comConta(contaId, ...) ou, se a operação atravessa contas ` +
        `de propósito (login, boot, cron, fila), declare com comoSistema(...).`,
    );
    this.name = "ContaAusenteError";
  }
}

/**
 * `where` que aceita filtro livre — dá pra combinar em `AND` sem risco.
 * Nunca mesclar por spread: `where.OR` do endpoint e `OR` do filtro no mesmo
 * nível fazem um apagar o outro em silêncio (o repo já pagou por isso em
 * `paginate`).
 */
const WHERE_LIVRE = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * `where` que exige um campo único no topo — aqui o filtro TEM que ir por
 * spread, senão o Prisma não reconhece a chave única. Funciona porque o Prisma
 * 5+ aceita campo não-único junto do único (`extendedWhereUnique`), e porque
 * where de operação única não tem `OR` pra colidir.
 */
const WHERE_UNICO = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "delete",
  "upsert",
]);

/** Operações que gravam uma linha NOVA e precisam do carimbo no próprio `data`. */
const ESCRITAS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "upsert",
]);

/**
 * Operações que alteram linha EXISTENTE — o `data` delas não leva carimbo (a
 * linha já é da conta, garantido pelo `where` acima), mas pode trazer `create`
 * ANINHADO, e esse sim precisa.
 *
 * Faltava, e o preço foi real: `viagem.update({ data: { trechos: { create } } })`
 * gravava o trecho com o contaId default `__SEM_CONTA__`, que não existe na
 * tabela de contas — a FK derrubava o finalizar inteiro com P2003, que o filtro
 * traduzia como "um dos itens escolhidos não existe mais". Mensagem que manda o
 * motorista procurar um cadastro sumido que estava lá o tempo todo.
 */
const ALTERACOES = new Set(["update", "updateMany", "updateManyAndReturn"]);

/** model → (campo de relação → model do outro lado), derivado do próprio schema. */
const RELACOES: Map<string, Map<string, string>> = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name,
    new Map(
      m.fields.filter((f) => f.kind === "object").map((f) => [f.name, f.type]),
    ),
  ]),
);

type Obj = Record<string, unknown>;

const ehObjeto = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Carimba a conta no payload de escrita, descendo pelos `create` aninhados.
 *
 * Sem isso, `viagem.create({ data: { ..., pontos: { create: [...] } } })`
 * gravaria a viagem certa e explodiria no NOT NULL do ponto — o Prisma não
 * herda campo escalar do pai pro filho.
 */
function carimbar(
  model: string,
  data: unknown,
  contaId: string,
  /** false = só desce nos aninhados (caso do `update`: a linha já tem dono). */
  carimbarTopo = true,
): void {
  if (Array.isArray(data)) {
    for (const item of data) carimbar(model, item, contaId, carimbarTopo);
    return;
  }
  if (!ehObjeto(data)) return;

  if (carimbarTopo && !MODELS_GLOBAIS.has(model)) data.contaId = contaId;

  const relacoes = RELACOES.get(model);
  if (!relacoes) return;

  for (const [campo, modelAlvo] of relacoes) {
    const valor = data[campo];
    if (!ehObjeto(valor)) continue;

    if (valor.create) carimbar(modelAlvo, valor.create, contaId);

    if (ehObjeto(valor.createMany) && valor.createMany.data) {
      carimbar(modelAlvo, valor.createMany.data, contaId);
    }

    for (const chave of ["connectOrCreate", "upsert"] as const) {
      const bruto = valor[chave];
      if (!bruto) continue;
      for (const item of Array.isArray(bruto) ? bruto : [bruto]) {
        if (!ehObjeto(item)) continue;
        if (item.create) carimbar(modelAlvo, item.create, contaId);
        // O lado `update` do upsert altera linha existente: não leva carimbo
        // próprio, mas pode ter create mais fundo.
        if (item.update) carimbar(modelAlvo, item.update, contaId, false);
      }
    }

    // Alteração aninhada (`{ update: { where, data } }`, `updateMany`): mesma
    // regra do topo — não carimba, mas continua descendo.
    for (const chave of ["update", "updateMany"] as const) {
      const bruto = valor[chave];
      if (!bruto) continue;
      for (const item of Array.isArray(bruto) ? bruto : [bruto]) {
        if (!ehObjeto(item)) continue;
        const alvo = ehObjeto(item.data) ? item.data : item;
        carimbar(modelAlvo, alvo, contaId, false);
      }
    }
  }
}

/**
 * Model global só pode ser lido "de olhos fechados" fora de requisição.
 *
 * `findFirst`/`findFirstOrThrow` sem `where` são as duas operações onde pedir
 * qualquer linha é o comportamento padrão e silencioso — `findMany` sem `where`
 * é uma listagem, que a plataforma faz de propósito (a tela de Empresas), e
 * `findUnique` já exige a chave. Então é só nessas duas que a checagem paga:
 * pega o bug real sem atravessar o caminho de ninguém.
 *
 * Boot, cron, script e fila seguem livres — lá varrer contas é o trabalho, e
 * `comoSistema(...)` é a declaração de que se sabe disso.
 */
function exigirAlvo(model: string, operation: string, args: unknown): void {
  if (operation !== "findFirst" && operation !== "findFirstOrThrow") return;

  const ctx = contaAtual();
  if (!ctx || ctx.modo === "sistema") return;

  const where = ehObjeto(args) ? args.where : undefined;
  if (ehObjeto(where) && Object.keys(where).length > 0) return;

  throw new AlvoGlobalAusenteError(model, operation);
}

export const travaConta = Prisma.defineExtension({
  name: "trava-conta",
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (MODELS_GLOBAIS.has(model)) {
          exigirAlvo(model, operation, args);
          return query(args);
        }

        const ctx = contaAtual();

        // Fora de qualquer contexto (boot do Nest, código solto) ou em modo
        // sistema declarado: passa sem filtrar. É o único caminho de saída, e
        // é sempre uma escolha explícita de quem escreveu o código.
        if (!ctx || ctx.modo === "sistema") return query(args);

        const { contaId } = ctx;
        if (!contaId) throw new ContaAusenteError(model, operation);

        const a = (args ?? {}) as Obj;

        if (WHERE_LIVRE.has(operation)) {
          a.where = a.where ? { AND: [a.where, { contaId }] } : { contaId };
        } else if (WHERE_UNICO.has(operation)) {
          a.where = { ...(a.where as Obj | undefined), contaId };
        }

        if (ESCRITAS.has(operation)) {
          // `upsert` carimba o lado do create; o update herda a linha existente,
          // que já é da conta porque o `where` acima garantiu isso.
          const alvo = operation === "upsert" ? a.create : a.data;
          if (alvo) carimbar(model, alvo, contaId);
          // ...e o lado `update` do upsert ainda pode trazer create aninhado.
          if (operation === "upsert" && a.update) {
            carimbar(model, a.update, contaId, false);
          }
        } else if (ALTERACOES.has(operation) && a.data) {
          carimbar(model, a.data, contaId, false);
        }

        return query(a);
      },
    },
  },
});
