import { NOME_PLATAFORMA } from "@ronan/shared-types";

/**
 * Casca HTML de todo e-mail do sistema: marca da EMPRESA no topo (quem manda é
 * a transportadora, não a Movatruck) e rodapé discreto da plataforma.
 *
 * Feito à mão, com tabela e estilo inline, porque cliente de e-mail (Outlook,
 * Gmail no celular) ignora `<style>` e flexbox. Largura máxima de 600px e
 * tabelas a 100%: no celular encolhe sozinho, sem media query.
 */

export interface MarcaEmail {
  nome: string;
  /** URL ABSOLUTA da logo. Relativa não abre em cliente de e-mail — aí sai só o nome. */
  logoUrl: string | null;
}

/** Cores da marca Movatruck. O laranja só como fundo; texto usa o escuro (contraste). */
const COR = {
  fundo: "#F3F4F6",
  cartao: "#FFFFFF",
  texto: "#111827",
  suave: "#6B7280",
  borda: "#E5E7EB",
  laranja: "#DF7234",
  laranjaTexto: "#B4501A",
} as const;

export function escaparHtml(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Botão "à prova de Outlook": tabela com fundo, link dentro. */
export function botaoEmail(rotulo: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0"><tr><td style="background:${COR.laranja};border-radius:8px"><a href="${escaparHtml(url)}" style="display:inline-block;padding:12px 20px;color:#FFFFFF;font-weight:600;font-size:15px;text-decoration:none;font-family:Arial,Helvetica,sans-serif">${escaparHtml(rotulo)}</a></td></tr></table>`;
}

/**
 * Tabela de pares rótulo → valor (os dados da viagem). Valor vazio vira "—"
 * pra não deixar buraco no meio do e-mail.
 */
export function tabelaDados(linhas: Array<[string, string | null | undefined]>): string {
  const tr = linhas
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px 6px 0;color:${COR.suave};font-size:14px;white-space:nowrap;vertical-align:top">${escaparHtml(k)}</td><td style="padding:6px 0;color:${COR.texto};font-size:14px;font-weight:600">${escaparHtml(v?.trim() || "—")}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif">${tr}</table>`;
}

export function layoutEmail(input: {
  marca: MarcaEmail;
  /** Texto que aparece na prévia da caixa de entrada, ao lado do assunto. */
  preheader: string;
  titulo: string;
  /** HTML já escapado pelo chamador. */
  corpoHtml: string;
}): string {
  const { marca } = input;
  const topo = marca.logoUrl
    ? `<img src="${escaparHtml(marca.logoUrl)}" alt="${escaparHtml(marca.nome)}" height="40" style="display:block;height:40px;max-width:200px;border:0">`
    : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:${COR.texto}">${escaparHtml(marca.nome)}</div>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escaparHtml(input.titulo)}</title>
</head>
<body style="margin:0;padding:0;background:${COR.fundo}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escaparHtml(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COR.fundo}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${COR.cartao};border:1px solid ${COR.borda};border-radius:12px">
<tr><td style="padding:20px 24px;border-bottom:3px solid ${COR.laranja}">${topo}</td></tr>
<tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;color:${COR.texto};font-size:15px;line-height:1.5">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${COR.texto}">${escaparHtml(input.titulo)}</h1>
${input.corpoHtml}
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">
<tr><td style="padding:16px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${COR.suave};text-align:center">
Enviado por ${escaparHtml(marca.nome)} pela plataforma <span style="color:${COR.laranjaTexto};font-weight:600">${NOME_PLATAFORMA}</span>.<br>
Este é um e-mail automático; para falar com ${escaparHtml(marca.nome)}, use o contato de sempre.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Rodapé da versão texto — a mesma ideia, sem HTML. */
export function rodapeTexto(marca: MarcaEmail): string {
  return `—\nEnviado por ${marca.nome} pela plataforma ${NOME_PLATAFORMA}. E-mail automático; para falar com ${marca.nome}, use o contato de sempre.`;
}
