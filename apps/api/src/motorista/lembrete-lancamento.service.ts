import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { modulosDaConta } from "../common/conta/teto-da-conta";
import { feriadoAlcanca } from "../common/ponto-espelho";
import { inicioDoDiaData } from "../common/timezone";
import { vinculoVivo } from "../common/vinculo";
import {
  avaliarLembreteNoApp,
  hojeYmd,
  type LembreteLancamento,
  type MotoristaParaConferencia,
} from "../common/conferencia-diaria";

/** Mesma janela do cálculo do painel (`ConferenciaDiariaService`). */
const JANELA_VIAGENS_DIAS = 65;
const dataParaYmd = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Lembrete "você está há N dias sem lançar viagem", entregue DENTRO do `/m/me`.
 *
 * Campo opcional na resposta que o app já consome cache-first: app antigo ignora,
 * e sem rede o app segue com o último valor. A regra é a mesma da conferência
 * diária (`avaliarLembreteNoApp`); aqui só se carrega o que ela precisa.
 *
 * ⚠️ `/m/me` NÃO passa pelo `AcessoMotoristaGuard` com flag, então aprovação e
 * vínculo são conferidos AQUI, explicitamente. Nunca lança: falha vira `null`
 * (o lembrete é conforto, não pode derrubar o perfil do motorista).
 */
@Injectable()
export class LembreteLancamentoService {
  private readonly log = new Logger("LembreteLancamentoService");

  constructor(private readonly prisma: PrismaService) {}

  async paraMotorista(motoristaId: string, agora: Date = new Date()): Promise<LembreteLancamento | null> {
    try {
      return await this.calcular(motoristaId, agora);
    } catch (e) {
      this.log.warn(`Lembrete no app falhou pro motorista ${motoristaId}: ${(e as Error).message}`);
      return null;
    }
  }

  private async calcular(motoristaId: string, agora: Date): Promise<LembreteLancamento | null> {
    const m = await this.prisma.motorista.findUnique({
      where: { id: motoristaId },
      select: {
        id: true,
        contaId: true,
        ativo: true,
        status: true,
        aceite: true,
        criadoEm: true,
        receberConferenciaDiaria: true,
      },
    });
    // Sem cadastro aprovado e com vínculo vivo, não há o que lembrar.
    if (!m || m.status !== "APROVADO" || !vinculoVivo(m)) return null;

    // Barato primeiro: a maioria das empresas nunca liga o lembrete.
    const cfg = await this.prisma.configuracaoConferenciaDiaria.findFirst();
    if (!cfg || !cfg.ativo || !cfg.lembreteNoApp) return null;
    if (cfg.lembreteParaQuem === "SO_QUEM_SAIU" && m.receberConferenciaDiaria) return null;
    // Módulo contratado por cima do RBAC: cancelou a conferência, cala o lembrete.
    if (!(await modulosDaConta(this.prisma, m.contaId)).has("conferencia")) return null;

    const hojeData = inicioDoDiaData(agora);
    const desde = new Date(hojeData.getTime() - JANELA_VIAGENS_DIAS * 86_400_000);
    const [viagens, ultima, feriadosDb] = await Promise.all([
      // QUALQUER status conta como "lançou" (igual ao painel).
      this.prisma.viagem.findMany({
        where: { motoristaId, OR: [{ data: { gte: desde } }, { data: null }] },
        select: { data: true, iniciadoEm: true, status: true },
      }),
      this.prisma.viagem.aggregate({
        where: { motoristaId, data: { not: null } },
        _max: { data: true },
      }),
      this.prisma.feriadoPonto.findMany({
        where: {
          abrangencia: "NACIONAL",
          data: { gte: new Date(hojeData.getTime() - 70 * 86_400_000), lte: hojeData },
        },
        select: { data: true, abrangencia: true, uf: true, municipioIbge: true },
      }),
    ]);

    const feriados = new Set(
      feriadosDb
        .map((f) => ({ ...f, data: dataParaYmd(f.data) }))
        .filter((f) => feriadoAlcanca(f))
        .map((f) => f.data),
    );
    const dias: string[] = [];
    let emAndamento = false;
    for (const v of viagens) {
      if (v.status === "EM_ANDAMENTO") emAndamento = true;
      const dia = v.data ? dataParaYmd(v.data) : v.iniciadoEm ? hojeYmd(v.iniciadoEm) : null;
      if (dia) dias.push(dia);
    }
    if (ultima._max.data) dias.push(dataParaYmd(ultima._max.data));

    const entrada: MotoristaParaConferencia & { receberConferenciaDiaria: boolean } = {
      motoristaId,
      diasComViagem: dias,
      temViagemEmAndamento: emAndamento,
      cadastradoEm: hojeYmd(m.criadoEm),
      perguntasAnteriores: [],
      receberConferenciaDiaria: m.receberConferenciaDiaria,
    };
    return avaliarLembreteNoApp(
      {
        regra: cfg.regra,
        diasSemViagem: cfg.diasSemViagem,
        diasConsiderados: cfg.diasConsiderados,
        ignorarFeriados: cfg.ignorarFeriados,
        incluirQueNuncaLancou: cfg.incluirQueNuncaLancou,
        intervaloMinimoDias: cfg.intervaloMinimoDias,
        maxPerguntasPorSemana: cfg.maxPerguntasPorSemana,
      },
      cfg,
      entrada,
      feriados,
      agora,
    );
  }
}
