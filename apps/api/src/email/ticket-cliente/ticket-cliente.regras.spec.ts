import { StatusViagem } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ENVIANDO_ORFAO_MS, podeRetomar, TENTATIVAS_MAX_EMAIL } from "../email.service";
import {
  chaveResumoDiario,
  chaveTicketViagem,
  montarEmailResumoDiario,
  montarEmailTeste,
  montarEmailTicketViagem,
  normalizarEmails,
  novoDesde,
  pesoBR,
  resolverEnvioTicket,
  viagemEntraNoTicket,
  type ViagemDoTicket,
} from "./ticket-cliente.regras";

const marca = { nome: "Transportes Exemplo", logoUrl: null };
const ligado = new Date("2026-10-01T12:00:00Z");

describe("resolverEnvioTicket — quem recebe", () => {
  const pagador = { modo: "A_CADA_VIAGEM" as const, emails: ["Fin@Cliente.com.br "], desde: ligado };

  it("obra sem configuração segue o pagador", () => {
    const r = resolverEnvioTicket({ modo: null, emails: [], desde: null }, pagador);
    expect(r).toEqual({ modo: "A_CADA_VIAGEM", emails: ["fin@cliente.com.br"], desde: ligado, origem: "PAGADOR" });
  });

  it("obra com configuração própria manda em si — sem somar os e-mails do pagador", () => {
    const r = resolverEnvioTicket({ modo: "RESUMO_DIARIO", emails: ["obra@x.com"], desde: ligado }, pagador);
    expect(r.modo).toBe("RESUMO_DIARIO");
    expect(r.emails).toEqual(["obra@x.com"]);
    expect(r.origem).toBe("OBRA");
  });

  it("obra com NENHUM cala a obra mesmo com o pagador ligado", () => {
    const r = resolverEnvioTicket({ modo: "NENHUM", emails: [], desde: null }, pagador);
    expect(r.modo).toBe("NENHUM");
  });

  it("modo ligado sem e-mail válido vale como NENHUM", () => {
    const r = resolverEnvioTicket({ modo: null, emails: [], desde: null },{ ...pagador, emails: ["sem-arroba"] });
    expect(r.modo).toBe("NENHUM");
  });

  it("pagador padrão (NENHUM) não manda nada", () => {
    const r = resolverEnvioTicket({ modo: null, emails: [], desde: null }, { modo: "NENHUM", emails: ["a@b.com"], desde: null });
    expect(r.modo).toBe("NENHUM");
  });
});

describe("normalizarEmails", () => {
  it("minúsculo, sem espaço, sem repetido, descarta lixo", () => {
    expect(normalizarEmails([" A@B.com", "a@b.com", "", "lixo", "c@d.com.br"])).toEqual(["a@b.com", "c@d.com.br"]);
  });
});

describe("novoDesde — ligar não despeja o histórico", () => {
  const agora = new Date("2026-10-02T10:00:00Z");
  it("ligar marca agora", () => {
    expect(novoDesde({ modo: "NENHUM", desde: null }, "A_CADA_VIAGEM", agora)).toEqual(agora);
  });
  it("salvar de novo no mesmo modo (só trocou e-mail) mantém o desde", () => {
    expect(novoDesde({ modo: "A_CADA_VIAGEM", desde: ligado }, "A_CADA_VIAGEM", agora)).toEqual(ligado);
  });
  it("trocar de modo recomeça", () => {
    expect(novoDesde({ modo: "A_CADA_VIAGEM", desde: ligado }, "RESUMO_DIARIO", agora)).toEqual(agora);
  });
  it("desligar ou seguir o pagador zera", () => {
    expect(novoDesde({ modo: "A_CADA_VIAGEM", desde: ligado }, "NENHUM", agora)).toBeNull();
    expect(novoDesde({ modo: "A_CADA_VIAGEM", desde: ligado }, null, agora)).toBeNull();
  });
});

describe("viagemEntraNoTicket", () => {
  const depois = new Date("2026-10-01T13:00:00Z");
  const antes = new Date("2026-10-01T11:00:00Z");

  it("OK revisada depois de ligar entra", () => {
    expect(viagemEntraNoTicket({ status: StatusViagem.OK, revisadoEm: depois }, ligado)).toBe(true);
  });
  it("aprovada antes de ligar não entra (nada de histórico)", () => {
    expect(viagemEntraNoTicket({ status: StatusViagem.OK, revisadoEm: antes }, ligado)).toBe(false);
  });
  it("sem desde (envio desligado) nunca entra", () => {
    expect(viagemEntraNoTicket({ status: StatusViagem.OK, revisadoEm: depois }, null)).toBe(false);
  });
  it("OK sem revisadoEm (match do fechamento) não é aprovação de conferência", () => {
    expect(viagemEntraNoTicket({ status: StatusViagem.OK, revisadoEm: null }, ligado)).toBe(false);
  });
  it.each([
    StatusViagem.EM_ANDAMENTO,
    StatusViagem.AGUARDANDO_PESO,
    StatusViagem.INCOMPLETA,
    StatusViagem.DIVERGENTE,
    StatusViagem.ENVIADA,
    StatusViagem.AJUSTADA,
    StatusViagem.EM_CONFERENCIA,
  ])("%s nunca entra, mesmo com revisadoEm", (status) => {
    expect(viagemEntraNoTicket({ status, revisadoEm: depois }, ligado)).toBe(false);
  });
});

describe("idempotência", () => {
  it("a chave é estável por viagem e por obra+dia", () => {
    expect(chaveTicketViagem("v1")).toBe(chaveTicketViagem("v1"));
    expect(chaveTicketViagem("v1")).not.toBe(chaveTicketViagem("v2"));
    expect(chaveResumoDiario("c1", "2026-10-01")).toBe("ticket-resumo:c1:2026-10-01");
    expect(chaveResumoDiario("c1", "2026-10-01")).not.toBe(chaveResumoDiario("c1", "2026-10-02"));
  });

  const agora = new Date("2026-10-01T12:00:00Z");
  it("ENVIADO nunca sai de novo", () => {
    expect(podeRetomar({ status: "ENVIADO", tentativas: 1, ultimaTentativaEm: new Date(0) }, agora)).toBe(false);
  });
  it("FALHOU retoma até o teto de tentativas", () => {
    expect(podeRetomar({ status: "FALHOU", tentativas: 1, ultimaTentativaEm: agora }, agora)).toBe(true);
    expect(podeRetomar({ status: "FALHOU", tentativas: TENTATIVAS_MAX_EMAIL, ultimaTentativaEm: agora }, agora)).toBe(false);
  });
  it("ENVIANDO recente é outra instância mandando — não mexe", () => {
    expect(podeRetomar({ status: "ENVIANDO", tentativas: 1, ultimaTentativaEm: new Date(agora.getTime() - 60_000) }, agora)).toBe(false);
  });
  it("ENVIANDO velho é processo que morreu — retoma", () => {
    const velho = new Date(agora.getTime() - ENVIANDO_ORFAO_MS - 1);
    expect(podeRetomar({ status: "ENVIANDO", tentativas: 1, ultimaTentativaEm: velho }, agora)).toBe(true);
  });
});

const viagem = (over: Partial<ViagemDoTicket> = {}): ViagemDoTicket => ({
  placa: "BRA2E19",
  motoristaNome: "João",
  data: new Date("2026-10-01T00:00:00Z"),
  lancadaEm: new Date("2026-10-01T13:05:00Z"), // 10:05 em SP
  material: "Pedra brita",
  toneladas: "32.45",
  ticket: "98765",
  origem: "Pedreira Norte",
  destino: "Obra Centro",
  link: "https://app.movatruck.com.br/v/tok123",
  ...over,
});

describe("montarEmailTicketViagem", () => {
  const e = montarEmailTicketViagem({ marca, obraNome: "Obra Centro", viagem: viagem() });

  it("assunto diz ticket, placa, data e obra", () => {
    expect(e.assunto).toBe("Ticket nº 98765 — BRA2E19 em 01/10/2026 · Obra Centro");
  });
  it("leva o link do comprovante, a hora de SP e o peso em formato BR", () => {
    expect(e.html).toContain('href="https://app.movatruck.com.br/v/tok123"');
    expect(e.html).toContain("10:05");
    expect(e.html).toContain("32,450 t");
    expect(e.texto).toContain("https://app.movatruck.com.br/v/tok123");
  });
  it("marca da transportadora no topo e rodapé Movatruck", () => {
    expect(e.html).toContain("Transportes Exemplo");
    expect(e.html).toContain("Movatruck");
  });
  it("nunca mostra R$", () => {
    expect(e.html).not.toContain("R$");
    expect(e.texto).not.toContain("R$");
  });
  it("escapa HTML vindo do cadastro", () => {
    const x = montarEmailTicketViagem({ marca, obraNome: "<script>x</script>", viagem: viagem() });
    expect(x.html).not.toContain("<script>x");
    expect(x.html).toContain("&lt;script&gt;");
  });
  it("nunca aponta pro MinIO", () => {
    expect(e.html).not.toMatch(/minio|:9000/i);
  });
});

describe("montarEmailResumoDiario", () => {
  const e = montarEmailResumoDiario({
    marca,
    obraNome: "Obra Centro",
    diaBR: "01/10/2026",
    viagens: [
      viagem({ placa: "TARDE01", lancadaEm: new Date("2026-10-01T20:00:00Z"), toneladas: "10", link: "https://x/v/b" }),
      viagem({ placa: "CEDO001", lancadaEm: new Date("2026-10-01T10:00:00Z"), toneladas: "20.5", link: "https://x/v/a" }),
    ],
  });

  it("assunto com dia, contagem e obra", () => {
    expect(e.assunto).toBe("Resumo de 01/10/2026 — 2 viagens aprovadas · Obra Centro");
  });
  it("viagens em ordem de lançamento, com link de cada uma e o total", () => {
    expect(e.html.indexOf("CEDO001")).toBeLessThan(e.html.indexOf("TARDE01"));
    expect(e.html).toContain('href="https://x/v/a"');
    expect(e.html).toContain('href="https://x/v/b"');
    expect(e.html).toContain("30,500 t");
    expect(e.texto).toContain("07:00 · CEDO001");
  });
  it("singular com uma viagem e nada de R$", () => {
    const um = montarEmailResumoDiario({ marca, obraNome: "O", diaBR: "01/10/2026", viagens: [viagem()] });
    expect(um.assunto).toContain("1 viagem aprovada");
    expect(um.html).not.toContain("R$");
  });
});

describe("montarEmailTeste", () => {
  it("avisa que é teste e não leva link", () => {
    const e = montarEmailTeste({ marca, nomeDestino: "Cliente X", modo: "RESUMO_DIARIO", agora: ligado });
    expect(e.assunto.startsWith("[Teste]")).toBe(true);
    expect(e.html).toContain("TESTE");
    expect(e.html).toContain("Resumo do dia");
    expect(e.html).not.toContain("/v/");
  });
});

describe("montarEmailTeste — dia de São Paulo", () => {
  it("às 22h de SP (01h UTC do dia seguinte) a data do exemplo é a de SP", () => {
    const e = montarEmailTeste({ marca, nomeDestino: "X", modo: null, agora: new Date("2026-10-02T01:05:00Z") });
    expect(e.assunto).toContain("01/10/2026");
  });
});

describe("pesoBR", () => {
  it("três casas e vazio vira null", () => {
    expect(pesoBR("1234.5")).toBe("1.234,500 t");
    expect(pesoBR(null)).toBeNull();
    expect(pesoBR("abc")).toBeNull();
  });
});
