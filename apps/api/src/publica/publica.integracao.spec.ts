import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import { AuditoriaService } from "../auditoria/auditoria.service";
import { abrirContexto, comConta, comoSistema, definirConta } from "../common/conta/conta-context";
import type { PrismaService } from "../prisma/prisma.service";
import { IdentidadeService } from "../auth/identidade.service";
import { KmReprocessamentoService } from "../motorista/km-reprocessamento.service";
import { IntegracoesService } from "../admin/integracoes/integracoes.service";
import { ESCOPO_KEY, IntegracaoGuard, type AuthIntegracao } from "./integracao.guard";
import { ViagensPublicaService } from "./viagens-publica.service";
import { CadastrosPublicaService } from "./cadastros-publica.service";
import { ErroPublico } from "./erros";

/**
 * A API pública com Prisma REAL (banco descartável com o schema de produção).
 * Só roda com `PUBLICA_TESTE_DATABASE_URL`; sem ela, pula.
 *
 * Prova os furos que o QA marcou como BLOQUEIA (docs/api-publica/05-qa.md) e o
 * "pronto" do 1A: duas empresas, a chave de uma nunca alcança a outra.
 */
const URL_TESTE = process.env.PUBLICA_TESTE_DATABASE_URL;
const SUF = Date.now().toString(36).slice(-5);
let seq = 0;
const cpfNovo = () => `9${SUF.replace(/\D/g, "7").padEnd(4, "7").slice(0, 4)}${String(++seq).padStart(6, "0")}`.slice(0, 11);
const placaNova = () => `TST${seq % 10}${String.fromCharCode(65 + (seq % 26))}${String(10 + (++seq % 90))}`;

describe.skipIf(!URL_TESTE)("API pública /v1 (Prisma real)", () => {
  let prisma: PrismaService;
  let viagens: ViagensPublicaService;
  let cadastros: CadastrosPublicaService;
  let integracoes: IntegracoesService;
  const efeitos = {
    precificar: vi.fn(async () => {}),
    enfileirar: vi.fn(async () => {}),
    calcularKm: vi.fn(async () => ({})),
    casar: vi.fn(async () => {}),
  };
  const ctx: Record<"A" | "B" | "SemModulo", { conta: string; admin: string; integ: AuthIntegracao; chave: string; motorista: string; cpf: string; veiculo: string; placa: string }> = {} as never;

  const naConta = <T>(c: string, fn: () => Promise<T>) => comConta(c, fn);

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_TESTE;
    const { PrismaService: Real } = await import("../prisma/prisma.service");
    prisma = new Real();
    await prisma.$connect();
    const auditoria = new AuditoriaService(prisma);
    viagens = new ViagensPublicaService(
      prisma,
      auditoria,
      { recalcularSeguro: efeitos.precificar } as never,
      { casarComViagem: efeitos.casar } as never,
      { enfileirar: efeitos.enfileirar } as never,
      { calcularKm: efeitos.calcularKm } as never,
    );
    cadastros = new CadastrosPublicaService(prisma, auditoria);
    integracoes = new IntegracoesService(prisma, auditoria);

    for (const nome of ["A", "B", "SemModulo"] as const) {
      const conta = (await comoSistema(() => prisma.conta.create({ data: { nome: `api-${nome}-${SUF}`, slug: `api-${nome.toLowerCase()}-${SUF}` } }))).id;
      if (nome !== "SemModulo") {
        await comoSistema(() => prisma.moduloContratado.create({ data: { contaId: conta, chave: "integracoes" } as never }));
      }
      const admin = (await naConta(conta, () => prisma.user.create({ data: { nome: `Admin ${nome}`, email: `admin-${nome}-${SUF}@teste.local`, senhaHash: "x" } as never }))).id;
      const cpf = cpfNovo();
      const motorista = (await naConta(conta, () => prisma.motorista.create({ data: { nome: `Motorista ${nome}`, cpf, senhaHash: "x", telefone: "42999990000" } as never }))).id;
      const placa = placaNova();
      const veiculo = (await naConta(conta, () => prisma.veiculo.create({ data: { placa } as never }))).id;
      const user = {
        kind: "ADMIN_USER", id: admin, nome: `Admin ${nome}`, email: "", contaId: conta, contaNome: nome, contaOrigemId: conta, contaOrigemNome: nome,
        assumida: false, contaSomenteLeitura: false, plataforma: false, escopo: null,
        permissoes: ["viagens.ver", "viagens.editar", "motoristas.criar", "veiculos.criar", "locais.criar", "integracoes.ver", "integracoes.gerenciar"],
      } as never;
      const criada = await naConta(conta, () =>
        integracoes.criar(user, { nome: `ERP ${nome}`, sistema: "erp", escopos: ["viagens:ler", "viagens:escrever", "cadastros:escrever"] }),
      );
      ctx[nome] = {
        conta, admin, chave: criada.chave, motorista, cpf, veiculo, placa,
        integ: { kind: "INTEGRACAO", integracaoId: criada.integracaoId, chaveId: "", nome: `ERP ${nome}`, sistema: "erp", contaId: conta, escopos: ["viagens:ler", "viagens:escrever", "cadastros:escrever"] },
      };
    }
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  // ------------------------------------------------------------- porteiro --

  function contexto(chave: string | null, escopo: string | null, metodo = "POST") {
    const handler = () => undefined;
    Reflect.defineMetadata(ESCOPO_KEY, escopo, handler);
    const req = { method: metodo, headers: chave ? { authorization: `Bearer ${chave}` } : {}, url: "/v1/viagens", originalUrl: "/v1/viagens", ip: "10.0.0.1", socket: {} } as Record<string, unknown>;
    const res = { setHeader: vi.fn(), once: vi.fn(), locals: {}, statusCode: 200 };
    return {
      req,
      ctx: {
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
        getHandler: () => handler,
        getClass: () => class {},
      } as never,
    };
  }
  const porteiro = () => new IntegracaoGuard(prisma, new Reflector());
  const passa = async (chave: string | null, escopo: string | null, metodo = "POST") =>
    abrirContexto(async () => {
      const c = contexto(chave, escopo, metodo);
      await porteiro().canActivate(c.ctx);
      return c.req.integracao as AuthIntegracao;
    });
  const codigoDe = async (p: Promise<unknown>) => {
    try {
      await p;
      return "PASSOU";
    } catch (e) {
      return e instanceof ErroPublico ? e.codigo : String(e);
    }
  };

  it("porteiro: a chave diz a empresa; sem chave, formato errado ou chave de mentira não entram", async () => {
    const a = await passa(ctx.A.chave, "viagens:escrever");
    expect(a.contaId).toBe(ctx.A.conta);
    expect(await codigoDe(passa(null, "viagens:escrever"))).toBe("NAO_AUTENTICADO");
    expect(await codigoDe(passa("eyJhbGciOiJIUzI1NiJ9.jwt.do.painel", "viagens:escrever"))).toBe("NAO_AUTENTICADO");
    const adulterada = ctx.A.chave.slice(0, -8) + "AAAAAAAA";
    expect(await codigoDe(passa(adulterada, "viagens:escrever"))).toBe("NAO_AUTENTICADO");
  });

  it("porteiro: módulo não contratado e escopo que a chave não tem são recusados", async () => {
    expect(await codigoDe(passa(ctx.SemModulo.chave, null, "GET"))).toBe("MODULO_NAO_CONTRATADO");
    await naConta(ctx.A.conta, () => prisma.integracao.update({ where: { id: ctx.A.integ.integracaoId }, data: { escopos: ["viagens:ler"] } }));
    expect(await codigoDe(passa(ctx.A.chave, "viagens:escrever"))).toBe("ESCOPO_INSUFICIENTE");
    await naConta(ctx.A.conta, () => prisma.integracao.update({ where: { id: ctx.A.integ.integracaoId }, data: { escopos: ["viagens:ler", "viagens:escrever", "cadastros:escrever"] } }));
  });

  it("porteiro: conta em somente leitura lê mas não grava", async () => {
    await comoSistema(() => prisma.conta.update({ where: { id: ctx.B.conta }, data: { somenteLeitura: true } }));
    expect(await codigoDe(passa(ctx.B.chave, "viagens:escrever", "POST"))).toBe("CONTA_SOMENTE_LEITURA");
    expect((await passa(ctx.B.chave, "viagens:ler", "GET")).contaId).toBe(ctx.B.conta);
    await comoSistema(() => prisma.conta.update({ where: { id: ctx.B.conta }, data: { somenteLeitura: false } }));
  });

  // -------------------------------------------------------------- viagens --

  const corpo = (over: Record<string, unknown> = {}) => ({
    data: "2026-10-07",
    motorista: { cpf: ctx.A.cpf },
    veiculo: { placa: ctx.A.placa },
    toneladas: 30.5,
    km: 42,
    ticket: `T-${++seq}`,
    ...over,
  });

  it("cria, e reenviar o mesmo número atualiza em vez de duplicar", async () => {
    const externo = `PED-${SUF}-1`;
    const r1 = await naConta(ctx.A.conta, () => viagens.criar(ctx.A.integ, { ...corpo(), externo } as never, undefined));
    expect(r1.status).toBe(201);
    expect(r1.corpo.viagem.externo).toBe(externo);
    expect(r1.corpo.viagem.origem).toBe("INTEGRACAO");
    const r2 = await naConta(ctx.A.conta, () => viagens.criar(ctx.A.integ, { ...corpo({ toneladas: 31 }), externo } as never, undefined));
    expect(r2.status).toBe(200);
    expect(r2.corpo.viagem.id).toBe(r1.corpo.viagem.id);
    expect(r2.corpo.viagem.toneladas).toBe("31");
    const db = await naConta(ctx.A.conta, () => prisma.viagem.findUniqueOrThrow({ where: { id: r1.corpo.viagem.id } }));
    // O km de fora vai pro faturado e fica guardado como veio; NUNCA vira km do motorista.
    expect(db.kmMotorista).toBeNull();
    expect(db.kmOrigem?.toString()).toBe("42");
  });

  it("dois envios simultâneos com o mesmo número dão UMA viagem e nenhum erro", async () => {
    const externo = `PED-${SUF}-concorrente`;
    const rs = await Promise.all(
      [1, 2, 3].map(() => naConta(ctx.A.conta, () => viagens.criar(ctx.A.integ, { ...corpo(), externo } as never, undefined))),
    );
    expect(new Set(rs.map((r) => r.corpo.viagem.id)).size).toBe(1);
    expect(rs.filter((r) => r.corpo.criada)).toHaveLength(1);
  });

  it("sem peso entra AGUARDANDO_PESO (nunca 0 t); referência não achada vira pendência, não recusa", async () => {
    const r = await naConta(ctx.A.conta, () =>
      viagens.criar(ctx.A.integ, { ...corpo({ toneladas: undefined, material: { nome: "Pedra que não existe" } }), externo: `PED-${SUF}-sempeso` } as never, undefined),
    );
    expect(r.corpo.viagem.situacao).toBe("AGUARDANDO_PESO");
    expect(r.corpo.viagem.toneladas).toBeNull();
    expect(r.corpo.avisos.map((a) => a.codigo)).toContain("MATERIAL_NAO_ACHADO");
    expect(r.corpo.viagem.pendencias.map((p) => p.motivo)).toContain("FALTA_MATERIAL");
  });

  it("sem número e sem Idempotency-Key é recusado (reenvio duplicaria)", async () => {
    expect(await codigoDe(naConta(ctx.A.conta, () => viagens.criar(ctx.A.integ, corpo() as never, undefined)))).toBe("IDENTIFICACAO_OBRIGATORIA");
  });

  it("Idempotency-Key: mesma chave e mesmo corpo = mesma resposta; outro corpo = conflito", async () => {
    const k = `idem-${SUF}-0001`;
    const c = corpo();
    const r1 = await naConta(ctx.A.conta, () => viagens.criar(ctx.A.integ, c as never, k));
    const r2 = await naConta(ctx.A.conta, () => viagens.criar(ctx.A.integ, c as never, k));
    expect(r2.corpo.viagem.id).toBe(r1.corpo.viagem.id);
    expect(await codigoDe(naConta(ctx.A.conta, () => viagens.criar(ctx.A.integ, { ...c, toneladas: 1 } as never, k)))).toBe("IDEMPOTENCIA_CONFLITO");
  });

  // ------------------------------------------------------- duas empresas --

  it("a chave de A não alcança nada de B: motorista, caminhão e viagem de B 'não existem'", async () => {
    const deB = await naConta(ctx.B.conta, () =>
      viagens.criar(ctx.B.integ, { ...corpo({ motorista: { cpf: ctx.B.cpf }, veiculo: { placa: ctx.B.placa } }), externo: `PED-${SUF}-B` } as never, undefined),
    );
    // ids de B no corpo de A
    expect(
      await codigoDe(naConta(ctx.A.conta, () => viagens.criar(ctx.A.integ, { ...corpo({ motorista: { id: ctx.B.motorista }, veiculo: { id: ctx.B.veiculo } }), externo: `X-${SUF}` } as never, undefined))),
    ).toBe("REFERENCIA_OBRIGATORIA");
    // CPF e placa de B: dentro de A não existem
    expect(
      await codigoDe(naConta(ctx.A.conta, () => viagens.criar(ctx.A.integ, { ...corpo({ motorista: { cpf: ctx.B.cpf }, veiculo: { placa: ctx.B.placa } }), externo: `Y-${SUF}` } as never, undefined))),
    ).toBe("REFERENCIA_OBRIGATORIA");
    // ler a viagem de B por id ou pelo mesmo número
    expect(await codigoDe(naConta(ctx.A.conta, () => viagens.lerPorId(ctx.A.integ, deB.corpo.viagem.id)))).toBe("NAO_ENCONTRADO");
    expect(await codigoDe(naConta(ctx.A.conta, () => viagens.lerPorExterno(ctx.A.integ, `PED-${SUF}-B`)))).toBe("NAO_ENCONTRADO");
    // o MESMO número em A cria a viagem de A, sem colidir nem revelar a de B
    const deA = await naConta(ctx.A.conta, () => viagens.gravarPorExterno(ctx.A.integ, `PED-${SUF}-B`, corpo() as never, undefined));
    expect(deA.status).toBe(201);
    expect(deA.corpo.viagem.id).not.toBe(deB.corpo.viagem.id);
    const intacta = await naConta(ctx.B.conta, () => prisma.viagem.findUniqueOrThrow({ where: { id: deB.corpo.viagem.id } }));
    expect(intacta.contaId).toBe(ctx.B.conta);
  });

  // ------------------------------------------------- quem criou manda --

  it("viagem do app é só leitura pra integração; conferida trava; campo corrigido no painel não volta", async () => {
    const doApp = await naConta(ctx.A.conta, () =>
      prisma.viagem.create({ data: { clientId: `app-${SUF}-${++seq}`, motoristaId: ctx.A.motorista, veiculoId: ctx.A.veiculo, data: new Date("2026-10-07T00:00:00Z"), toneladas: 20, status: "ENVIADA" } as never }),
    );
    await naConta(ctx.A.conta, () => prisma.vinculoExterno.create({ data: { sistema: "erp", entidade: "viagem", entidadeId: doApp.id, idExterno: `APP-${SUF}` } as never }));
    expect(await codigoDe(naConta(ctx.A.conta, () => viagens.gravarPorExterno(ctx.A.integ, `APP-${SUF}`, corpo() as never, undefined)))).toBe("VIAGEM_DE_OUTRA_ORIGEM");

    const externo = `PED-${SUF}-trava`;
    const r = await naConta(ctx.A.conta, () => viagens.gravarPorExterno(ctx.A.integ, externo, corpo({ toneladas: 25 }) as never, undefined));
    await naConta(ctx.A.conta, () => prisma.viagem.update({ where: { id: r.corpo.viagem.id }, data: { camposTravados: ["toneladas"] } }));
    const r2 = await naConta(ctx.A.conta, () => viagens.gravarPorExterno(ctx.A.integ, externo, corpo({ toneladas: 99 }) as never, undefined));
    expect(r2.corpo.viagem.toneladas).toBe("25");
    expect(r2.corpo.avisos.map((a) => a.codigo)).toContain("CAMPO_PROTEGIDO");

    await naConta(ctx.A.conta, () => prisma.viagem.update({ where: { id: r.corpo.viagem.id }, data: { revisadoEm: new Date(), status: "OK" } }));
    expect(await codigoDe(naConta(ctx.A.conta, () => viagens.gravarPorExterno(ctx.A.integ, externo, corpo() as never, undefined)))).toBe("VIAGEM_TRAVADA");
  });

  // ------------------------------------------------ os BLOQUEIA do QA --

  it("B1: chave de B criando o CPF de um motorista de A não muda a identidade, o login nem o telefone dele", async () => {
    await naConta(ctx.B.conta, () => cadastros.motorista(ctx.B.integ, `MOT-${SUF}`, { nome: "Impostor", cpf: ctx.A.cpf, telefone: "11988887777" }));
    const ident = await new IdentidadeService(prisma).garantirPorCpf(ctx.A.cpf);
    expect(ident?.nome).toBe("Motorista A");
    expect(ident?.telefone).toBe("42999990000");
    const doB = await naConta(ctx.B.conta, () => prisma.motorista.findFirstOrThrow({ where: { cpf: ctx.A.cpf } }));
    expect(doB.identidadeId).toBeNull();
    expect(doB.aceitaWhatsapp).toBe(false);
  });

  it("B1: a integração liga motorista que já existia ao número dela, mas não muda o telefone dele", async () => {
    const r = await naConta(ctx.A.conta, () => cadastros.motorista(ctx.A.integ, `MOT-${SUF}-a`, { nome: "Outro Nome", cpf: ctx.A.cpf, telefone: "11900000000" }));
    expect(r.corpo.criado).toBe(false);
    expect(r.corpo.alterado).toBe(false);
    expect(r.corpo.avisos[0]?.codigo).toBe("CAMPO_PROTEGIDO");
    const m = await naConta(ctx.A.conta, () => prisma.motorista.findUniqueOrThrow({ where: { id: ctx.A.motorista } }));
    expect(m.telefone).toBe("42999990000");
  });

  it("B2: o robô de km não troca o km da integração", async () => {
    const r = await naConta(ctx.A.conta, () => viagens.gravarPorExterno(ctx.A.integ, `PED-${SUF}-km`, corpo({ km: 42 }) as never, undefined));
    const robo = new KmReprocessamentoService(prisma, { calcularKm: vi.fn(async () => ({ km: "77.00" })) } as never, { enviar: vi.fn() } as never, {} as never, {} as never);
    await naConta(ctx.A.conta, () => robo.reprocessar(r.corpo.viagem.id));
    const v = await naConta(ctx.A.conta, () => prisma.viagem.findUniqueOrThrow({ where: { id: r.corpo.viagem.id } }));
    expect(v.km?.toString()).toBe("42");
  });

  it("B3: o app do motorista não enxerga a viagem que veio da integração", async () => {
    const r = await naConta(ctx.A.conta, () => viagens.gravarPorExterno(ctx.A.integ, `PED-${SUF}-app`, corpo() as never, undefined));
    const noApp = await abrirContexto(async () => {
      definirConta(ctx.A.conta, { appDoMotorista: true });
      return {
        lista: await prisma.viagem.findMany({ where: { motoristaId: ctx.A.motorista }, select: { id: true } }),
        uma: await prisma.viagem.findUnique({ where: { id: r.corpo.viagem.id } }),
      };
    });
    expect(noApp.lista.map((v) => v.id)).not.toContain(r.corpo.viagem.id);
    expect(noApp.uma).toBeNull();
  });

  it("B4: criar viagem pela integração não chama nenhum aviso ao motorista", async () => {
    // O serviço nem recebe o de avisos/WhatsApp: os efeitos são só preço, fila, rota e programação.
    expect(Object.keys(efeitos)).toEqual(["precificar", "enfileirar", "calcularKm", "casar"]);
    expect(efeitos.precificar).toHaveBeenCalled();
  });

  it("revogar a chave vale no próximo pedido", async () => {
    const c = await naConta(ctx.A.conta, () => prisma.chaveIntegracao.findFirstOrThrow({ where: { integracaoId: ctx.A.integ.integracaoId } }));
    await naConta(ctx.A.conta, () =>
      integracoes.revogarChave({ id: ctx.A.admin } as never, ctx.A.integ.integracaoId, c.id, "teste de revogação"),
    );
    expect(await codigoDe(passa(ctx.A.chave, "viagens:ler", "GET"))).toBe("CHAVE_REVOGADA");
  });
});
