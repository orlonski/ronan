/**
 * Link da proposta que o cliente da transportadora recebe (WhatsApp ou e-mail):
 * repassa o PDF da API. Fica no domínio do painel, como o extrato do acerto —
 * a API segue sem domínio "bonito" exposto. O token é assinado e vence em 30
 * dias; quem valida é a API.
 */
const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const res = await fetch(`${API_URL}/publico/orcamentos/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!res.ok) {
    const msg =
      res.status === 404
        ? "Este link venceu ou não vale mais. Peça um novo a quem mandou a proposta."
        : "Não consegui abrir a proposta agora. Tente de novo em instantes.";
    return new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orçamento</title><body style="font-family:system-ui;padding:24px;color:#111"><h1 style="font-size:20px">Orçamento</h1><p>${msg}</p></body>`,
      { status: res.status === 404 ? 404 : 502, headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } },
    );
  }
  return new Response(res.body, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": res.headers.get("content-disposition") ?? 'inline; filename="orcamento.pdf"',
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
