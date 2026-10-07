import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { comGatilho } from "../common/chamadas-externas/interceptor";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { Prisma, StatusConferenciaTicket, type ConferenciaTicket } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UploadsService } from "../uploads/uploads.service";
import { ConferenciaFilaService } from "./conferencia-fila.service";
import { ConferenciaConfig } from "./conferencia.config";
import { LeitorTicketService } from "./leitor-ticket.service";
import { VinculosNomeService } from "./vinculos-nome.service";
import { ORIGEM_AUDITORIA_CEGA } from "./auditoria-cega.service";
import { AplicarVereditoService } from "./aplicar-veredito.service";
import { comConta, comoSistema } from "../common/conta/conta-context";
import { CachePorConta } from "../common/conta/cache-por-conta";
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
 * Não é falha: a viagem vai divergir e a segunda leitura (que confirma antes
 * de avisar o motorista) está sem cota nesta hora. Volta pra fila mais tarde
 * sem gastar tentativa — avisar sem confirmar é o que não pode.
 */
class Adiar extends Error {}

/** Quanto esperar a cota de segunda leitura abrir de novo. */
const ADIAR_SEM_COTA_MS = 20 * 60_000;

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

  /**
   * Qual modelo lê o ticket desta empresa.
   *
   * Por conta, e não global, porque é assim que se avalia um fornecedor novo
   * sem apostar a plataforma inteira: liga numa empresa, olha os vereditos e o
   * custo na tela de Conferência por alguns dias, e volta num clique. Cache
   * curto — o job dura segundos, e a troca no painel precisa valer rápido.
   */
  private readonly modeloCache = new CachePorConta<string | null>(
    "ConfiguracaoIa.modeloConferencia",
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly fila: ConferenciaFilaService,
    private readonly config: ConferenciaConfig,
    private readonly uploads: UploadsService,
    private readonly leitor: LeitorTicketService,
    private readonly aplicar: AplicarVereditoService,
    private readonly vinculos: VinculosNomeService,
  ) {}

  onModuleInit(): void {
    this.config.descreverNoBoot();
    if (!this.config.habilitado) return;
    // Rótulo na tela "Chamadas externas": a IA e as fotos que o worker pede.
    this.laco = setInterval(() => void comGatilho("fila:conferencia-ticket", () => this.tick()), this.config.intervaloMs);
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
      // Segunda chance pro que caiu por queda de conexão: as 3 tentativas
      // normais cabem em 4 minutos e não cobrem uma instabilidade maior.
      await this.fila.ressuscitarFalhasDeInfra(this.config.ressuscitarAposMs);

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
      // A auditoria às cegas só registra: a viagem já foi decidida (e pode já
      // estar faturada), e quem age sobre o que ela achar é gente.
      const soRegistra = this.config.modoSombra || job.origem === ORIGEM_AUDITORIA_CEGA;
      if (resultado) await this.aplicar.aplicar(job, resultado, soRegistra);
    } catch (err) {
      if (err instanceof Adiar) {
        await this.fila.adiar(job, err.message, ADIAR_SEM_COTA_MS);
        this.log.log(`Conferência ${job.id} adiada: ${err.message}`);
        return;
      }

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
    // A auditoria às cegas existe justamente pra reler o que já foi decidido
    // (inclusive pela IA) e o que já entrou em fechamento — e ela nunca age.
    const auditoria = job.origem === ORIGEM_AUDITORIA_CEGA;
    if (viagem.revisadoEm && !auditoria) throw new Descartar("um humano conferiu antes");
    if (viagem._count.matchesFechamento > 0 && !auditoria) {
      throw new Descartar("viagem já entrou em fechamento");
    }

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
    // Isto vai SÓ pra etapa de julgamento (texto), nunca junto da foto: o
    // leitor transcreve o papel às cegas e só depois compara — ver o topo de
    // `leitor-ticket.service.ts`.
    const paraOModelo = {
      numeroDocumento: declarado.ticket,
      toneladas: declarado.toneladas,
      data: declarado.data ? String(declarado.data).slice(0, 10) : null,
      placa: declarado.placa,
      cliente: declarado.clienteNome,
      material: declarado.materialNome,
    };

    const modeloSegunda = await this.modeloSegundaDaConta();

    let primeira;
    try {
      primeira = await this.leitor.ler({
        fotoBase64,
        mime,
        declarado: paraOModelo,
        modelo: await this.modeloDaConta(),
      });
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

    // Nada lido não é o mesmo que foto ruim.
    //
    // Um modelo pequeno erra em foto perfeitamente legível — e antes deste
    // trecho o código desistia aqui, declarava ILEGIVEL e ia pedir foto nova ao
    // motorista por uma limitação NOSSA. Custa uma leitura descobrir de quem é
    // a culpa, e essa leitura é muito mais barata que mandar um motorista
    // parar o caminhão pra fotografar de novo um papel que já estava bom.
    const naoLeuNada =
      !primeira.legivel ||
      (primeira.lido.confianca <= 0 &&
        !primeira.lido.ticket &&
        primeira.lido.toneladas == null);

    if (naoLeuNada && modeloSegunda && (await this.temCotaDeEscalada())) {
      try {
        const forte = await this.leitor.ler({
          fotoBase64,
          mime,
          declarado: paraOModelo,
          modelo: modeloSegunda,
        });
        const custoAte = primeira.custoUsd + forte.custoUsd;

        if (forte.legivel && forte.lido.confianca > 0) {
          // Era limitação do modelo pequeno, não da foto. Segue o fluxo normal
          // com a leitura boa — e ninguém precisa ser incomodado.
          const r = conferirComJulgamento(
            declarado,
            forte.lido,
            forte.julgamento,
            await this.vinculos.contexto(job.viagemId, forte.lido),
          );
          return {
            resultado: r,
            leitura: { ...forte.lido, julgamento: forte.julgamento },
            custoUsd: custoAte,
            modelo: forte.modelo,
            passadas: 2,
            escalou: true,
          };
        }

        // Os dois falharam: aí sim o problema é a foto.
        return {
          resultado: { veredito: "ILEGIVEL", divergencias: [], incertezas: [], conferidos: [] },
          leitura: { ...forte.lido, julgamento: forte.julgamento },
          custoUsd: custoAte,
          modelo: forte.modelo,
          passadas: 2,
          escalou: true,
        };
      } catch (err) {
        this.log.warn(`Releitura no modelo forte falhou: ${(err as Error).message}`);
      }
    }

    if (naoLeuNada) {
      return {
        resultado: {
          // Sem cota de releitura (ou com ela falhando), fica ILEGIVEL — mas
          // isso agora é exceção, não o caminho padrão.
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

    let resultado = conferirComJulgamento(
      declarado,
      primeira.lido,
      primeira.julgamento,
      await this.vinculos.contexto(job.viagemId, primeira.lido),
    );
    let custo = primeira.custoUsd;
    let modelo = primeira.modelo;
    let passadas = 1;
    let escalou = false;

    // Segunda opinião: quando o dinheiro está em jogo, a leitura foi fraca ou
    // o motorista vai ser avisado — e só se ainda houver cota na hora. Custa
    // ~5x a primeira.
    // Teto zero é "segunda leitura desligada", não "sem cota agora" — senão a
    // divergência ficaria adiada pra sempre.
    const querSegunda =
      !!modeloSegunda &&
      this.config.maxSegundaOpiniaoPorHora > 0 &&
      precisaSegundaOpiniao(resultado, primeira.lido.confianca);
    const temCota = querSegunda && (await this.temCotaDeEscalada());
    // Sem cota, a divergência espera: ela chegaria ao motorista sem a leitura
    // que confirma. Os outros vereditos seguem — nenhum deles incomoda ninguém.
    if (querSegunda && !temCota && resultado.veredito === "DIVERGE") {
      throw new Adiar("divergência esperando cota de segunda leitura");
    }
    if (querSegunda && temCota) {
      try {
        const segunda = await this.leitor.ler({
          fotoBase64,
          mime,
          declarado: paraOModelo,
          modelo: modeloSegunda,
        });
        custo += segunda.custoUsd;
        modelo = segunda.modelo;
        passadas = 2;
        escalou = true;

        const rSegunda = conferirComJulgamento(
          declarado,
          segunda.lido,
          segunda.julgamento,
          await this.vinculos.contexto(job.viagemId, segunda.lido),
        );
        // Discordaram? Então nenhuma das duas é confiável o bastante pra
        // incomodar o motorista: humano decide.
        resultado =
          rSegunda.veredito === resultado.veredito
            ? rSegunda
            : { ...rSegunda, veredito: "INCERTO" };
      } catch (err) {
        // Divergência sem a confirmação não vai pro motorista: tenta de novo.
        if (resultado.veredito === "DIVERGE") {
          throw new FalhaInfra(`segunda opinião: ${(err as Error).message}`);
        }
        // Nos outros vereditos, falhar na segunda não invalida a primeira.
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

  /**
   * O modelo da SEGUNDA leitura: o que a empresa escolheu, quando escolheu;
   * senão o `CONFERENCIA_MODELO_2A_OPINIAO`, se configurado; senão o mesmo da
   * primeira leitura.
   *
   * Decisão do dono em 29/09/2026: quem escolheu MiniMax não usa Anthropic.
   * A segunda leitura presa ao Claude fazia a conferência da Schaba depender
   * de uma conta que ela não escolheu — e quando o crédito de lá acabou, toda
   * divergência parou. Duas leituras do mesmo modelo ainda são uma
   * confirmação: discordaram, quem decide é gente.
   */
  private async modeloSegundaDaConta(): Promise<string> {
    const escolhido = await this.modeloCache.obter(async (contaId) => {
      const cfg = await this.prisma.configuracaoIa.findUnique({
        where: { contaId },
        select: { modeloConferencia: true },
      });
      return cfg?.modeloConferencia?.trim() || null;
    }, null);
    if (escolhido) return escolhido;
    // Configurado de propósito no ambiente (vazio = segunda leitura desligada).
    const doAmbiente = this.config.modeloSegundaOpiniaoExplicito;
    if (doAmbiente !== null) return doAmbiente;
    // Sem nada: o mesmo modelo da primeira leitura — que já inclui o padrão do
    // servidor (`CONFERENCIA_MODELO`). A Schaba lê pelo MiniMax por ele, não
    // por escolha na tela, e a segunda caía no Claude.
    return this.modeloDaConta();
  }

  /**
   * O modelo da primeira passada: escolha da empresa, senão o do ambiente.
   *
   * A segunda leitura segue a mesma escolha quando a empresa escolheu (ver
   * `modeloSegundaDaConta`); sem escolha, primeira no padrão barato e segunda
   * no Claude forte do ambiente.
   */
  private async modeloDaConta(): Promise<string> {
    const escolhido = await this.modeloCache.obter(async (contaId) => {
      const cfg = await this.prisma.configuracaoIa.findUnique({
        where: { contaId },
        select: { modeloConferencia: true },
      });
      return cfg?.modeloConferencia?.trim() || null;
    }, null);
    return escolhido || this.config.modeloPadrao;
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
