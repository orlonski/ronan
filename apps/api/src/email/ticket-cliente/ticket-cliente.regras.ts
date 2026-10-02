import { StatusViagem } from "@prisma/client";
import { MODO_ENVIO_TICKET_LABEL, type ModoEnvioTicket } from "@ronan/shared-types";
import { STATUS_FORA_FECHAMENTO } from "../../common/viagem-status";
import { horaMinutoSaoPaulo, inicioDoDiaData } from "../../common/timezone";
import {
  botaoEmail,
  escaparHtml,
  layoutEmail,
  rodapeTexto,
  tabelaDados,
  type MarcaEmail,
} from "../email-layout";

/**
 * Regras puras do ticket por e-mail ao cliente. Nada aqui fala com banco ou
 * SMTP — é o que os testes cobrem: quem recebe, quando uma viagem entra, a
 * chave que impede mandar duas vezes e o que vai escrito.
 *
 * Regra de ouro do conteúdo: NUNCA valor em R$. O e-mail vai pro cliente da
 * transportadora; preço é conversa comercial dela, não comprovante de entrega.
 */

export const TIPO_EMAIL_TICKET_VIAGEM = "TICKET_VIAGEM";
export const TIPO_EMAIL_TICKET_RESUMO = "TICKET_RESUMO_DIARIO";
export const TIPO_EMAIL_TICKET_TESTE = "TICKET_TESTE";

/**
 * Janela de segurança da varredura "a cada viagem": só olha viagem aprovada
 * nos últimos dias. Se o SMTP ficar fora um fim de semana, as viagens do
 * período ainda saem quando voltar; um mês atrás não sai mais — a essa altura
 * o e-mail virou ruído.
 */
export const JANELA_VARREDURA_MS = 3 * 24 * 3_600_000;

export interface ConfigTicket {
  modo: ModoEnvioTicket | null;
  emails: string[];
  desde: Date | null;
}

export interface EnvioTicketEfetivo {
  modo: ModoEnvioTicket;
  emails: string[];
  desde: Date | null;
  origem: "OBRA" | "PAGADOR";
}

/**
 * Quem recebe o ticket de uma obra.
 *
 * A obra com configuração própria (modo não nulo) manda em si — inclusive
 * NENHUM, pra calar uma obra de um pagador que está ligado. Sem configuração
 * própria, vale a do cliente pagador. Não é soma das duas: misturar faria um
 * e-mail cadastrado na obra receber também o que o pagador quis só pra si, e
 * ninguém consegue explicar isso numa tela.
 *
 * Modo ligado sem nenhum e-mail vale como NENHUM: não há pra quem mandar.
 */
export function resolverEnvioTicket(
  obra: ConfigTicket,
  pagador: ConfigTicket & { modo: ModoEnvioTicket },
): EnvioTicketEfetivo {
  const fonte = obra.modo != null ? obra : pagador;
  const origem = obra.modo != null ? "OBRA" : "PAGADOR";
  const emails = normalizarEmails(fonte.emails);
  const modo = fonte.modo ?? "NENHUM";
  if (modo !== "NENHUM" && emails.length === 0) {
    return { modo: "NENHUM", emails, desde: fonte.desde, origem };
  }
  return { modo, emails, desde: fonte.desde, origem };
}

/** Minúsculo, sem espaço, sem repetido, só o que parece e-mail. */
export function normalizarEmails(lista: readonly string[]): string[] {
  const vistos = new Set<string>();
  for (const bruto of lista) {
    const e = bruto.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) vistos.add(e);
  }
  return [...vistos];
}

/**
 * Quando o modo muda, o "desde" muda junto? Só quando o envio LIGA (de
 * nenhum pra algum, ou de um modo pra outro). Trocar a lista de e-mails não
 * reabre nada; desligar zera.
 *
 * É o que impede ligar o envio de despejar o histórico na caixa do cliente: só
 * viagem aprovada depois deste instante sai.
 */
export function novoDesde(
  anterior: { modo: ModoEnvioTicket | null; desde: Date | null },
  novoModo: ModoEnvioTicket | null,
  agora: Date,
): Date | null {
  if (novoModo == null || novoModo === "NENHUM") return null;
  if (anterior.modo === novoModo && anterior.desde) return anterior.desde;
  return agora;
}

/**
 * A viagem conta como "aprovada" pro ticket?
 *
 * Aprovada = status OK com `revisadoEm` — os três caminhos que aprovam
 * (conferência manual, pré-aprovação da IA, material que dispensa conferência)
 * carimbam os dois. Status fora do fechamento nunca sai, mesmo que um dia
 * ganhe `revisadoEm` por engano: viagem incompleta não é comprovante de nada.
 */
export function viagemEntraNoTicket(
  v: { status: StatusViagem; revisadoEm: Date | null },
  desde: Date | null,
): boolean {
  if (STATUS_FORA_FECHAMENTO.includes(v.status)) return false;
  if (v.status !== StatusViagem.OK) return false;
  if (!v.revisadoEm || !desde) return false;
  return v.revisadoEm.getTime() >= desde.getTime();
}

/** Uma viagem, um e-mail — pra sempre. É o unique do `EmailEnviado`. */
export function chaveTicketViagem(viagemId: string): string {
  return `ticket-viagem:${viagemId}`;
}

/** Um resumo por obra por dia (dia de São Paulo, YYYY-MM-DD). */
export function chaveResumoDiario(clienteId: string, diaSP: string): string {
  return `ticket-resumo:${clienteId}:${diaSP}`;
}

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------

export interface ViagemDoTicket {
  placa: string;
  motoristaNome: string | null;
  /** `Viagem.data` (@db.Date, meia-noite UTC). */
  data: Date | null;
  /** Quando o motorista lançou — é a "hora" que o cliente reconhece. */
  lancadaEm: Date;
  material: string | null;
  /** Peso do ticket, como veio (Decimal.toString()). Real, não o mínimo faturado. */
  toneladas: string | null;
  ticket: string | null;
  origem: string | null;
  destino: string | null;
  /** Link do comprovante público (`/v/<token>`). Nunca URL do MinIO. */
  link: string | null;
}

export interface EmailMontado {
  assunto: string;
  html: string;
  texto: string;
}

/** `@db.Date` é meia-noite UTC — formatar em UTC, senão volta um dia. */
export function dataBR(d: Date | null): string | null {
  return d ? d.toLocaleDateString("pt-BR", { timeZone: "UTC" }) : null;
}

/** 12.5 → "12,500 t". Três casas: é como a balança imprime. */
export function pesoBR(toneladas: string | null): string | null {
  if (toneladas == null || toneladas === "") return null;
  const n = Number(toneladas);
  if (!Number.isFinite(n)) return null;
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} t`;
}

function trecho(v: Pick<ViagemDoTicket, "origem" | "destino">): string | null {
  if (!v.origem && !v.destino) return null;
  return `${v.origem ?? "—"} → ${v.destino ?? "—"}`;
}

export function montarEmailTicketViagem(input: {
  marca: MarcaEmail;
  obraNome: string;
  viagem: ViagemDoTicket;
}): EmailMontado {
  const { marca, obraNome, viagem: v } = input;
  const data = dataBR(v.data);
  const hora = horaMinutoSaoPaulo(v.lancadaEm);
  const assunto = [
    "Ticket",
    v.ticket ? `nº ${v.ticket}` : null,
    `— ${v.placa}`,
    data ? `em ${data}` : null,
    `· ${obraNome}`,
  ]
    .filter(Boolean)
    .join(" ");

  const linhas: Array<[string, string | null]> = [
    ["Obra", obraNome],
    ["Data", data ? `${data} · ${hora}` : hora],
    ["Placa", v.placa],
    ["Motorista", v.motoristaNome],
    ["Material", v.material],
    ["Peso do ticket", pesoBR(v.toneladas)],
    ["Nº do ticket", v.ticket],
    ["Trecho", trecho(v)],
  ];

  const corpoHtml = [
    `<p style="margin:0 0 16px">Uma viagem para <strong>${escaparHtml(obraNome)}</strong> foi conferida e aprovada por ${escaparHtml(marca.nome)}.</p>`,
    tabelaDados(linhas),
    v.link
      ? `<p style="margin:20px 0 4px">O comprovante completo, com a foto do ticket e o trajeto, está no link:</p>${botaoEmail("Ver comprovante", v.link)}`
      : "",
  ].join("\n");

  const texto = [
    `Viagem conferida e aprovada por ${marca.nome}.`,
    "",
    ...linhas.map(([k, val]) => `${k}: ${val?.trim() || "—"}`),
    ...(v.link ? ["", `Comprovante com a foto do ticket: ${v.link}`] : []),
    "",
    rodapeTexto(marca),
  ].join("\n");

  return {
    assunto,
    html: layoutEmail({ marca, preheader: `${v.placa} · ${v.material ?? "viagem"} · ${obraNome}`, titulo: "Viagem aprovada", corpoHtml }),
    texto,
  };
}

/**
 * Resumo do dia de uma obra. Viagens em ordem de lançamento; o total de peso
 * sai no fim porque é a primeira conta que o cliente faz ao abrir.
 */
export function montarEmailResumoDiario(input: {
  marca: MarcaEmail;
  obraNome: string;
  /** "dd/mm/aaaa" do dia de São Paulo. */
  diaBR: string;
  viagens: ViagemDoTicket[];
}): EmailMontado {
  const { marca, obraNome, diaBR } = input;
  const viagens = [...input.viagens].sort((a, b) => a.lancadaEm.getTime() - b.lancadaEm.getTime());
  const n = viagens.length;
  const totalT = viagens.reduce((acc, v) => acc + (Number(v.toneladas) || 0), 0);
  const total = pesoBR(String(totalT));
  const plural = n === 1 ? "viagem aprovada" : "viagens aprovadas";
  const assunto = `Resumo de ${diaBR} — ${n} ${plural} · ${obraNome}`;

  const cel = "padding:8px 6px;border-bottom:1px solid #E5E7EB;font-size:13px;vertical-align:top";
  const cab = "padding:8px 6px;border-bottom:2px solid #E5E7EB;font-size:12px;color:#6B7280;text-align:left;font-weight:600";
  const linhasHtml = viagens
    .map(
      (v) =>
        `<tr><td style="${cel};white-space:nowrap">${escaparHtml(horaMinutoSaoPaulo(v.lancadaEm))}</td><td style="${cel};white-space:nowrap;font-weight:600">${escaparHtml(v.placa)}</td><td style="${cel}">${escaparHtml(v.material ?? "—")}</td><td style="${cel};white-space:nowrap;text-align:right">${escaparHtml(pesoBR(v.toneladas) ?? "—")}</td><td style="${cel};white-space:nowrap">${v.link ? `<a href="${escaparHtml(v.link)}" style="color:#B4501A;font-weight:600">Ver</a>` : "—"}</td></tr>`,
    )
    .join("");

  const corpoHtml = [
    `<p style="margin:0 0 16px">${n} ${plural} hoje para <strong>${escaparHtml(obraNome)}</strong>${total ? `, somando <strong>${escaparHtml(total)}</strong>` : ""}.</p>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif"><tr><th style="${cab}">Hora</th><th style="${cab}">Placa</th><th style="${cab}">Material</th><th style="${cab};text-align:right">Peso</th><th style="${cab}">Comprovante</th></tr>${linhasHtml}</table>`,
    `<p style="margin:16px 0 0;font-size:13px;color:#6B7280">Cada comprovante tem a foto do ticket e o trajeto da viagem.</p>`,
  ].join("\n");

  const texto = [
    `Resumo de ${diaBR} — ${obraNome}`,
    `${n} ${plural}${total ? `, somando ${total}` : ""}.`,
    "",
    ...viagens.map(
      (v) =>
        `${horaMinutoSaoPaulo(v.lancadaEm)} · ${v.placa} · ${v.material ?? "—"} · ${pesoBR(v.toneladas) ?? "—"}${v.link ? `\n  ${v.link}` : ""}`,
    ),
    "",
    rodapeTexto(marca),
  ].join("\n");

  return {
    assunto,
    html: layoutEmail({ marca, preheader: `${n} ${plural}${total ? ` · ${total}` : ""}`, titulo: `Viagens aprovadas em ${diaBR}`, corpoHtml }),
    texto,
  };
}

/** O "Enviar teste" do painel: mostra a cara do e-mail com uma viagem de exemplo. */
export function montarEmailTeste(input: {
  marca: MarcaEmail;
  nomeDestino: string;
  modo: ModoEnvioTicket | null;
  agora: Date;
}): EmailMontado {
  const exemplo = montarEmailTicketViagem({
    marca: input.marca,
    obraNome: input.nomeDestino,
    viagem: {
      placa: "ABC1D23",
      motoristaNome: "Motorista de exemplo",
      // Dia de São Paulo: às 22h o dia UTC já virou e o exemplo sairia com amanhã.
      data: inicioDoDiaData(input.agora),
      lancadaEm: input.agora,
      material: "Pedra brita",
      toneladas: "32.450",
      ticket: "000123",
      origem: "Pedreira (exemplo)",
      destino: input.nomeDestino,
      link: null,
    },
  });
  const modo = input.modo && input.modo !== "NENHUM" ? MODO_ENVIO_TICKET_LABEL[input.modo] : null;
  const aviso = `Este é um e-mail de TESTE de ${input.marca.nome}. Os dados abaixo são de exemplo.${modo ? ` Envio configurado: ${modo}.` : ""}`;
  return {
    assunto: `[Teste] ${exemplo.assunto}`,
    html: exemplo.html.replace(
      '<h1 style="',
      `<p style="margin:0 0 16px;padding:10px 12px;background:#FEF3C7;border-radius:8px;font-size:14px;color:#92400E">${escaparHtml(aviso)}</p><h1 style="`,
    ),
    texto: `${aviso}\n\n${exemplo.texto}`,
  };
}
