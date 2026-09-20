import type { Metadata } from "next";
import QRCode from "qrcode";
import { CopiarCodigo } from "./_components/copiar-codigo";

/** Página de token nunca pode ser estática nem cacheada por rota. */
export const dynamic = "force-dynamic";

// Server-side pode usar API_URL (interno); nenhuma env nova aqui.
const API_SERVIDOR =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type Pagamento = {
  empresa: string;
  valor: string;
  periodicidade: string;
  vencimento: string;
  forma: "CARTAO" | "PIX" | "PIX_AUTOMATICO" | "BOLETO";
  situacao: "AGUARDANDO" | "ATIVA";
  pix: { codigo: string; expirado: boolean } | null;
  linkGateway: string | null;
};

type Codigo = "LINK_INVALIDO" | "ASSINATURA_CANCELADA";
type Resultado = { ok: true; dados: Pagamento } | { ok: false; code: Codigo };

async function buscar(token: string): Promise<Resultado> {
  const res = await fetch(`${API_SERVIDOR}/publico/pagar/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (res.ok) return { ok: true, dados: (await res.json()) as Pagamento };

  const corpo = (await res.json().catch(() => null)) as { code?: string } | null;
  if (corpo?.code === "ASSINATURA_CANCELADA") return { ok: false, code: "ASSINATURA_CANCELADA" };
  return { ok: false, code: "LINK_INVALIDO" };
}

export const metadata: Metadata = {
  title: "Pagar a assinatura — Movatruck",
  // Página de cobrança de um cliente específico jamais pode ser indexada.
  robots: { index: false, follow: false },
};

export default async function PagarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await buscar(token);

  if (!r.ok) {
    return (
      <Moldura>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-5">
          <h2 className="font-semibold text-slate-900">
            {r.code === "ASSINATURA_CANCELADA"
              ? "Esta assinatura foi cancelada"
              : "Este link não é válido"}
          </h2>
          <p className="mt-2 text-sm text-slate-700">
            {r.code === "ASSINATURA_CANCELADA"
              ? "Não há nada a pagar por aqui. Se isso não era o esperado, fale com a gente pelo WhatsApp."
              : "O endereço pode ter sido copiado pela metade. Abra de novo pelo link que você recebeu no WhatsApp."}
          </p>
        </div>
      </Moldura>
    );
  }

  const d = r.dados;

  // O QR é gerado aqui, do MESMO código que o botão copia. Duas fontes (a
  // imagem do gateway e o nosso payload) poderiam divergir, e divergir aqui
  // significa o cliente pagar para um lugar e a gente esperar de outro.
  const qr =
    d.pix && !d.pix.expirado
      ? await QRCode.toDataURL(d.pix.codigo, {
          margin: 1,
          width: 512,
          // "L" é o que o padrão do Bacen pede pro BR Code, e aqui tem motivo
          // prático: são 263 caracteres. Em "M" o QR passa de 70 módulos de
          // lado e, num celular, cada módulo fica com 3px — a câmera erra. O
          // código não some se o papel amassar (não tem papel), então redundância
          // a mais só atrapalha a leitura.
          errorCorrectionLevel: "L",
        })
      : null;

  return (
    <Moldura>
      <div className="rounded-lg border bg-white p-5 shadow-sm sm:p-6">
        <p className="text-sm text-slate-600">{d.empresa}</p>
        <p className="mt-1 text-3xl font-bold text-slate-900">
          {d.valor}{" "}
          <span className="text-base font-normal text-slate-600">{d.periodicidade}</span>
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {d.situacao === "ATIVA" ? "Próximo vencimento" : "Vencimento da primeira mensalidade"}:{" "}
          <strong className="text-slate-900">{d.vencimento}</strong>
        </p>
      </div>

      {d.situacao === "ATIVA" ? (
        <div className="rounded-lg border border-green-300 bg-green-50 p-5">
          <h2 className="font-semibold text-slate-900">Está tudo certo</h2>
          <p className="mt-2 text-sm text-slate-700">
            A autorização já foi feita e as mensalidades são debitadas sozinhas. Você não precisa
            fazer nada — e pode cancelar quando quiser, pelo app do seu banco.
          </p>
        </div>
      ) : d.pix && !d.pix.expirado ? (
        <div className="rounded-lg border bg-white p-5 shadow-sm sm:p-6">
          <h2 className="font-semibold text-slate-900">Pague este Pix uma vez</h2>
          <p className="mt-1 text-sm text-slate-600">
            Pagar autoriza as próximas mensalidades a caírem sozinhas, na data do vencimento. É uma
            vez só — e dá pra cancelar quando quiser, pelo app do seu banco.
          </p>

          <div className="mt-5 space-y-5">
            <CopiarCodigo codigo={d.pix.codigo} />

            {qr && (
              <div className="border-t pt-5">
                <p className="mb-3 text-center text-sm text-slate-600">
                  Ou aponte a câmera do banco para o QR
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt="QR Code do Pix"
                  className="mx-auto h-64 w-64 rounded border bg-white p-2"
                />
              </div>
            )}
          </div>
        </div>
      ) : d.pix?.expirado ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-5">
          <h2 className="font-semibold text-slate-900">Este código venceu</h2>
          <p className="mt-2 text-sm text-slate-700">
            Códigos de Pix têm prazo curto. Peça um novo respondendo a mensagem do WhatsApp — a
            gente gera na hora, e o valor e o vencimento seguem os mesmos.
          </p>
        </div>
      ) : d.linkGateway ? (
        <div className="rounded-lg border bg-white p-5 shadow-sm sm:p-6">
          <h2 className="font-semibold text-slate-900">Concluir o pagamento</h2>
          <p className="mt-1 text-sm text-slate-600">
            O pagamento desta assinatura é feito na página segura do nosso processador.
          </p>
          <a
            href={d.linkGateway}
            className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-md bg-slate-900 px-4 font-medium text-white hover:bg-slate-800"
          >
            Ir para o pagamento
          </a>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-5">
          <h2 className="font-semibold text-slate-900">O código ainda não está pronto</h2>
          <p className="mt-2 text-sm text-slate-700">
            Não conseguimos gerar o Pix desta assinatura. Responda a mensagem do WhatsApp que a
            gente resolve e manda o código de novo.
          </p>
        </div>
      )}

      <p className="text-center text-xs text-slate-500">
        Pagamento processado pelo Asaas. A Movatruck não tem acesso aos seus dados bancários.
      </p>
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-lg space-y-5 px-4 py-8 text-slate-800 sm:py-12">
      <header className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marca/movatruck-logo.svg"
          alt="Movatruck"
          className="mx-auto h-8 w-auto"
        />
        <h1 className="mt-4 text-xl font-bold text-slate-900">Assinatura Movatruck</h1>
      </header>
      {children}
    </main>
  );
}
