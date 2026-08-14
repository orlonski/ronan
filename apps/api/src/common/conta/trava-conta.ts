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
 */

/**
 * Models que não pertencem a nenhuma conta: catálogo de sistema, dado público
 * ou infra da plataforma. Manter em sincronia com o schema — model novo nasce
 * escopado por padrão, e só entra aqui por decisão consciente.
 */
const MODELS_GLOBAIS = new Set<string>([
  "Conta", // o próprio tenant
  "Permissao", // catálogo de chaves do RBAC, semeado no boot
  "PedagioRodovia", // praças de pedágio vindas do OSM (dado público)
  "GeocodingCache", // endereço → coordenada
  "RotaCache", // chaveado por par de Local, que já é da conta
  "ExecucaoAgente", // fila interna da plataforma
]);

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

export const travaConta = Prisma.defineExtension({
  name: "trava-conta",
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (MODELS_GLOBAIS.has(model)) return query(args);

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
