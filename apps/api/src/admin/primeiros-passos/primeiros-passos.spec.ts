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
    viagem: { count: count("viagem") },
    tabelaPreco: { count: count("tabelaPreco") },
    moduloContratado: {
      findMany: vi.fn().mockResolvedValue(
        modulos.map((chave) => ({ chave, vigenteDe: null, vigenteAte: null })),
      ),
    },
  } as never;
}

const CHEIO = {
  veiculo: 1, motorista: 1, local: 2, empresa: 1, cliente: 1, viagem: 1, tabelaPreco: 0,
};

const TODAS_PERMS = [
  "motoristas.ver", "motoristas.criar",
  "veiculos.ver", "veiculos.criar",
  "locais.ver", "locais.criar",
  "empresas.ver", "empresas.criar",
  "clientes.ver", "clientes.criar",
  "viagens.ver",
  "tabelas-preco.ver", "tabelas-preco.criar",
];

describe("primeiros passos", () => {
  let servico: PrimeirosPassosService;

  function montar(contagens: Record<string, number>, modulos: string[]) {
    servico = new PrimeirosPassosService(prismaFake(contagens, modulos));
    return servico;
  }

  beforeEach(() => vi.clearAllMocks());

  it("some com o passo do preço quando a conta não tem o módulo Comercial", async () => {
    const r = await montar(CHEIO, []).listar({ permissoes: TODAS_PERMS, plataforma: false });
    expect(r.passos.map((p) => p.chave)).not.toContain("preco");
    // E some de verdade: não é "pendente que não dá pra cumprir".
    expect(r.concluido).toBe(true);
  });

  it("mostra o passo do preço quando o módulo está contratado", async () => {
    const r = await montar(CHEIO, ["comercial"]).listar({
      permissoes: TODAS_PERMS,
      plataforma: false,
    });
    expect(r.passos.map((p) => p.chave)).toContain("preco");
    expect(r.concluido).toBe(false);
  });

  it("some com o passo quando o usuário não tem a permissão de criar", async () => {
    const semPreco = TODAS_PERMS.filter((p) => p !== "tabelas-preco.criar");
    const r = await montar(CHEIO, ["comercial"]).listar({
      permissoes: semPreco,
      plataforma: false,
    });
    expect(r.passos.map((p) => p.chave)).not.toContain("preco");
  });

  it("nunca devolve passo que o usuário não conseguiria cumprir", async () => {
    const r = await montar(
      { veiculo: 0, motorista: 0, local: 0, empresa: 0, cliente: 0, viagem: 0, tabelaPreco: 0 },
      ["comercial"],
    ).listar({ permissoes: ["viagens.ver"], plataforma: false });
    // Só sobra o que "viagens.ver" permite.
    expect(r.passos.map((p) => p.chave)).toEqual(["viagem"]);
  });

  it("some com o passo quando dá pra criar mas não dá pra abrir a tela", async () => {
    // O TelaGuard gateia por `.ver`; ter só `.criar` cairia no mesmo beco.
    const semVer = TODAS_PERMS.filter((p) => p !== "tabelas-preco.ver");
    const r = await montar(CHEIO, ["comercial"]).listar({
      permissoes: semVer,
      plataforma: false,
    });
    expect(r.passos.map((p) => p.chave)).not.toContain("preco");
  });

  it("operador da plataforma enxerga tudo — é ele quem configura a conta nova", async () => {
    const r = await montar(CHEIO, ["comercial"]).listar({ permissoes: [], plataforma: true });
    expect(r.passos.map((p) => p.chave)).toContain("preco");
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

  it("o passo do preço só aparece depois que existe viagem", async () => {
    const r = await montar({ ...CHEIO, viagem: 0 }, ["comercial"]).listar({
      permissoes: TODAS_PERMS,
      plataforma: false,
    });
    expect(r.passos.map((p) => p.chave)).not.toContain("preco");
  });
});
