/**
 * Conversas INTEIRAS pelo fluxo de verdade — regras fixas, modelo, repasse,
 * pausa — sem Chatwoot e sem WhatsApp.
 *
 *   DATABASE_URL=<banco de teste> pnpm simular:atendimento [saida.md] [filtro]
 *
 * Existe porque o `testar:sdr` chama só o modelo, e os defeitos que o dono
 * achou testando no celular (28/09) estavam na camada ANTES dele: "não quero
 * falar com o Fernando" virando repasse pro Fernando, "depois posso pedir pra
 * me ligar?" virando repasse calado. Aqui cada cenário passa pelo
 * `ChatwootAgenteService` inteiro.
 *
 * **Nada sai daqui.** O cliente do Chatwoot e o envio de WhatsApp são
 * trocados por versões que só anotam — o `.env` local pode apontar pra
 * produção, e um simulador que manda mensagem de verdade é um incidente.
 *
 * Rode SEMPRE contra um banco descartável: cada cenário cria um lead.
 */
import { writeFileSync } from "node:fs";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { comoSistema } from "../common/conta/conta-context";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { ConfigService } from "@nestjs/config";
import { TesteGuiadoService } from "../chatwoot/teste-guiado.service";
import { ChatwootAgenteService } from "../chatwoot/chatwoot-agente.service";
import { ChatwootClientService } from "../chatwoot/chatwoot-client.service";
import { EnvioWhatsappService } from "../whatsapp/envio/envio-whatsapp.service";
import type { AgenteService } from "../whatsapp/agente/agente.service";
import type { ConviteService } from "../whatsapp/convite.service";
import { SessaoService } from "../whatsapp/sessao.service";
import { AdminInboxModule } from "../admin/inbox/inbox.module";
import { SdrModule } from "../sdr/sdr.module";
import { SdrService } from "../sdr/sdr.service";
import { AtendimentoHumanoService } from "../sdr/atendimento-humano.service";
import { ProspeccaoModule } from "../prospeccao/prospeccao.module";
import { ProspeccaoService } from "../prospeccao/prospeccao.service";
import { LeadChatwootService } from "../prospeccao/lead-chatwoot.service";
import { frotaInformada } from "../sdr/sdr.service";
import { ehAbertura, ehCaminhos, ehTestePasso1, ehTestePasso2 } from "../sdr/roteiro-comercial";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AdminInboxModule,
    ProspeccaoModule,
    SdrModule,
  ],
})
class SimuladorModule {}

type Passo =
  | { cliente: string }
  | { audio: true }
  | { equipe: string }
  | { nota: string }
  | { atribuir: true }
  | { etiquetar: string }
  | { resolver: true }
  | { devolverAoRobo: true }
  /** O lead cria a conta de teste com o mesmo telefone, e o cron do teste guiado roda. */
  | { contaCriada: true };

export type Cenario = {
  nome: string;
  canal: "comercial" | "operacao";
  /** De onde saiu: "real" = conversa do Chatwoot; "adversarial" = feito pra quebrar. */
  origem: "real" | "adversarial" | "teste-do-dono" | "qa";
  passos: Passo[];
  /**
   * O que TEM que acontecer. Conferido no fim — a QA de 28/09 cobrou que o
   * simulador só imprimia, e transcrição boa de ler não é prova de nada.
   */
  espera?: {
    /** Quantas vezes passou pra gente. */
    repasses?: number;
    /** Quantos alertas comerciais saíram. */
    alertas?: number;
    /** A ÚLTIMA mensagem do cliente tem que ficar sem resposta (ou ter). */
    ultimaSemResposta?: boolean;
    /** Opt-out gravado no fim. */
    optOut?: boolean;
    /** Robô ativo (true) ou fora da conversa (false) no fim. */
    roboAtivo?: boolean;
    /** Algum texto do robô tem que conter isto. */
    contem?: string;
    /** A ÚLTIMA fala do robô tem que conter isto. */
    ultimaContem?: string;
  };
};

const INBOX = { comercial: 2, operacao: 1 };

/** O que um Chatwoot falso precisa lembrar. */
class ChatwootFalso {
  private proximoId = 900_000;
  readonly eventos = new Map<number, string[]>();
  private readonly etiquetas = new Map<number, Set<string>>();
  private readonly nossos = new Set<number>();
  /**
   * O que o Chatwoot de verdade devolve pelo webhook depois de cada ação
   * nossa: o eco da mensagem do robô (com a marca) e os gestos do repasse.
   * Sem isso o simulador não testa o robô "se assustando" com o próprio gesto.
   */
  readonly ecos: Record<string, unknown>[] = [];
  repasses = 0;

  private anotarEvento(conversa: number, linha: string) {
    const l = this.eventos.get(conversa) ?? [];
    l.push(linha);
    this.eventos.set(conversa, l);
  }

  configurado() {
    return true;
  }
  linkDaConversa() {
    return null;
  }
  private eco(conversa: number, id: number, texto: string, privada: boolean) {
    this.ecos.push({
      event: "message_created",
      message_type: "outgoing",
      id,
      private: privada,
      content: texto,
      content_attributes: { movatruck_robo: true },
      conversation: { id: conversa },
      account: { id: 1 },
      sender: { name: "Diego Davi Orlonski", type: "user" },
    });
  }
  async responder(_c: number, conversa: number, texto: string) {
    const id = this.proximoId++;
    this.nossos.add(id);
    this.anotarEvento(conversa, `ROBÔ: ${texto}`);
    this.eco(conversa, id, texto, false);
    return true;
  }
  async anotar(_c: number, conversa: number, texto: string) {
    const id = this.proximoId++;
    this.nossos.add(id);
    this.anotarEvento(conversa, `(nota interna do robô: ${texto})`);
    this.eco(conversa, id, texto, true);
    return true;
  }
  foiORobo(m: { id?: number; content_attributes?: Record<string, unknown> }) {
    if (m.content_attributes?.movatruck_robo) return true;
    return typeof m.id === "number" && this.nossos.has(m.id);
  }
  async passarParaHumano(_c: number, conversa: number, time?: number | null, extras: string[] = []) {
    this.repasses++;
    const e = this.etiquetas.get(conversa) ?? new Set<string>();
    ["precisa-humano", ...extras].forEach((x) => e.add(x));
    this.etiquetas.set(conversa, e);
    this.anotarEvento(conversa, `[repasse pra gente · time ${time ?? "nenhum"} · etiquetas ${[...e].join(",")}]`);
    this.ecos.push({
      event: "conversation_updated",
      id: conversa,
      changed_attributes: [
        { label_list: { previous_value: [], current_value: [...e] } },
        ...(time ? [{ team_id: { previous_value: null, current_value: time } }] : []),
      ],
    });
  }
  async temEtiqueta(_c: number, conversa: number, etiqueta: string) {
    return this.etiquetas.get(conversa)?.has(etiqueta) ?? false;
  }
  async atribuirAoTime() {
    return true;
  }
  async atualizarContato() {
    return true;
  }
  async contaPadrao() {
    return 1;
  }
  async inboxPadrao() {
    return 2;
  }
  async listarTimes() {
    return [];
  }
}

async function main() {
  // O inbox comercial do cenário é o 2, como em produção — sem depender do
  // .env local ter a variável.
  process.env.CHATWOOT_INBOX_COMERCIAL = String(INBOX.comercial);
  const [saida = "transcricoes.md", filtro = ""] = process.argv.slice(2);
  const { CENARIOS } = await import("./simular-atendimento.cenarios");

  const chatwoot = new ChatwootFalso();
  const alertas: string[] = [];
  const modulo = await Test.createTestingModule({ imports: [SimuladorModule] })
    .overrideProvider(ChatwootClientService)
    .useValue(chatwoot)
    .overrideProvider(EnvioWhatsappService)
    .useValue({
      tentarEnviar: async (e: { rota: string; params?: string[] }) => {
        alertas.push(`${e.rota}: ${(e.params ?? []).join(" | ")}`);
        return { enviado: true, provedor: "meta", idExterno: null };
      },
      enviarOuFalhar: async () => {
        throw new Error("o simulador não envia nada");
      },
      disponivel: async () => ({ ok: true }),
    })
    .compile();
  modulo.useLogger(["error"]);
  await modulo.init();

  const prisma = modulo.get(PrismaService);
  // Montado na mão: o módulo do WhatsApp arrasta meio sistema (viagens,
  // uploads, torre) que não tem nada a ver com quem atende a mensagem.
  // Real aqui é o que decide: SDR, captação, reconhecimento do motorista.
  const testeGuiado = new TesteGuiadoService(
    prisma,
    chatwoot as unknown as ChatwootClientService,
    modulo.get(SdrService),
    modulo.get(AtendimentoHumanoService),
  );
  const agente = new ChatwootAgenteService(
    prisma,
    new SessaoService(prisma),
    { processar: async () => "(agente do motorista, fora do simulador)" } as unknown as AgenteService,
    { contaDoCodigo: async () => null, consumir: async () => null } as unknown as ConviteService,
    chatwoot as unknown as ChatwootClientService,
    modulo.get(SdrService),
    modulo.get(LeadChatwootService),
    modulo.get(ProspeccaoService),
    modulo.get(ConfigService),
    modulo.get(AtendimentoHumanoService),
    testeGuiado,
  );
  agente.esperaRajadaMs = 0;

  // A configuração de produção (28/09): times do Chatwoot, grade de ligação,
  // sem nome de consultor, teste de 30 dias aberto. Os alertas precisam de
  // destino pra aparecer no relatório.
  await comoSistema(() =>
    prisma.configuracaoPlataforma.update({
      where: { id: "singleton" },
      data: {
        sdrAtivo: true,
        alertaComercialTelefones: ["5500000000000"],
        chatwootTimeComercialId: 1,
        chatwootTimeOperacaoId: 2,
        sdrHorariosDemo: ["09:00", "10:30", "14:00", "16:00"],
        sdrAtendenteNome: null,
        sdrNomesEquipe: [],
        autoCadastroAberto: true,
        diasTesteGratis: 30,
      },
    }),
  );
  await comoSistema(() => prisma.supressaoContato.deleteMany({ where: { contato: { startsWith: "99" } } }));

  const linhas: string[] = [
    "# Simulação do atendimento no WhatsApp",
    "",
    `_Rodada em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (o prazo das frases depende do horário)._`,
    "",
  ];
  const resumo: string[] = [];
  let n = 0;
  let falhas = 0;

  // Os ecos do Chatwoot chegam depois de cada ação — processa até esvaziar.
  const drenarEcos = async () => {
    for (let guarda = 0; chatwoot.ecos.length > 0 && guarda < 50; guarda++) {
      await agente.processar(chatwoot.ecos.shift() as never);
    }
  };
  for (const c of CENARIOS as Cenario[]) {
    if (filtro && !c.nome.toLowerCase().includes(filtro.toLowerCase())) continue;
    n++;
    const conversa = 800_000 + n;
    const telefone = `+5599${String(90000000 + n)}`;
    await comoSistema(() =>
      prisma.lead.deleteMany({ where: { telefone: { endsWith: telefone.slice(-8) } } }),
    );
    const repassesAntes = chatwoot.repasses;
    linhas.push(`## ${n}. ${c.nome}`, `_canal ${c.canal} · ${c.origem}_`, "");
    const alertasAntes = alertas.length;

    let ultimoPassoCliente = false;
    // A conversa em ordem, cliente e robô — pras conferências que dependem do
    // que JÁ tinha sido dito (frota informada, recusa, pergunta repetida).
    const ordem: { quem: "C" | "R"; texto: string }[] = [];
    let ultimaFicouSemResposta = false;
    for (const p of c.passos) {
      const antes = chatwoot.eventos.get(conversa)?.length ?? 0;
      const base = {
        conversation: { id: conversa },
        account: { id: 1 },
        inbox: { id: INBOX[c.canal] },
      };
      if ("cliente" in p || "audio" in p) {
        const texto = "cliente" in p ? p.cliente : "";
        linhas.push(`**CLIENTE:** ${texto || "(áudio)"}`);
        if (texto) ordem.push({ quem: "C", texto });
        await agente.processar({
          ...base,
          event: "message_created",
          message_type: "incoming",
          content: texto,
          sender: { id: 1, phone_number: telefone, name: "Cliente Teste" },
        } as never);
      } else if ("contaCriada" in p) {
        linhas.push(`**SITE:** criou a conta de teste com este telefone (e o cron do teste guiado rodou)`);
        const conta = await comoSistema(() =>
          prisma.conta.create({ data: { nome: `Simulador ${n}`, slug: `simulador-${n}-${Date.now()}` } }),
        );
        // O mesmo casamento do `cadastro-conta` (registrarNoFunil).
        await comoSistema(() =>
          prisma.lead.updateMany({
            where: { telefone: { endsWith: telefone.slice(-8) }, chatwootConversaId: { not: null } },
            data: { contaId: conta.id },
          }),
        );
        await testeGuiado.varrer();
      } else if ("devolverAoRobo" in p) {
        linhas.push(`**PAINEL:** clicou "Devolver ao robô"`);
        const lead = await comoSistema(() =>
          prisma.lead.findFirst({ where: { telefone: { endsWith: telefone.replace(/\D/g, "").slice(-8) } }, select: { id: true } }),
        );
        if (lead) await modulo.get(ProspeccaoService).devolverAoRobo(lead.id);
      } else if ("equipe" in p || "nota" in p) {
        const nota = "nota" in p;
        const texto = nota ? p.nota : p.equipe;
        linhas.push(nota ? `**NOTA DA EQUIPE:** ${texto}` : `**EQUIPE (pelo Chatwoot):** ${texto}`);
        await agente.processar({
          ...base,
          event: "message_created",
          message_type: "outgoing",
          private: nota,
          id: 123_456 + n,
          content: texto,
          sender: { name: "Consultor", type: "user" },
        } as never);
      } else {
        const chave = "atribuir" in p ? "assignee_id" : "etiquetar" in p ? "label_list" : "status";
        const valor = "atribuir" in p ? 7 : "etiquetar" in p ? [p.etiquetar] : "resolved";
        linhas.push(`**GESTO NO CHATWOOT:** ${chave} → ${JSON.stringify(valor)}`);
        await agente.processar({
          event: "conversation_updated",
          id: conversa,
          changed_attributes: [{ [chave]: { previous_value: null, current_value: valor } }],
        } as never);
      }
      ultimoPassoCliente = "cliente" in p || "audio" in p;
      await drenarEcos();
      const novos = (chatwoot.eventos.get(conversa) ?? []).slice(antes);
      if (novos.length === 0) linhas.push(`> _(robô não respondeu)_`);
      ultimaFicouSemResposta = !novos.some((e) => e.startsWith("ROBÔ:"));
      for (const e of novos) linhas.push(`> ${e}`);
      for (const e of novos) if (e.startsWith("ROBÔ:")) ordem.push({ quem: "R", texto: e.slice(6) });
      linhas.push("");
    }

    const lead = await comoSistema(() =>
      prisma.lead.findFirst({
        where: { telefone: { endsWith: telefone.replace(/\D/g, "").slice(-8) } },
        select: { sdrPausadoEm: true, primeiraRespostaHumanaEm: true, status: true, optOut: true },
      }),
    );
    const novosAlertas = alertas.slice(alertasAntes);
    const repasses = chatwoot.repasses - repassesAntes;
    linhas.push(
      `_Fim: ${lead ? `robô ${lead.sdrPausadoEm ? "FORA da conversa" : "ativo"}` : "sem lead"} · ` +
        `${lead?.primeiraRespostaHumanaEm ? "gente já respondeu" : "gente ainda não respondeu"} · ` +
        `opt-out ${lead?.optOut ? "SIM" : "não"} · repasses ${repasses} · ` +
        `alertas: ${novosAlertas.length ? novosAlertas.join(" ; ") : "nenhum"}_`,
    );

    // As conferências: as do cenário e as que valem pra toda fala do robô.
    const erros: string[] = [];
    const falas = (chatwoot.eventos.get(conversa) ?? [])
      .filter((e) => e.startsWith("ROBÔ:"))
      .map((e) => e.slice(6));
    for (const f of falas) {
      if (/[—–]/.test(f)) erros.push(`travessão: "${f.slice(0, 60)}"`);
      if (f.replace(/https?:\/\/\S+/g, "").trim().length < 12) erros.push(`resposta-toco: "${f}"`);
      if (/\bfernando\b/i.test(f)) erros.push(`nome de pessoa: "${f.slice(0, 60)}"`);
      if ((f.match(/\?/g) ?? []).length > 1) erros.push(`duas perguntas: "${f.slice(0, 80)}"`);
      // O guia do teste é lista de propósito (é o que a pessoa segue com o
      // painel aberto); o resto tem que ser curto.
      const guia = ehTestePasso1(f) || ehTestePasso2(f) || ehCaminhos(f) || ehAbertura(f);
      if (!guia && f.replace(/https?:\/\/\S+/g, "").length > 330) erros.push(`longa (${f.length}): "${f.slice(0, 60)}…"`);
      if (/comece\s+cadastrando\s+um\s+motorista|lan[cç]ando\s+uma\s+viagem/i.test(f))
        erros.push(`mandou a transportadora começar pelo motorista: "${f.slice(0, 60)}"`);
    }
    // As que a QA final cobrou (28/09): passaram em 42/42 e não deviam.
    const ditoAntes: string[] = [];
    for (const m of ordem) {
      if (m.quem === "C") {
        ditoAntes.push(m.texto);
        continue;
      }
      const f = m.texto;
      if (/^\s*["“]|["”]\s*$/.test(f)) erros.push(`aspas nas pontas: "${f.slice(0, 50)}"`);
      // As da terceira revisão (28/09).
      if (/\b[a-z]+_[a-z]+\b/.test(f.replace(/https?:\/\/\S+/g, ""))) erros.push(`nome interno vazou: "${f.slice(0, 50)}"`);
      if (/^\s*anotado\.?\s*$/i.test(f)) erros.push(`"Anotado." sozinho`);
      // As da quarta revisão (28/09).
      if (/\b(?:muitos|v[aá]rios|a\s+maioria)\s+(?:dos?\s+|de\s+)?(?:transportador|cliente|empresa)|\bclientes?\s+(?:rodando|usando)/i.test(f))
        erros.push(`prova social inventada: "${f.slice(0, 60)}"`);
      if (/\bcl[aá]ssico\b/i.test(f)) erros.push(`comentário sobre o jeito dele: "${f.slice(0, 40)}"`);
      if (/\b(?:a\s+maioria|o\s+pessoal|muita\s+gente|outros\s+transportador|app\s+novo)\b|\ba\s+gente\s+(?:mais\s+)?v[eê]/i.test(f))
        erros.push(`generalização inventada: "${f.slice(0, 60)}"`);
      if (/\bh[aá]\s+(?:\d+\s+|muitos\s+)?anos\b|\bdesde\s+20\d\d\b|\btransportadoras?\s+(?:de\s+\S+\s+)?usando\b/i.test(f))
        erros.push(`fato inventado sobre a empresa: "${f.slice(0, 60)}"`);
      if (/\bserve\s+(?:pra|para)\s+mim\b/i.test(ditoAntes[ditoAntes.length - 1] ?? "") && !/^\s*serve\b/i.test(f))
        erros.push(`"serve pra mim?" sem resposta: "${f.slice(0, 50)}"`);
      const anterior = ditoAntes[ditoAntes.length - 1] ?? "";
      // Sétima revisão: frase sobre o próprio histórico, e "como funciona" sem explicação.
      if (/\bprimeira\s+mensagem\s+que\s+recebi\b|\bdesculpa\s+a\s+demora\b|\bn[aã]o\s+recebi\b/i.test(f))
        erros.push(`frase falsa sobre a conversa: "${f.slice(0, 60)}"`);
      if (/\bcomo\s+funciona\b/i.test(anterior) && !/\bcelular\b/i.test(f))
        erros.push(`"como funciona?" sem explicação: "${f.slice(0, 60)}"`);
      if (/\bconcreto\b/i.test(f)) erros.push(`"concreto" (não é granel): "${f.slice(0, 40)}"`);
      if (/\?/.test(anterior) && /cart[aã]o/i.test(anterior) && /^\s*certeza\b/i.test(f))
        erros.push(`"Certeza." pra pergunta de cartão`);
      const preco = /\bpra\s+(\d+)\s+caminh/i.exec(f);
      if (preco && !frotaInformada(Number(preco[1]), ditoAntes, null))
        erros.push(`frota inventada (${preco[1]}): "${f.slice(0, 60)}"`);
      const disseFrota = ditoAntes.some((d) =>
        /\b(?:\d+|um|uma|dois|duas|tr[eê]s|quatro|cinco)\s+caminh|\bcaminh[aã]o\s+s[oó]\b|^\s*\d+\s*$/i.test(d),
      );
      if (disseFrota && /quantos\s+caminh/i.test(f)) erros.push(`perguntou a frota já dita: "${f.slice(0, 60)}"`);
      const recusou = ditoAntes.some((d) => /n[aã]o\s+(?:precisa|quero)\b|\bpode\s+continuar\b|n[aã]o\s+me\s+liga/i.test(d));
      if (recusou && /\bte\s+ligue\b|\bliga[cç][aã]o\s+de\s+10\b/i.test(f))
        erros.push(`ofereceu ligação depois de recusa: "${f.slice(0, 60)}"`);
    }
    const e = c.espera ?? {};
    if (e.repasses !== undefined && repasses !== e.repasses) erros.push(`repasses ${repasses}, esperado ${e.repasses}`);
    if (e.alertas !== undefined && novosAlertas.length !== e.alertas)
      erros.push(`alertas ${novosAlertas.length}, esperado ${e.alertas}`);
    if (e.ultimaSemResposta !== undefined && ultimoPassoCliente && ultimaFicouSemResposta !== e.ultimaSemResposta)
      erros.push(e.ultimaSemResposta ? "última mensagem devia ficar sem resposta" : "última mensagem ficou sem resposta");
    if (e.optOut !== undefined && Boolean(lead?.optOut) !== e.optOut) erros.push(`opt-out ${lead?.optOut}, esperado ${e.optOut}`);
    if (e.roboAtivo !== undefined && lead && !lead.sdrPausadoEm !== e.roboAtivo)
      erros.push(`robô ${lead.sdrPausadoEm ? "fora" : "ativo"}, esperado ${e.roboAtivo ? "ativo" : "fora"}`);
    if (e.contem && !falas.some((f) => f.toLowerCase().includes(e.contem!.toLowerCase())))
      erros.push(`nenhuma fala contém "${e.contem}"`);
    if (e.ultimaContem && !(falas[falas.length - 1] ?? "").toLowerCase().includes(e.ultimaContem.toLowerCase()))
      erros.push(`última fala não contém "${e.ultimaContem}": "${(falas[falas.length - 1] ?? "").slice(0, 60)}"`);

    if (erros.length) falhas++;
    linhas.push(erros.length ? `\n**FALHOU:** ${erros.join(" · ")}` : "\n**PASSOU**", "", "---", "");
    resumo.push(`${erros.length ? "FALHOU" : "passou"} · ${n}. ${c.nome}${erros.length ? ` → ${erros.join(" · ")}` : ""}`);
    process.stdout.write(`${erros.length ? "✗" : "✓"} ${n}. ${c.nome}\n`);
  }

  linhas.splice(4, 0, "## Resumo", "", ...resumo.map((r) => `- ${r}`), "", `**${n - falhas} de ${n} passaram.**`, "");
  writeFileSync(saida, linhas.join("\n"));
  console.log(`\n${n - falhas}/${n} passaram → ${saida}`);
  process.exitCode = falhas > 0 ? 1 : 0;
  await modulo.close();
}

void main();
