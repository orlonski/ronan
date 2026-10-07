import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import type { PrismaService } from "../../prisma/prisma.service";
import { IntegracoesService } from "../../admin/integracoes/integracoes.service";
import type { AuthIntegracao } from "../integracao.guard";
import { ViagensPublicaService } from "../viagens-publica.service";
import { ErroPublico } from "../erros";
import { AvisosService, cifrarSegredoAviso } from "./avisos.service";
import { gerarSegredoAviso } from "./assinatura";

/**
 * Onda 1B com Prisma REAL: o gatilho do banco, a numeração sem buraco, o aviso
 * que não volta pra quem escreveu, a lista que não traz viagem sem peso e o
 * "o que mudou desde". Só roda com `PUBLICA_TESTE_DATABASE_URL`.
 */
const URL_TESTE = process.env.PUBLICA_TESTE_DATABASE_URL;
const SUF = Date.now().toString(36).slice(-5);
const CHAVE_CRIPTO = "chave-de-teste-dos-avisos-0123456789";
let seq = 0;

describe.skipIf(!URL_TESTE)("API pública /v1 — avisos e sincronização (Prisma real)", () => {
  let prisma: PrismaService;
  let viagens: ViagensPublicaService;
  let avisos: AvisosService;
  let conta: string;
  let contaSemIntegracao: string;
  let motorista: string;
  let cpf: string;
  let placa: string;
  let erp: AuthIntegracao;
  let outro: AuthIntegracao;
  const inbox = { disparar: vi.fn(async () => {}) };

  const naConta = <T>(fn: () => Promise<T>) => comConta(conta, fn);
  const registro = (viagemId: string) =>
    comoSistema(() => prisma.registroAlteracao.findMany({ where: { entidadeId: viagemId }, orderBy: { seq: "asc" } }));

  beforeAll(async () => {
    process.env.DATABASE_URL = URL_TESTE;
    const { PrismaService: Real } = await import("../../prisma/prisma.service");
    prisma = new Real();
    await prisma.$connect();
    const auditoria = new AuditoriaService(prisma);
    const efeito = { recalcularSeguro: vi.fn(async () => {}), casarComViagem: vi.fn(async () => {}), enfileirar: vi.fn(async () => {}), calcularKm: vi.fn(async () => ({})) };
    viagens = new ViagensPublicaService(prisma, auditoria, efeito as never, efeito as never, efeito as never, efeito as never);
    avisos = new AvisosService(prisma, { get: (k: string) => (k === "WEBHOOK_CRIPTO_SECRET" ? CHAVE_CRIPTO : undefined) } as never, inbox as never);
    const integracoes = new IntegracoesService(prisma, auditoria);

    // Sem lixo de outro teste no caminho do robô.
    await comoSistema(() => prisma.registroAlteracao.updateMany({ where: { ordem: null }, data: { ordem: 0n } }));

    conta = (await comoSistema(() => prisma.conta.create({ data: { nome: `av-${SUF}`, slug: `av-${SUF}` } }))).id;
    contaSemIntegracao = (await comoSistema(() => prisma.conta.create({ data: { nome: `av-sem-${SUF}`, slug: `av-sem-${SUF}` } }))).id;
    await comoSistema(() => prisma.moduloContratado.create({ data: { contaId: conta, chave: "integracoes" } as never }));
    const admin = (await naConta(() => prisma.user.create({ data: { nome: "Adm", email: `adm-av-${SUF}@teste.local`, senhaHash: "x" } as never }))).id;
    cpf = `8${SUF.replace(/\D/g, "3").padEnd(4, "3").slice(0, 4)}000001`.slice(0, 11);
    placa = `AVS1${String.fromCharCode(65 + (Date.now() % 26))}23`;
    motorista = (await naConta(() => prisma.motorista.create({ data: { nome: "Mot", cpf, senhaHash: "x" } as never }))).id;
    await naConta(() => prisma.veiculo.create({ data: { placa } as never }));
    const user = {
      kind: "ADMIN_USER", id: admin, nome: "Adm", email: "", contaId: conta, contaNome: "", contaOrigemId: conta, contaOrigemNome: "",
      assumida: false, contaSomenteLeitura: false, plataforma: false, escopo: null,
      permissoes: ["viagens.ver", "viagens.ver-comercial", "viagens.editar", "motoristas.criar", "veiculos.criar", "locais.criar"],
    } as never;
    const escopos = ["viagens:ler", "viagens:escrever", "valores:ler"] as const;
    const mk = async (nome: string, sistema: string) => {
      const c = await naConta(() => integracoes.criar(user, { nome, sistema, escopos: [...escopos] }));
      return { kind: "INTEGRACAO", integracaoId: c.integracaoId, chaveId: "", nome, sistema, contaId: conta, escopos: [...escopos] } as AuthIntegracao;
    };
    erp = await mk("ERP", "erp");
    outro = await mk("BI", "bi");
    // Os dois escutam tudo; endereço que não existe (o envio vai falhar no DNS).
    for (const i of [erp, outro]) {
      await naConta(() =>
        prisma.avisoIntegracao.create({
          data: {
            integracaoId: i.integracaoId,
            url: `https://avisos-${i.sistema}-${SUF}.invalid/x`,
            eventos: ["viagem.criada", "viagem.atualizada", "viagem.finalizada", "viagem.conferida", "viagem.excluida"],
            segredoCifrado: cifrarSegredoAviso(gerarSegredoAviso(), CHAVE_CRIPTO),
          },
        }),
      );
    }
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const corpo = (over: Record<string, unknown> = {}) => ({
    data: "2026-10-07",
    motorista: { cpf },
    veiculo: { placa },
    toneladas: 30,
    km: 40,
    ...over,
  });

  it("o gatilho anota quem escreveu; mudança que não sai na API não conta; conferir vira evento", async () => {
    const r = await naConta(() => viagens.gravarPorExterno(erp, `S-${SUF}-1`, corpo() as never, undefined));
    const id = r.corpo.viagem.id;
    let linhas = await registro(id);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ operacao: "CRIADA", integracaoId: erp.integracaoId, contaId: conta });

    // carimbo interno: não é mudança pra quem integra
    await naConta(() => prisma.viagem.update({ where: { id }, data: { kmAvaliadoEm: new Date() } }));
    expect(await registro(id)).toHaveLength(1);

    // a pessoa conferiu
    await naConta(() => prisma.viagem.update({ where: { id }, data: { revisadoEm: new Date(), status: "OK" } }));
    linhas = await registro(id);
    expect(linhas).toHaveLength(2);
    expect(linhas[1]).toMatchObject({ operacao: "ATUALIZADA", integracaoId: null });
    expect(linhas[1]!.eventos).toContain("viagem.conferida");
  });

  it("empresa sem integração não grava nada no registro", async () => {
    const m = await comConta(contaSemIntegracao, () => prisma.motorista.create({ data: { nome: "x", cpf: "52998224725", senhaHash: "x" } as never }));
    const v = await comConta(contaSemIntegracao, () => prisma.veiculo.create({ data: { placa: "SEM1A11" } as never }));
    const vg = await comConta(contaSemIntegracao, () =>
      prisma.viagem.create({ data: { clientId: `sem-${SUF}`, motoristaId: m.id, veiculoId: v.id, status: "ENVIADA" } as never }),
    );
    expect(await registro(vg.id)).toHaveLength(0);
  });

  it("o robô numera em sequência e o aviso NÃO volta pra integração que escreveu", async () => {
    const r = await naConta(() => viagens.gravarPorExterno(erp, `S-${SUF}-2`, corpo() as never, undefined));
    await avisos.publicar();
    const entregas = await comoSistema(() =>
      prisma.entregaAviso.findMany({ where: { entidadeId: r.corpo.viagem.id }, include: { aviso: { select: { integracaoId: true } } } }),
    );
    // Criada pelo ERP: só o BI é avisado.
    expect(entregas.map((e) => e.aviso.integracaoId)).toEqual([outro.integracaoId]);
    expect(entregas[0]!.tipo).toBe("viagem.criada");
    expect((entregas[0]!.payload as { dados: { viagem: { id: string } } }).dados.viagem.id).toBe(r.corpo.viagem.id);
    const ordens = (await registro(r.corpo.viagem.id)).map((l) => l.ordem);
    expect(ordens.every((o) => o != null)).toBe(true);
  });

  it("muitas mudanças da mesma viagem antes da entrega viram UM aviso", async () => {
    const r = await naConta(() => viagens.gravarPorExterno(outro, `S-${SUF}-3`, corpo() as never, undefined));
    for (const t of [31, 32, 33]) await naConta(() => prisma.viagem.update({ where: { id: r.corpo.viagem.id }, data: { toneladas: t } }));
    await avisos.publicar();
    const doErp = await comoSistema(() =>
      prisma.entregaAviso.findMany({ where: { entidadeId: r.corpo.viagem.id, aviso: { integracaoId: erp.integracaoId } } }),
    );
    expect(doErp.filter((e) => e.tipo === "viagem.atualizada")).toHaveLength(1);
    expect(doErp.filter((e) => e.tipo === "viagem.criada")).toHaveLength(1);
  });

  it("'o que mudou desde' devolve tudo em ordem, inclusive exclusão, e o cursor segue", async () => {
    const a = await naConta(() => viagens.alteracoes(erp, {}));
    const r = await naConta(() => viagens.gravarPorExterno(erp, `S-${SUF}-4`, corpo() as never, undefined));
    await naConta(() => prisma.viagem.delete({ where: { id: r.corpo.viagem.id } }));
    await avisos.publicar();
    let cursor = a.proximoCursor;
    const vistas: { id: string; mudanca: string; porEstaIntegracao: boolean; externo: string | null }[] = [];
    for (let i = 0; i < 50; i++) {
      const p = await naConta(() => viagens.alteracoes(erp, { cursor, limite: 2 }));
      vistas.push(...p.dados);
      cursor = p.proximoCursor;
      if (!p.temMais) break;
    }
    const dela = vistas.filter((v) => v.id === r.corpo.viagem.id);
    expect(dela.map((v) => v.mudanca)).toEqual(["CRIADA", "EXCLUIDA"]);
    expect(dela[0]!.porEstaIntegracao).toBe(true);
    // o vínculo sobrevive à exclusão: o ERP sabe QUAL viagem dele sumiu
    expect(dela[1]!.externo).toBe(`S-${SUF}-4`);
  });

  it("cursor de antes de uma pausa do registro recebe 410", async () => {
    const antes = await naConta(() => viagens.alteracoes(erp, {}));
    const max = await comoSistema(() => prisma.registroAlteracao.aggregate({ _max: { ordem: true } }));
    await comoSistema(() =>
      prisma.configuracaoPlataforma.upsert({
        where: { id: "singleton" },
        create: { id: "singleton", registroAlteracoesOrdemMinima: (max._max.ordem ?? 0n) + 1000n },
        update: { registroAlteracoesOrdemMinima: (max._max.ordem ?? 0n) + 1000n },
      }),
    );
    try {
      await naConta(() => viagens.alteracoes(erp, { cursor: antes.proximoCursor }));
      expect.fail("devia dar 410");
    } catch (e) {
      expect((e as ErroPublico).codigo).toBe("CURSOR_EXPIRADO");
    } finally {
      await comoSistema(() => prisma.configuracaoPlataforma.update({ where: { id: "singleton" }, data: { registroAlteracoesOrdemMinima: null } }));
    }
  });

  it("a lista padrão não traz viagem sem peso; o valor só sai com o escopo", async () => {
    const semPeso = await naConta(() => viagens.gravarPorExterno(erp, `S-${SUF}-5`, corpo({ toneladas: undefined }) as never, undefined));
    const padrao = await naConta(() => viagens.listar(erp, { limite: 100 }));
    expect(padrao.dados.map((v) => v.id)).not.toContain(semPeso.corpo.viagem.id);
    const todas = await naConta(() => viagens.listar(erp, { limite: 100, incluirIncompletas: "true" }));
    const v = todas.dados.find((x) => x.id === semPeso.corpo.viagem.id)!;
    expect(v.toneladasFaturadas).toBeNull();
    expect("valor" in v).toBe(true);
    const semEscopo = await naConta(() => viagens.listar({ ...erp, escopos: ["viagens:ler"] }, { limite: 100, incluirIncompletas: "true" }));
    expect(semEscopo.dados.every((x) => !("valor" in x))).toBe(true);
  });

  it("endereço fora do ar: tenta de novo mais tarde e segura as outras do mesmo endereço", async () => {
    await comoSistema(() => prisma.entregaAviso.updateMany({ where: { status: "PENDENTE" }, data: { proximaTentativaEm: new Date(Date.now() - 1000) } }));
    const pendentesAntes = await comoSistema(() => prisma.entregaAviso.count({ where: { status: "PENDENTE", aviso: { integracaoId: erp.integracaoId } } }));
    expect(pendentesAntes).toBeGreaterThan(1);
    await avisos.entregar();
    const doErp = await comoSistema(() => prisma.entregaAviso.findMany({ where: { aviso: { integracaoId: erp.integracaoId }, status: "PENDENTE" } }));
    expect(doErp.filter((e) => e.tentativas === 1)).toHaveLength(1);
    expect(doErp.every((e) => e.proximaTentativaEm!.getTime() > Date.now())).toBe(true);
    const aviso = await comoSistema(() => prisma.avisoIntegracao.findUniqueOrThrow({ where: { integracaoId: erp.integracaoId } }));
    expect(aviso.falhasSeguidas).toBe(1);
  });

  it("conexão desligada: o que estava na fila é descartado com o motivo, não enviado", async () => {
    await comoSistema(() => prisma.integracao.update({ where: { id: outro.integracaoId }, data: { revogadaEm: new Date() } }));
    await comoSistema(() => prisma.entregaAviso.updateMany({ where: { status: "PENDENTE" }, data: { proximaTentativaEm: new Date(Date.now() - 1000) } }));
    await avisos.entregar();
    const doBi = await comoSistema(() => prisma.entregaAviso.findMany({ where: { aviso: { integracaoId: outro.integracaoId } } }));
    expect(doBi.length).toBeGreaterThan(0);
    expect(doBi.every((e) => e.status === "DESCARTADA" && e.ultimoErro === "A conexão foi desligada.")).toBe(true);
  });

  it("três dias falhando: desliga os avisos e avisa o administrador", async () => {
    await comoSistema(() =>
      prisma.avisoIntegracao.update({ where: { integracaoId: erp.integracaoId }, data: { primeiraFalhaEm: new Date(Date.now() - 4 * 86_400_000) } }),
    );
    await comoSistema(() => prisma.entregaAviso.updateMany({ where: { status: "PENDENTE" }, data: { proximaTentativaEm: new Date(Date.now() - 1000) } }));
    await avisos.entregar();
    const aviso = await comoSistema(() => prisma.avisoIntegracao.findUniqueOrThrow({ where: { integracaoId: erp.integracaoId } }));
    expect(aviso.ativo).toBe(false);
    expect(inbox.disparar).toHaveBeenCalledWith(expect.objectContaining({ tipo: "integracao", permissao: "integracoes.gerenciar" }));
  });
});
