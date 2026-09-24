import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrimeirosPassosService } from "./primeiros-passos.service";

vi.mock("../../common/conta/conta-context", () => ({
  contaIdAtual: () => "conta-1",
}));

/**
 * Passo pendente que abre "Você não tem acesso a esta tela" é pior que passo
 * nenhum: o checklist apresenta o item como o PRÓXIMO da pessoa e entrega uma
 * porta fechada — com a frase "fale com um administrador", que é mentira quando
 * quem clicou é o administrador da própria empresa.
 *
 * Foi exatamente o que aconteceu quando "Diga quanto vale a viagem" entrou na
 * lista: a tabela de preço é do módulo Comercial e da permissão
 * `tabelas-preco.criar`, e a lista não olhava nem um nem outro.
 *
 * O preço ensinou a segunda lição por conta própria: mesmo podado direito, ele
 * era um PASSO — e passo novo reabre o caminho de quem já terminou. Cliente que
 * usa o painel há meses viu "faltam algumas coisas" voltar na home por causa de
 * uma funcionalidade que ele escolheu não usar. Hoje ele é oferta, e conta que
 * já recebeu viagem do app é `veterana`: o checklist não volta pra ela.
 */

/** Prisma só o bastante: a lista é feita de contagens. */
function prismaFake(contagens: Record<string, number>, modulos: string[]) {
  const count = (k: string) => vi.fn().mockResolvedValue(contagens[k] ?? 0);
  return {
    veiculo: { count: count("veiculo") },
    motorista: { count: count("motorista") },
    local: { count: count("local") },
    empresa: { count: count("empresa") },
    cliente: { count: count("cliente") },
    /**
     * As duas contagens de viagem saem da MESMA tabela e só se distinguem pelo
     * `where`: uma exclui o prefixo `import:`, a outra exige. Um mock que
     * ignorasse o filtro devolveria o mesmo número pras duas e deixaria passar
     * justamente o bug que interessa — histórico importado tornando a conta
     * `veterana`.
     */
    viagem: {
      count: vi.fn(({ where }: { where?: Record<string, unknown> } = {}) => {
        const importada =
          typeof where?.clientId === "object" &&
          where.clientId !== null &&
          "startsWith" in (where.clientId as object);
        return Promise.resolve(contagens[importada ? "viagemImportada" : "viagem"] ?? 0);
      }),
    },
    tabelaPreco: { count: count("tabelaPreco") },
    moduloContratado: {
      findMany: vi.fn().mockResolvedValue(
        modulos.map((chave) => ({ chave, vigenteDe: null, vigenteAte: null })),
      ),
    },
  } as never;
}

const CHEIO = {
  veiculo: 1, motorista: 1, local: 2, empresa: 1, cliente: 1, viagem: 1,
  viagemImportada: 0, tabelaPreco: 0,
};

const TODAS_PERMS = [
  "importacao.ver", "importacao.executar",
  "motoristas.ver", "motoristas.criar",
  "veiculos.ver", "veiculos.criar",
  "locais.ver", "locais.criar",
  "empresas.ver", "empresas.criar",
  "clientes.ver", "clientes.criar",
  "viagens.ver",
  "tabelas-preco.ver", "tabelas-preco.criar",
];

/** Comercial junto porque a oferta do preço é dele; o resto é núcleo. */
const MODULOS = ["comercial"];

describe("primeiros passos", () => {
  let servico: PrimeirosPassosService;

  function montar(contagens: Record<string, number>, modulos: string[]) {
    servico = new PrimeirosPassosService(prismaFake(contagens, modulos));
    return servico;
  }

  beforeEach(() => vi.clearAllMocks());

  it("o preço nunca é passo: não entra na sequência nem segura a lista", async () => {
    const r = await montar(CHEIO, ["comercial"]).listar({
      permissoes: TODAS_PERMS,
      plataforma: false,
    });
    expect(r.passos.map((p) => p.chave)).not.toContain("preco");
    expect(r.ofertas.map((o) => o.chave)).toContain("preco");
    // Sem tabela de preço nenhuma (CHEIO tem tabelaPreco: 0) e mesmo assim o
    // caminho está fechado: quem fatura fora do sistema não fica devendo nada.
    expect(r.concluido).toBe(true);
  });

  it("some com a oferta do preço quando a conta não tem o módulo Comercial", async () => {
    const r = await montar(CHEIO, []).listar({ permissoes: TODAS_PERMS, plataforma: false });
    expect(r.ofertas.map((o) => o.chave)).not.toContain("preco");
    expect(r.concluido).toBe(true);
  });

  it("some com o preço quando o usuário não tem a permissão de criar", async () => {
    const semPreco = TODAS_PERMS.filter((p) => p !== "tabelas-preco.criar");
    const r = await montar(CHEIO, ["comercial"]).listar({
      permissoes: semPreco,
      plataforma: false,
    });
    expect(r.ofertas.map((o) => o.chave)).not.toContain("preco");
  });

  /**
   * A conta que já roda não está começando.
   *
   * Sem isto, todo item acrescentado aqui reaparece na home de quem usa o
   * sistema há meses — foi como o cliente veterano viu "Diga quanto vale a
   * viagem" surgir do nada num painel que ele já dominava.
   */
  describe("conta veterana", () => {
    it("marca veterana quando a primeira viagem do app já chegou", async () => {
      const r = await montar(CHEIO, ["comercial"]).listar({
        permissoes: TODAS_PERMS,
        plataforma: false,
      });
      expect(r.veterana).toBe(true);
    });

    it("não marca veterana com histórico só importado", async () => {
      // A planilha prova que o dado subiu, não que o ciclo rodou: essa conta
      // ainda precisa do checklist.
      const r = await montar(
        { ...CHEIO, viagem: 0, viagemImportada: 300 },
        ["comercial"],
      ).listar({ permissoes: TODAS_PERMS, plataforma: false });
      expect(r.veterana).toBe(false);
    });
  });

  it("nunca devolve passo que o usuário não conseguiria cumprir", async () => {
    const r = await montar(
      { veiculo: 0, motorista: 0, local: 0, empresa: 0, cliente: 0, viagem: 0, tabelaPreco: 0 },
      ["comercial"],
    ).listar({ permissoes: ["motoristas.ver"], plataforma: false });
    // Ver motoristas deixa mandar o app; convidar exige `motoristas.criar`.
    expect(r.passos.map((p) => p.chave)).toEqual(["app"]);
  });

  /**
   * O caminho termina quando a empresa convida o motorista pelo CPF.
   *
   * Ele baixa o app e se cadastra sozinho; o que falta à empresa é o convite.
   * A primeira viagem já foi o último passo, e cobrava do dono algo que só o
   * motorista faz.
   */
  describe("fim do caminho", () => {
    const SEM_MOTORISTA = {
      veiculo: 1, motorista: 0, local: 2, empresa: 1, cliente: 1, viagem: 0,
      viagemImportada: 0, tabelaPreco: 0,
    };

    it("o convite por CPF é o último passo, e a viagem não é passo", async () => {
      const r = await montar(SEM_MOTORISTA, MODULOS).listar({
        permissoes: TODAS_PERMS,
        plataforma: false,
      });
      const chaves = r.passos.map((p) => p.chave);
      expect(chaves.at(-1)).toBe("convite");
      expect(chaves.indexOf("app")).toBe(chaves.length - 2);
      expect(chaves).not.toContain("viagem");
      expect(r.concluido).toBe(false);
    });

    it("fecha com o motorista convidado, antes de qualquer viagem", async () => {
      const r = await montar({ ...SEM_MOTORISTA, motorista: 1 }, MODULOS).listar({
        permissoes: TODAS_PERMS,
        plataforma: false,
      });
      expect(r.concluido).toBe(true);
      expect(r.veterana).toBe(false);
    });
  });

  it("some com o item quando dá pra criar mas não dá pra abrir a tela", async () => {
    // O TelaGuard gateia por `.ver`; ter só `.criar` cairia no mesmo beco.
    const semVer = TODAS_PERMS.filter((p) => p !== "tabelas-preco.ver");
    const r = await montar(CHEIO, ["comercial"]).listar({
      permissoes: semVer,
      plataforma: false,
    });
    expect(r.ofertas.map((o) => o.chave)).not.toContain("preco");
  });

  it("operador da plataforma enxerga tudo — é ele quem configura a conta nova", async () => {
    const r = await montar(CHEIO, ["comercial"]).listar({ permissoes: [], plataforma: true });
    expect(r.ofertas.map((o) => o.chave)).toContain("preco");
  });

  it("o passo do local exige DOIS: a viagem precisa de carga e de descarga", async () => {
    const umLocal = await montar({ ...CHEIO, local: 1 }, []).listar({
      permissoes: TODAS_PERMS,
      plataforma: false,
    });
    expect(umLocal.passos.find((p) => p.chave === "local")?.cumprido).toBe(false);

    const dois = await montar({ ...CHEIO, local: 2 }, []).listar({
      permissoes: TODAS_PERMS,
      plataforma: false,
    });
    expect(dois.passos.find((p) => p.chave === "local")?.cumprido).toBe(true);
  });

  it("o preço só é oferecido depois que existe viagem", async () => {
    const r = await montar({ ...CHEIO, viagem: 0, viagemImportada: 0 }, ["comercial"]).listar({
      permissoes: TODAS_PERMS,
      plataforma: false,
    });
    expect(r.ofertas.map((o) => o.chave)).not.toContain("preco");
  });

  /**
   * A importação é o caminho mais curto até o sistema fazer sentido — e por
   * meses ela existiu sem que o checklist soubesse dela.
   *
   * Ela chegou a ser o PRIMEIRO passo, e estava errado: a lista é uma ordem de
   * dependência, e um atalho que pula metade dela não tem posição nessa ordem.
   * Hoje vem fora da sequência, como oferta.
   */
  describe("histórico importado", () => {
    const VAZIA = {
      veiculo: 0, motorista: 0, local: 0, empresa: 0, cliente: 0, viagem: 0,
      viagemImportada: 0, tabelaPreco: 0,
    };

    it("não é passo: não entra na sequência nem no placar", async () => {
      montar(VAZIA, MODULOS);
      const r = await servico.listar({ permissoes: TODAS_PERMS, plataforma: false });

      expect(r.passos.map((p) => p.chave)).not.toContain("historico");
      expect(r.ofertas.map((o) => o.chave)).toContain("historico");
    });

    it("planilha importada NÃO marca o motorista como convidado", async () => {
      // O dono sobe o histórico, o painel acende, e ninguém foi convidado.
      montar({ ...VAZIA, viagemImportada: 40 }, MODULOS);
      const r = await servico.listar({ permissoes: TODAS_PERMS, plataforma: false });

      expect(r.ofertas.find((o) => o.chave === "historico")?.cumprido).toBe(true);
      expect(r.passos.find((p) => p.chave === "convite")?.cumprido).toBe(false);
      expect(r.veterana).toBe(false);
    });

    it("viagem do app não marca o atalho", async () => {
      montar({ ...VAZIA, viagem: 3 }, MODULOS);
      const r = await servico.listar({ permissoes: TODAS_PERMS, plataforma: false });

      expect(r.veterana).toBe(true);
      expect(r.ofertas.find((o) => o.chave === "historico")?.cumprido).toBe(false);
    });

    it("quem não tem planilha fecha a lista mesmo assim", async () => {
      // O atalho fora da sequência é o que garante isto: na versão em que ele
      // era passo, quem não importa nada ficaria em "7 de 8" para sempre.
      montar(
        { veiculo: 1, motorista: 1, local: 2, empresa: 1, cliente: 1, viagem: 1,
          viagemImportada: 0, tabelaPreco: 1 },
        MODULOS,
      );
      const r = await servico.listar({ permissoes: TODAS_PERMS, plataforma: false });

      expect(r.ofertas.find((o) => o.chave === "historico")?.cumprido).toBe(false);
      expect(r.concluido).toBe(true);
    });

    it("some pra quem não pode importar", async () => {
      const semImportacao = TODAS_PERMS.filter((k) => !k.startsWith("importacao."));
      montar(VAZIA, MODULOS);
      const r = await servico.listar({ permissoes: semImportacao, plataforma: false });

      expect(r.ofertas.map((o) => o.chave)).not.toContain("historico");
    });

    it("histórico importado já libera a pergunta do preço", async () => {
      // Quem acabou de ver o total do mês passado é exatamente quem está se
      // perguntando quanto aquilo vale. Como oferta: ele PODE responder, não
      // fica devendo a resposta.
      montar({ ...VAZIA, viagemImportada: 12 }, MODULOS);
      const r = await servico.listar({ permissoes: TODAS_PERMS, plataforma: false });

      expect(r.ofertas.map((o) => o.chave)).toContain("preco");
      expect(r.passos.map((p) => p.chave)).not.toContain("preco");
    });
  });
});
