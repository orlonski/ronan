import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Prisma, StatusConferenciaTicket, type ConferenciaTicket } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { ConferenciaFilaService } from "./conferencia-fila.service";
import { ConferenciaConfig } from "./conferencia.config";
import { LeitorTicketService } from "./leitor-ticket.service";
import { AplicarVereditoService } from "./aplicar-veredito.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import {
  conferirComJulgamento,
  precisaSegundaOpiniao,
  type Declarado,
  type ResultadoConferencia,
} from "../common/conferencia-ticket";

/** Erro que MERECE retentativa: rede, storage fora do ar, 5xx. */
class FalhaInfra extends Error {}
/** Fim de linha sem julgamento — e sem retentativa. */
class Descartar extends Error {}

/**
 * Consome a fila de conferência: lê a foto do storage, manda pro modelo,
 * compara com o que o motorista declarou e aplica o veredito.
 *
 * Roda no processo da API, como os outros crons. O motivo que justificou
 * separar o `ronan_agente` num container próprio — dar a ele a capacidade de
 * executar código e escrever no repositório — não existe aqui: isto é uma
 * chamada HTTP e uma escrita no banco. O módulo é partido do mesmo jeito
 * (`ConferenciaTicketModule` sem worker, `...WorkerModule` com), então mover
 * pra processo próprio depois é trocar o entrypoint, não reescrever.
 */
@Injectable()
export class ConferenciaWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("ConferenciaTicket");
  private readonly workerId = `conferente@${hostname()}#${randomUUID().slice(0, 8)}`;
  private emVoo = 0;
  private tickRodando = false;
  private laco?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: ConferenciaFilaService,
    private readonly config: ConferenciaConfig,
    private readonly uploads: UploadsService,
    private readonly leitor: LeitorTicketService,
    private readonly aplicar: AplicarVereditoService,
  ) {}

  onModuleInit(): void {
    this.config.descreverNoBoot();
    if (!this.config.habilitado) return;
    this.laco = setInterval(() => void this.tick(), this.config.intervaloMs);
    // Não segura o processo: aqui existe servidor HTTP, diferente do worker do
    // agente, então o timer pode ser unref.
    this.laco.unref?.();
  }

  onModuleDestroy(): void {
    if (this.laco) clearInterval(this.laco);
  }

  async tick(): Promise<void> {
    if (!this.config.habilitado || this.tickRodando) return;
    if (!this.leitor.disponivel) return;
    this.tickRodando = true;
    try {
      await this.fila.recuperarPresas();

      const vagas = this.config.concorrencia - this.emVoo;
      const jobs = await this.fila.reivindicar(this.workerId, vagas);

      for (const job of jobs) {
        this.emVoo++;
        // `comConta` dá o await por dentro, então as consultas do Prisma saem
        // DENTRO do contexto da empresa dona do job. O `.finally` roda fora e
        // só mexe num contador.
        void comConta(job.contaId, () => this.processar(job)).finally(() => {
          this.emVoo--;
        });
      }
    } catch (err) {
      this.log.error(`tick falhou: ${(err as Error).message}`);
    } finally {
      this.tickRodando = false;
    }
  }

  private async processar(job: ConferenciaTicket): Promise<void> {
    try {
      const resultado = await Promise.race([
        this.conferir(job),
        this.estourarEm(this.config.timeoutMs),
      ]);
      if (resultado) await this.aplicar.aplicar(job, resultado, this.config.modoSombra);
    } catch (err) {
      if (err instanceof Descartar) {
        await this.fila.finalizar(job, {
          status: StatusConferenciaTicket.DESCARTADA,
          erro: err.message,
        });
        this.log.debug(`Conferência ${job.id} descartada: ${err.message}`);
        return;
      }

      const infra = err instanceof FalhaInfra;
      if (infra && job.tentativas + 1 < this.config.tentativasMax) {
        await this.fila.reagendar(job, (err as Error).message);
        return;
      }

      await this.fila.finalizar(job, {
        status: StatusConferenciaTicket.FALHOU,
        erro: (err as Error).message.slice(0, 2_000),
      });
      this.log.warn(`Conferência ${job.id} falhou: ${(err as Error).message}`);
    }
  }

  /** Teto duro de tempo, pra um job travado não segurar uma vaga pra sempre. */
  private estourarEm(ms: number): Promise<never> {
    return new Promise((_, rej) => {
      const t = setTimeout(() => rej(new FalhaInfra(`passou de ${Math.round(ms / 1000)}s`)), ms);
      t.unref?.();
    });
  }

  private async conferir(job: ConferenciaTicket): Promise<{
    resultado: ResultadoConferencia;
    leitura: unknown;
    custoUsd: number;
    modelo: string;
    passadas: number;
    escalou: boolean;
  }> {
    // Relê a viagem AGORA: entre enfileirar e processar, o painel pode ter
    // corrigido o valor, ou um humano pode ter decidido. Robô não passa por
    // cima de gente, e não acusa divergência contra número que já mudou.
    const viagem = await this.prisma.viagem.findUnique({
      where: { id: job.viagemId },
      select: {
        revisadoEm: true,
        status: true,
        ticket: true,
        toneladas: true,
        _count: { select: { matchesFechamento: true } },
      },
    });
    if (!viagem) throw new Descartar("viagem não existe mais");
    if (viagem.revisadoEm) throw new Descartar("um humano conferiu antes");
    if (viagem._count.matchesFechamento > 0) throw new Descartar("viagem já entrou em fechamento");

    const declarado = job.declarado as unknown as Declarado;
    const mudou =
      (declarado.ticket ?? null) !== (viagem.ticket ?? null) ||
      Number(declarado.toneladas ?? 0) !== Number(viagem.toneladas ?? 0);
    if (mudou) throw new Descartar("o lançamento mudou depois que a conferência entrou na fila");

    // Foto do storage. 404 é fim de linha, não falha de infra: retentar uma
    // chave purgada é queimar 15 minutos de fila à toa.
    let buffer: Buffer;
    try {
      buffer = await this.uploads.getObjectBuffer(job.storageKey);
    } catch (err) {
      const msg = (err as Error).message;
      if (/not ?found|nosuchkey|404/i.test(msg)) throw new Descartar("a foto não está mais no storage");
      throw new FalhaInfra(`storage: ${msg}`);
    }

    const mime = job.storageKey.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const fotoBase64 = buffer.toString("base64");
    // Cliente e material vão junto: é sobre eles que o modelo precisa julgar
    // se "BRONZE PAVIMENTAÇÕES LTDA" e "Construtora Bronze" são a mesma
    // empresa. Sem mandar, ele não teria contra o que comparar.
    const paraOModelo = {
      numeroDocumento: declarado.ticket,
      toneladas: declarado.toneladas,
      data: declarado.data ? String(declarado.data).slice(0, 10) : null,
      placa: declarado.placa,
      cliente: declarado.clienteNome,
      material: declarado.materialNome,
    };

    let primeira;
    try {
      primeira = await this.leitor.ler({ fotoBase64, mime, declarado: paraOModelo });
    } catch (err) {
      throw new FalhaInfra(`leitura: ${(err as Error).message}`);
    }

    // Resposta que não parseou é defeito de execução, não resultado: retenta.
    // Antes isso virava "leitura 0%" e ia parar na fila de revisão junto com
    // foto borrada — dois problemas diferentes no mesmo balde, e nenhum dos
    // dois resolvido.
    if (primeira.falha === "resposta-invalida") {
      throw new FalhaInfra("o modelo respondeu fora do formato pedido");
    }

    if (!primeira.legivel) {
      return {
        resultado: {
          // Foto que não dá pra ler tem desfecho próprio: quem resolve é o
          // motorista mandando outra, não um conferente olhando a mesma foto
          // ruim de novo.
          veredito: "ILEGIVEL",
          divergencias: [],
          incertezas: [],
          conferidos: [],
        },
        leitura: { ...primeira.lido, julgamento: primeira.julgamento },
        custoUsd: primeira.custoUsd,
        modelo: primeira.modelo,
        passadas: 1,
        escalou: false,
      };
    }

    let resultado = conferirComJulgamento(declarado, primeira.lido, primeira.julgamento);
    let custo = primeira.custoUsd;
    let modelo = primeira.modelo;
    let passadas = 1;
    let escalou = false;

    // Segunda opinião: só quando o dinheiro está em jogo ou a leitura foi
    // fraca — e só se ainda houver cota na hora. Custa ~5x a primeira.
    if (
      this.config.modeloSegundaOpiniao &&
      precisaSegundaOpiniao(resultado, primeira.lido.confianca) &&
      (await this.temCotaDeEscalada())
    ) {
      try {
        const segunda = await this.leitor.ler({
          fotoBase64,
          mime,
          declarado: paraOModelo,
          modelo: this.config.modeloSegundaOpiniao,
        });
        custo += segunda.custoUsd;
        modelo = segunda.modelo;
        passadas = 2;
        escalou = true;

        const rSegunda = conferirComJulgamento(declarado, segunda.lido, segunda.julgamento);
        // Discordaram? Então nenhuma das duas é confiável o bastante pra
        // incomodar o motorista: humano decide.
        resultado =
          rSegunda.veredito === resultado.veredito
            ? rSegunda
            : { ...rSegunda, veredito: "INCERTO" };
      } catch (err) {
        // Falhar na segunda não invalida a primeira — só não escala.
        this.log.warn(`Segunda opinião falhou: ${(err as Error).message}`);
      }
    }

    // O julgamento vai junto: é o que permite recomparar depois sem pagar
    // leitura de novo.
    return {
      resultado,
      leitura: { ...primeira.lido, julgamento: primeira.julgamento },
      custoUsd: custo,
      modelo,
      passadas,
      escalou,
    };
  }

  private async temCotaDeEscalada(): Promise<boolean> {
    const teto = this.config.maxSegundaOpiniaoPorHora;
    if (teto <= 0) return false;
    const usadas = await this.fila.contarEscaladasNaHora();
    if (usadas >= teto) {
      this.log.warn(`Teto de segundas opiniões por hora atingido (${usadas}/${teto}).`);
      return false;
    }
    return true;
  }

  /** Diagnóstico: quantos jobs estão vivos agora, em toda a plataforma. */
  async pendentes(): Promise<number> {
    return comoSistema(() =>
      this.prisma.conferenciaTicket.count({
        where: { status: { in: ["PENDENTE", "EXECUTANDO"] } },
      }),
    );
  }
}

/** Só pra tipagem do update parcial no aplicar. */
export type DadosFinalizacao = Prisma.ConferenciaTicketUpdateInput;
