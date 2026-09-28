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
  | { resolver: true };

export type Cenario = {
  nome: string;
  canal: "comercial" | "operacao";
  /** De onde saiu: "real" = conversa do Chatwoot; "adversarial" = feito pra quebrar. */
  origem: "real" | "adversarial" | "teste-do-dono";
  passos: Passo[];
};

const INBOX = { comercial: 2, operacao: 1 };

/** O que um Chatwoot falso precisa lembrar. */
class ChatwootFalso {
  private proximoId = 900_000;
  readonly eventos = new Map<number, string[]>();
  private readonly etiquetas = new Map<number, Set<string>>();
  private readonly nossos = new Set<number>();

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
  async responder(_c: number, conversa: number, texto: string) {
    const id = this.proximoId++;
    this.nossos.add(id);
    this.anotarEvento(conversa, `ROBÔ: ${texto}`);
    return true;
  }
  async anotar(_c: number, conversa: number, texto: string) {
    this.nossos.add(this.proximoId++);
    this.anotarEvento(conversa, `(nota interna do robô: ${texto})`);
    return true;
  }
  foiORobo(m: { id?: number }) {
    return typeof m.id === "number" && this.nossos.has(m.id);
  }
  async passarParaHumano(_c: number, conversa: number, time?: number | null, extras: string[] = []) {
    const e = this.etiquetas.get(conversa) ?? new Set<string>();
    ["precisa-humano", ...extras].forEach((x) => e.add(x));
    this.etiquetas.set(conversa, e);
    this.anotarEvento(conversa, `[repasse pra gente · time ${time ?? "nenhum"} · etiquetas ${[...e].join(",")}]`);
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
  );
  agente.esperaRajadaMs = 0;

  // Os alertas precisam de destino pra aparecer no relatório.
  await comoSistema(() =>
    prisma.configuracaoPlataforma.update({
      where: { id: "singleton" },
      data: { sdrAtivo: true, alertaComercialTelefones: ["5500000000000"] },
    }),
  );

  const linhas: string[] = ["# Simulação do atendimento no WhatsApp", ""];
  let n = 0;
  for (const c of CENARIOS as Cenario[]) {
    if (filtro && !c.nome.toLowerCase().includes(filtro.toLowerCase())) continue;
    n++;
    const conversa = 800_000 + n;
    const telefone = `+5599${String(90000000 + n)}`;
    await comoSistema(() =>
      prisma.lead.deleteMany({ where: { telefone: { endsWith: telefone.slice(-8) } } }),
    );
    linhas.push(`## ${n}. ${c.nome}`, `_canal ${c.canal} · ${c.origem}_`, "");
    const alertasAntes = alertas.length;

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
        await agente.processar({
          ...base,
          event: "message_created",
          message_type: "incoming",
          content: texto,
          sender: { id: 1, phone_number: telefone, name: "Cliente Teste" },
        } as never);
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
      const novos = (chatwoot.eventos.get(conversa) ?? []).slice(antes);
      if (novos.length === 0) linhas.push(`> _(robô não respondeu)_`);
      for (const e of novos) linhas.push(`> ${e}`);
      linhas.push("");
    }

    const lead = await comoSistema(() =>
      prisma.lead.findFirst({
        where: { telefone: { endsWith: telefone.replace(/\D/g, "").slice(-8) } },
        select: { sdrPausadoEm: true, primeiraRespostaHumanaEm: true, status: true },
      }),
    );
    const novosAlertas = alertas.slice(alertasAntes);
    linhas.push(
      `_Fim: robô ${lead?.sdrPausadoEm ? "FORA da conversa" : "ativo"} · ` +
        `${lead?.primeiraRespostaHumanaEm ? "gente já respondeu" : "gente ainda não respondeu"} · ` +
        `alertas: ${novosAlertas.length ? novosAlertas.join(" ; ") : "nenhum"}_`,
      "",
      "---",
      "",
    );
    process.stdout.write(`${n}. ${c.nome}\n`);
  }

  writeFileSync(saida, linhas.join("\n"));
  console.log(`\n${n} cenários → ${saida}`);
  await modulo.close();
}

void main();
