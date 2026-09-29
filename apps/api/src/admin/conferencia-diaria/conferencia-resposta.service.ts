import { Injectable, Logger } from "@nestjs/common";
import {
  BOTOES_CONFERENCIA_DIARIA,
  lerPayloadConferencia,
  montarMensagemAoParar,
  type OpcaoConferenciaDiaria,
} from "@ronan/shared-types";
import { PrismaService } from "../../prisma/prisma.service";
import { AuditoriaService } from "../../auditoria/auditoria.service";
import { comConta, comoSistema } from "../../common/conta/conta-context";
import {
  RESPOSTA_NAO_TIVE,
  RESPOSTA_SAI_DA_EMPRESA,
  RESPOSTA_TIVE_NAO_LANCEI,
  interpretarRespostaConferencia,
  normalizarResposta,
  sufixoTelefone,
} from "../../common/conferencia-resposta";
import { anexarTrilha } from "../../common/conferencia-trilha";
import { EnvioWhatsappService } from "../../whatsapp/envio/envio-whatsapp.service";
import { SessaoService } from "../../whatsapp/sessao.service";
import { ConferenciaAlcanceService, telefonesParaBusca } from "./conferencia-alcance.service";
import { SugestoesGestorService } from "./sugestoes-gestor.service";

/** A mensagem como a Meta entrega em `messages[]` (só o que a conferência lê). */
export type MensagemRecebida = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { payload?: string; text?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  context?: { id?: string };
};

export type ResultadoTratamento =
  | { tratada: true; opcao: OpcaoConferenciaDiaria; origem: "BOTAO" | "TEXTO" }
  | { tratada: false; motivo: string };

/** Depois disto, um texto "sim"/"1" já não é lido como resposta ao toque recente. */
const JANELA_TOQUE_MIN = 10;
/** Toque sem texto (Chatwoot pode entregar vazio): só se o toque foi casado agora há pouco. */
const JANELA_TOQUE_VAZIO_MIN = 2;
/** Um toque tardio (pergunta expirada) ainda vale por este tempo. */
const JANELA_TOQUE_TARDIO_DIAS = 3;

const ROTULOS_NORMALIZADOS = new Set(BOTOES_CONFERENCIA_DIARIA.map((b) => normalizarResposta(b.rotulo)));

function textoDaMensagem(m: MensagemRecebida): string | null {
  return (
    m.text?.body ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    m.button?.text ??
    null
  );
}

/**
 * Recebe a resposta da conferência diária e aplica o efeito.
 *
 * Regras que não mudam:
 *  - NENHUM efeito altera cadastro sozinho, EXCETO "Parar perguntas" —
 *    que é vontade do próprio motorista e só liga `receberConferenciaDiaria=false`.
 *    "Saí da empresa" vira SUGESTÃO pro gestor, nunca inativação.
 *  - O efeito roda dentro de `comConta(contaId)`; `comoSistema` só serve pra
 *    ACHAR o registro (o webhook não tem conta).
 *  - Idempotente: o mesmo toque entregue duas vezes (a Meta reenvia) não repete
 *    resposta, sugestão nem auditoria.
 *  - Nunca lança pra quem chama (o webhook responde 200 sempre).
 */
@Injectable()
export class ConferenciaRespostaService {
  private readonly log = new Logger("ConferenciaResposta");

  constructor(
    private readonly prisma: PrismaService,
    private readonly envio: EnvioWhatsappService,
    private readonly auditoria: AuditoriaService,
    private readonly sugestoes: SugestoesGestorService,
    private readonly alcance: ConferenciaAlcanceService,
  ) {}

  /** Ponto de entrada do webhook. Engole qualquer erro. */
  async tratarMensagem(msg: MensagemRecebida): Promise<ResultadoTratamento> {
    try {
      return await this.tratar(msg);
    } catch (e) {
      this.log.error(`falha ao tratar resposta da conferência: ${(e as Error).message}`);
      return { tratada: false, motivo: "erro" };
    }
  }

  private async tratar(msg: MensagemRecebida): Promise<ResultadoTratamento> {
    const from = msg.from;
    if (!from) return { tratada: false, motivo: "sem remetente" };

    // Escreveu = está vivo. Sai da suspeita de inalcançável (a Meta às vezes não
    // confirma entrega de quem responde normalmente).
    await this.alcance.aoResponder(from).catch((e) =>
      this.log.warn(`não deu pra limpar a suspeita de alcance: ${(e as Error).message}`),
    );

    const payload = msg.button?.payload ?? msg.interactive?.button_reply?.id;
    const lido = lerPayloadConferencia(payload);
    if (lido) return this.tratarToque(msg, from, lido.conferenciaId, lido.opcao);
    return this.tratarTexto(msg, from);
  }

  // ─── Toque no botão ──────────────────────────────────────────────────────

  private async tratarToque(
    msg: MensagemRecebida,
    from: string,
    conferenciaId: string,
    opcao: OpcaoConferenciaDiaria,
  ): Promise<ResultadoTratamento> {
    const conf = await comoSistema(() =>
      this.prisma.conferenciaDiaria.findUnique({
        where: { id: conferenciaId },
        select: {
          id: true,
          contaId: true,
          estado: true,
          opcao: true,
          wamid: true,
          lembreteWamid: true,
          dia: true,
          motorista: {
            select: { id: true, nome: true, telefone: true, cpf: true, identidadeId: true },
          },
        },
      }),
    );
    if (!conf) {
      this.log.warn(`toque com payload de conferência inexistente (${conferenciaId}) — ignorado`);
      return { tratada: false, motivo: "conferência não existe" };
    }

    const ctx = msg.context?.id;
    const base = {
      opcao,
      origem: "BOTAO",
      contextId: ctx ?? null,
      wamidLinha: conf.wamid,
      estadoAntes: conf.estado,
      mensagemId: msg.id ?? null,
    };
    await this.trilha(conf, "TOQUE", base);
    const ignorar = async (motivo: string): Promise<ResultadoTratamento> => {
      await this.trilha(conf, "IGNORADO", { ...base, motivo });
      return { tratada: false, motivo };
    };

    // O remetente tem que ser o motorista da pergunta: o payload é só um id, e
    // quem manda o toque é o número que escreveu.
    if (!conf.motorista.telefone || !mesmoTelefone(conf.motorista.telefone, from)) {
      this.log.warn(`toque da conferência ${conf.id} veio de número que não é do motorista — ignorado`);
      return ignorar("remetente não confere");
    }
    // Confirma pelo wamid: o toque responde À mensagem que a gente mandou (ou ao
    // lembrete). Sem `context` (alguns clientes omitem) o payload + telefone bastam.
    if (ctx && conf.wamid && ctx !== conf.wamid && ctx !== conf.lembreteWamid) {
      this.log.warn(`toque da conferência ${conf.id} respondendo a outra mensagem (${ctx}) — ignorado`);
      return ignorar("wamid não confere");
    }
    // PENDENTE: o toque chegou ANTES de o envio gravar o wamid (a Meta entrega a
    // mensagem e o motorista toca antes de o update pós-envio rodar). Não dá pra
    // conferir o `context.id` (a linha ainda não tem wamid), então o critério é:
    // payload `cv:<id>` da própria linha + telefone que confere (checado acima).
    // O `context.id` fica na trilha pra conferência posterior. Ignorar aqui deixava
    // o motorista sem resposta e sem registro nenhum.
    if (!["PENDENTE", "ENVIADA", "EXPIRADA", "RESPONDIDA"].includes(conf.estado)) {
      return ignorar(`estado ${conf.estado}`);
    }
    // Mesmo toque de novo (Meta reenviou, ou ele apertou duas vezes): nada a fazer.
    if (conf.estado === "RESPONDIDA" && conf.opcao === opcao) {
      await this.trilha(conf, "IGNORADO", { ...base, motivo: "toque repetido (já respondida com esta opção)" });
      return { tratada: true, opcao, origem: "BOTAO" };
    }

    await this.aplicar(conf, opcao, from, textoDaMensagem(msg), { ...base, criterio: conf.estado === "PENDENTE" ? "PENDENTE: payload e telefone conferem" : "wamid/contexto" });
    return { tratada: true, opcao, origem: "BOTAO" };
  }

  // ─── Texto livre ─────────────────────────────────────────────────────────

  private async tratarTexto(msg: MensagemRecebida, from: string): Promise<ResultadoTratamento> {
    const conf = await comoSistema(() =>
      this.prisma.conferenciaDiaria.findFirst({
        where: { estado: "ENVIADA", motorista: { telefone: { in: telefonesParaBusca(from) } } },
        orderBy: { enviadaEm: "desc" },
        select: {
          id: true,
          contaId: true,
          estado: true,
          opcao: true,
          wamid: true,
          lembreteWamid: true,
          dia: true,
          motorista: {
            select: { id: true, nome: true, telefone: true, cpf: true, identidadeId: true },
          },
        },
      }),
    );
    if (!conf) return { tratada: false, motivo: "sem pergunta pendente" };

    const texto = textoDaMensagem(msg);
    const opcao = interpretarRespostaConferencia(texto);
    const base = {
      opcao,
      origem: "TEXTO",
      contextId: msg.context?.id ?? null,
      wamidLinha: conf.wamid,
      estadoAntes: conf.estado,
      mensagemId: msg.id ?? null,
      texto: texto?.slice(0, 100) ?? null,
    };
    await this.trilha(conf, "TOQUE", base);
    if (opcao === "AMBIGUA") {
      await this.trilha(conf, "IGNORADO", { ...base, motivo: "resposta ambígua" });
      await comConta(conf.contaId, async () => {
        const r = await this.sugestoes.abrir({
          tipo: "RESPOSTA_AMBIGUA",
          motoristaId: conf.motorista.id,
          conferenciaId: conf.id,
          resumo: `${conf.motorista.nome} respondeu à pergunta de viagens de um jeito que o sistema não soube ler. Veja e, se precisar, fale com ele.`,
          evidencia: { tipoMensagem: msg.type ?? "?", texto: texto?.slice(0, 300) ?? null },
        });
        if (r.criada) {
          await this.sugestoes.notificar(
            "Resposta que o sistema não entendeu",
            `${conf.motorista.nome} respondeu à conferência diária com algo fora dos botões.`,
            { motoristaId: conf.motorista.id },
          );
        }
      });
      // Não é "nossa": quem responde é o atendimento normal (agente/humano).
      return { tratada: false, motivo: "resposta ambígua" };
    }

    await this.aplicar(conf, opcao, from, texto, { ...base, criterio: "texto livre: última pergunta ENVIADA do telefone" });
    return { tratada: true, opcao, origem: "TEXTO" };
  }

  // ─── Efeitos ─────────────────────────────────────────────────────────────

  private async aplicar(
    conf: ConfParaAplicar,
    opcao: OpcaoConferenciaDiaria,
    from: string,
    texto: string | null,
    base: Record<string, unknown> = {},
  ): Promise<void> {
    const agora = new Date();
    await comConta(conf.contaId, async () => {
      // A trava de idempotência: só UMA chamada muda a linha pra esta opção.
      const { count } = await this.prisma.conferenciaDiaria.updateMany({
        where: {
          id: conf.id,
          estado: { in: ["PENDENTE", "ENVIADA", "EXPIRADA", "RESPONDIDA"] },
          NOT: { estado: "RESPONDIDA", opcao },
        },
        data: {
          estado: "RESPONDIDA",
          opcao,
          respondidaEm: agora,
          respostaTexto: texto?.slice(0, 300) ?? null,
        },
      });
      await this.trilha(conf, "RESPOSTA_GRAVADA", {
        ...base,
        opcao,
        count,
        ...(count === 0 ? { motivo: "nenhuma linha mudou (já tinha esta resposta, ou o estado não permite)" } : {}),
      });
      if (count === 0) return;

      const m = conf.motorista;
      const resumoDia = conf.dia.toISOString().slice(0, 10).split("-").reverse().join("/");
      switch (opcao) {
        case "NAO_TIVE":
          await this.responder(from, RESPOSTA_NAO_TIVE);
          break;
        case "TIVE_NAO_LANCEI": {
          const r = await this.sugestoes.abrir({
            tipo: "LANCAR_VIAGEM_FALTANTE",
            motoristaId: m.id,
            conferenciaId: conf.id,
            resumo: `${m.nome} disse que teve viagem e não lançou (pergunta de ${resumoDia}). Confirme e, se preciso, lance ou peça o lançamento.`,
            evidencia: { origem: "conferencia-diaria", conferenciaId: conf.id },
          });
          if (r.criada) {
            await this.sugestoes.notificar(
              "Motorista diz que tem viagem sem lançar",
              `${m.nome} respondeu à conferência diária que teve viagem e não lançou.`,
              { motoristaId: m.id },
            );
          }
          await this.responder(from, RESPOSTA_TIVE_NAO_LANCEI);
          break;
        }
        case "SAI_DA_EMPRESA": {
          // SUGESTÃO, nunca inativação: quem decide é o gestor.
          const r = await this.sugestoes.abrir({
            tipo: "INATIVAR_VINCULO",
            motoristaId: m.id,
            conferenciaId: conf.id,
            resumo: `${m.nome} disse que saiu da empresa. Se for isso, inative o vínculo.`,
            evidencia: { origem: "conferencia-diaria", conferenciaId: conf.id },
          });
          if (r.criada) {
            await this.sugestoes.notificar(
              "Motorista diz que saiu da empresa",
              `${m.nome} respondeu à conferência diária que saiu da empresa. Confirme pra inativar o vínculo.`,
              { motoristaId: m.id },
            );
          }
          await this.responder(from, RESPOSTA_SAI_DA_EMPRESA);
          break;
        }
        case "PARAR":
          await this.pararPerguntas(conf, from);
          break;
        case "AMBIGUA":
          break;
      }
    });
  }

  private trilha(
    conf: { id: string; contaId: string },
    evento: "TOQUE" | "IGNORADO" | "RESPOSTA_GRAVADA",
    detalhe: Record<string, unknown>,
  ): Promise<void> {
    return anexarTrilha(this.prisma, conf, evento, detalhe);
  }

  private async responder(from: string, texto: string): Promise<void> {
    // O sistema NUNCA lança aqui: a resposta é cortesia, o efeito já está gravado.
    await this.envio
      .tentarEnviar({
        destino: { tipo: "TELEFONE", numero: SessaoService.normalizar(from) },
        rota: "RESPOSTA_AGENTE",
        texto,
      })
      .catch((e) => this.log.warn(`resposta da conferência não saiu: ${(e as Error).message}`));
  }

  /**
   * "Parar perguntas": vontade do PRÓPRIO motorista, por isso é o único
   * efeito que muda cadastro sozinho — e só `receberConferenciaDiaria`. Não toca
   * `aceitaWhatsapp` (OTP e aviso de peso seguem valendo).
   *
   * Vale em TODOS os vínculos da mesma pessoa (mesma identidade, mesmo CPF ou
   * mesmo telefone pelos 8 últimos dígitos), e CADA empresa afetada fica sabendo:
   * sugestão + sino + auditoria por vínculo.
   */
  private async pararPerguntas(conf: ConfParaAplicar, from: string): Promise<void> {
    const m0 = conf.motorista;
    const sufixo = sufixoTelefone(m0.telefone ?? from);
    const vinculos = await comoSistema(() =>
      this.prisma.motorista.findMany({
        where: {
          OR: [
            ...(m0.identidadeId ? [{ identidadeId: m0.identidadeId }] : []),
            { cpf: m0.cpf },
            ...(sufixo.length === 8 ? [{ telefone: { endsWith: sufixo } }] : []),
          ],
        },
        select: {
          id: true,
          contaId: true,
          nome: true,
          receberConferenciaDiaria: true,
          conferenciaDesligadaOrigem: true,
          conta: { select: { nome: true } },
        },
      }),
    );

    const orientacao: { texto: string | null } = { texto: null };
    for (const v of vinculos) {
      await comConta(v.contaId, async () => {
        const mudou = v.receberConferenciaDiaria;
        // Se a empresa tinha desligado pelo painel e o motorista pede parar, o registro
        // passa a ser DELE (religar de novo exige motivo). Limpa quem/motivo do painel.
        if (mudou || v.conferenciaDesligadaOrigem === "PAINEL") {
          await this.prisma.motorista.update({
            where: { id: v.id },
            data: {
              receberConferenciaDiaria: false,
              conferenciaDesligadaEm: new Date(),
              conferenciaDesligadaOrigem: "MOTORISTA",
              conferenciaDesligadaPorId: null,
              conferenciaDesligadaMotivo: null,
            },
          });
        }
        // Pergunta que ainda esperava resposta neste vínculo deixa de esperar.
        await this.prisma.conferenciaDiaria.updateMany({
          where: { motoristaId: v.id, estado: "ENVIADA", NOT: { id: conf.id } },
          data: { estado: "RESPONDIDA", opcao: "PARAR", respondidaEm: new Date() },
        });
        if (mudou || v.id === m0.id) {
          await this.auditoria.log({
            usuarioId: null,
            entidade: "Motorista",
            entidadeId: v.id,
            acao: "CONFERENCIA_OPTOUT",
            campo: "receberConferenciaDiaria",
            valorAntes: mudou,
            valorDepois: false,
            motivo: 'O motorista tocou em "Parar perguntas" no WhatsApp.',
            metadata: { conferenciaId: conf.id, origem: "whatsapp" },
          });
        }
        const s = await this.sugestoes.abrir({
          tipo: "MOTORISTA_PAROU_WHATSAPP",
          motoristaId: v.id,
          conferenciaId: v.id === m0.id ? conf.id : null,
          resumo: `${v.nome} pediu pra parar de receber a pergunta de viagens no WhatsApp. Se ele continuar sem lançar, contate por outro meio.`,
          evidencia: { origem: "conferencia-diaria", vinculosAfetados: vinculos.length },
        });
        if (s.criada) {
          await this.sugestoes.notificar(
            "Motorista parou de receber a conferência",
            `${v.nome} pediu pra parar de receber a pergunta de viagens no WhatsApp.`,
            { motoristaId: v.id },
          );
        }
        if (v.id === m0.id) {
          const cfg = await this.prisma.configuracaoConferenciaDiaria.findFirst({
            select: { mensagemAoParar: true, contatoEmpresa: true },
          });
          orientacao.texto = montarMensagemAoParar(cfg?.mensagemAoParar, v.conta.nome, cfg?.contatoEmpresa);
        }
      });
    }
    // Orientação sai UMA vez, com o texto da empresa em que ele tocou o botão.
    if (orientacao.texto) await this.responder(from, orientacao.texto);
  }

  // ─── Guarda contra a resposta duplicada do Chatwoot/agente ──────────────

  /**
   * Esta mensagem que chegou no Chatwoot é a resposta a uma pergunta da
   * conferência (e portanto já é tratada aqui)?
   *
   * O toque também chega ao Chatwoot (o repasse manda o corpo inteiro), que o
   * entrega ao agente como texto — e o agente responderia por cima da resposta
   * daqui. Esta é a checagem que o agente faz ANTES de responder. Não depende da
   * ordem de chegada (Meta→nós vs Meta→Chatwoot→nós): olha o ESTADO da pergunta.
   *
   *  - pergunta ENVIADA + texto que o interpretador reconhece → é nossa (mesmo se
   *    o webhook ainda não processou);
   *  - pergunta RESPONDIDA há poucos minutos + texto reconhecido → é nossa;
   *  - pergunta EXPIRADA (toque tardio) só com o RÓTULO exato de um botão;
   *  - texto vazio (toque sem conteúdo) só logo depois de um toque casado.
   * Texto ambíguo NUNCA é engolido: o agente responde normalmente.
   */
  async respostaJaTratada(telefone: string, texto: string | null | undefined): Promise<boolean> {
    try {
      const agora = Date.now();
      const telefones = telefonesParaBusca(telefone);
      const vazio = !texto?.trim();
      const opcao = vazio ? "AMBIGUA" : interpretarRespostaConferencia(texto);
      const ehRotulo = !vazio && ROTULOS_NORMALIZADOS.has(normalizarResposta(texto!));
      if (!vazio && opcao === "AMBIGUA" && !ehRotulo) return false;

      const linhas = await comoSistema(() =>
        this.prisma.conferenciaDiaria.findMany({
          where: {
            motorista: { telefone: { in: telefones } },
            OR: [
              { estado: "ENVIADA" },
              { estado: "RESPONDIDA", respondidaEm: { gte: new Date(agora - JANELA_TOQUE_MIN * 60_000) } },
              {
                estado: "EXPIRADA",
                enviadaEm: { gte: new Date(agora - JANELA_TOQUE_TARDIO_DIAS * 86_400_000) },
              },
            ],
          },
          select: { estado: true, respondidaEm: true },
        }),
      );
      if (linhas.length === 0) return false;
      if (vazio) {
        const corte = agora - JANELA_TOQUE_VAZIO_MIN * 60_000;
        return linhas.some((l) => l.estado === "RESPONDIDA" && (l.respondidaEm?.getTime() ?? 0) >= corte);
      }
      return linhas.some((l) => (l.estado === "EXPIRADA" ? ehRotulo : true));
    } catch (e) {
      // Na dúvida, o agente responde (o pior caso é uma resposta a mais, nunca um silêncio).
      this.log.warn(`não deu pra checar a conferência antes do agente: ${(e as Error).message}`);
      return false;
    }
  }
}

type ConfParaAplicar = {
  id: string;
  contaId: string;
  dia: Date;
  motorista: { id: string; nome: string; telefone: string | null; cpf: string; identidadeId: string | null };
};

/** Mesmo celular, com ou sem DDI e com ou sem o nono dígito. */
export function mesmoTelefone(a: string, b: string): boolean {
  const va = new Set(SessaoService.variantes(a));
  return SessaoService.variantes(b).some((x) => va.has(x));
}
