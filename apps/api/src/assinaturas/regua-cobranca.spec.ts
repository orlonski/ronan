import { describe, expect, it } from "vitest";
import { ReguaCobrancaService } from "./regua-cobranca.service";

/**
 * A régua roda sozinha, todo dia, e fala com o cliente pagante.
 *
 * Era a única peça da cobrança sem teste nenhum — justamente a que ninguém vê
 * acontecer. As invariantes aqui não são detalhe de implementação: cada uma
 * corresponde a um jeito de perder dinheiro ou de queimar o cliente.
 *
 * A regra pura (`acaoDaRegua`) já tem os testes dela em
 * `common/assinatura-cobranca.spec.ts`. O que se prova AQUI é a orquestração:
 * quem entra na lista, o que é gravado, e o que acontece quando algo falha.
 */
describe("régua de cobrança", () => {
  const HOJE = new Date("2026-09-14T12:00:00.000Z");

  /** Uma cobrança vencida há 3 dias, ainda sem nenhum aviso de atraso. */
  function cobrancaAtrasada(over: Record<string, unknown> = {}) {
    return {
      id: "cob1",
      status: "VENCIDA",
      competencia: new Date("2026-09-01T00:00:00.000Z"),
      vencimento: new Date("2026-09-11T00:00:00.000Z"),
      valorCentavos: 189000,
      linkPagamento: "https://www.asaas.com/i/abc123",
      avisoAbertaEm: null,
      avisoAtrasoEm: null,
      avisosAtraso: 0,
      assinatura: {
        id: "a1",
        nomeResponsavel: "Financeiro",
        telefoneCobranca: "42998424945",
        conta: { nome: "Schaba" },
      },
      ...over,
    };
  }

  function montar(cobrancas: unknown[], envioOk = true) {
    const enviosFeitos: Record<string, unknown>[] = [];
    const gravacoes: Record<string, unknown>[] = [];
    const filtroDaBusca: Record<string, unknown> = {};

    const prisma = {
      cobrancaAssinatura: {
        updateMany: async () => ({ count: 0 }),
        findMany: async (args: { where?: unknown; include?: unknown }) => {
          // A régua faz duas buscas; só a que traz `include` é a dos avisos.
          if (!args.include) return [];
          Object.assign(filtroDaBusca, args.where);
          return cobrancas;
        },
        update: async (args: { where: unknown; data: unknown }) => {
          gravacoes.push(args as Record<string, unknown>);
          return {};
        },
      },
    };
    const envio = {
      tentarEnviar: async (msg: Record<string, unknown>) => {
        enviosFeitos.push(msg);
        return envioOk
          ? { enviado: true }
          : { enviado: false, erro: { codigo: "SEM_INSTANCIA", detalhe: "WhatsApp fora do ar" } };
      },
    };
    const assinaturas = { reavaliarInadimplencia: async () => {} };

    const s = new ReguaCobrancaService(
      prisma as never,
      envio as never,
      assinaturas as never,
      { avisarAgora: async () => ({ enviado: true }) } as never,
    );
    return { s, enviosFeitos, gravacoes, filtroDaBusca };
  }

  it("manda o aviso de atraso pela rota certa e grava que saiu", async () => {
    const { s, enviosFeitos, gravacoes } = montar([cobrancaAtrasada()]);
    const r = await s.passar();

    expect(enviosFeitos).toHaveLength(1);
    expect(enviosFeitos[0]).toMatchObject({ rota: "COBRANCA_ATRASADA" });
    expect(r.enviados).toEqual(["Schaba (setembro/2026): atraso"]);
    // Conta o aviso: é o contador que faz a régua parar depois de três.
    expect(gravacoes[0]!.data).toMatchObject({ avisosAtraso: { increment: 1 } });
  });

  it("aviso que NÃO saiu não grava data nenhuma", async () => {
    // A invariante mais cara do arquivo. Marcar como avisado o que não foi
    // enviado é exatamente como um cliente deixa de ser cobrado para sempre:
    // a régua acha que já falou, e nunca mais tenta.
    const { s, gravacoes } = montar([cobrancaAtrasada()], false);
    const r = await s.passar();

    expect(gravacoes).toHaveLength(0);
    expect(r.enviados).toHaveLength(0);
    expect(r.naoEnviados).toEqual(["Schaba: WhatsApp fora do ar"]);
  });

  it("cobrança sem link de pagamento não vira aviso", async () => {
    // Dizer "você deve" sem dizer "pague aqui" é pior que ficar quieto.
    const { s, enviosFeitos } = montar([cobrancaAtrasada({ linkPagamento: null })]);
    const r = await s.passar();

    expect(enviosFeitos).toHaveLength(0);
    expect(r.naoEnviados).toEqual(["Schaba: sem link de pagamento"]);
  });

  it("nunca entra na régua quem está cancelado ou já pagou", async () => {
    const { s, filtroDaBusca } = montar([]);
    await s.passar();

    // O filtro é a defesa real: uma assinatura cancelada que escapasse aqui
    // cobraria por um contrato que não existe mais.
    expect(filtroDaBusca).toMatchObject({
      status: { in: ["PENDENTE", "VENCIDA"] },
      assinatura: { status: { not: "CANCELADA" } },
    });
  });

  it("o telefone vai normalizado pro WhatsApp", async () => {
    // Número brasileiro com o nono dígito a mais faz o canal DESCARTAR a
    // mensagem em silêncio — o pior tipo de falha, porque parece sucesso.
    const { s, enviosFeitos } = montar([cobrancaAtrasada()]);
    await s.passar();

    const destino = (enviosFeitos[0] as { destino: { numero: string } }).destino;
    expect(destino.numero).toBe("5542998424945");
  });

  it("nenhum parâmetro de template tem quebra de linha", async () => {
    // A Meta recusa o template inteiro se um parâmetro tiver \n, tab ou 4+
    // espaços. A recusa chega como erro de envio, não como aviso — então o
    // cliente simplesmente não recebe.
    const { s, enviosFeitos } = montar([cobrancaAtrasada()]);
    await s.passar();

    const params = (enviosFeitos[0] as { params: string[] }).params;
    expect(params.length).toBeGreaterThan(0);
    for (const p of params) expect(p).not.toMatch(/[\n\t]|\s{4,}/);
  });

  it("a régua se esgota depois de três avisos e cala a boca", async () => {
    // Decisão do dono: avisa em D+1, D+7 e D+15 e para. Daí é conversa humana.
    const { s, enviosFeitos } = montar([
      cobrancaAtrasada({ avisosAtraso: 3, vencimento: new Date("2026-08-01T00:00:00.000Z") }),
    ]);
    const r = await s.passar();

    expect(enviosFeitos).toHaveLength(0);
    expect(r.semAcao).toBe(1);
  });

  it("rodar duas vezes no mesmo dia não manda duas mensagens", async () => {
    // Idempotência do cron: a data gravada hoje é o que segura a segunda
    // passada. Sem isso, um retry do Easypanel viraria cobrança em dobro.
    // `avisosAtraso: 0` de propósito: com 3 dias de atraso o marco D+1 já
    // passou, então a ÚNICA coisa que segura o segundo envio é a data de hoje
    // gravada. Com o contador em 1 o teste passaria pelo motivo errado (o
    // próximo marco é D+7) e não provaria nada.
    const { s, enviosFeitos } = montar([cobrancaAtrasada({ avisoAtrasoEm: HOJE, avisosAtraso: 0 })]);
    const r = await s.passar();

    expect(enviosFeitos).toHaveLength(0);
    expect(r.semAcao).toBe(1);

    // Controle: a MESMA cobrança sem a data de hoje é avisada.
    const limpo = montar([cobrancaAtrasada({ avisoAtrasoEm: null, avisosAtraso: 0 })]);
    await limpo.s.passar();
    expect(limpo.enviosFeitos).toHaveLength(1);
  });

  it("falha no meio não derruba o cron — devolve o erro no resumo", async () => {
    // A régua divide processo com o app do motorista. Uma exceção aqui não
    // pode parar quem está lançando viagem na estrada.
    const prisma = {
      cobrancaAssinatura: {
        updateMany: async () => {
          throw new Error("banco fora do ar");
        },
      },
    };
    const s = new ReguaCobrancaService(
      prisma as never,
      { tentarEnviar: async () => ({ enviado: true }) } as never,
      { reavaliarInadimplencia: async () => {} } as never,
      { avisarAgora: async () => ({ enviado: true }) } as never,
    );

    const r = await s.passar();
    expect(r.erro).toBe("banco fora do ar");
    expect(r.enviados).toEqual([]);
  });
});
