import type { Metadata } from "next";
import { ArrowDown, MapPin, Package, Scale, Truck, User, type LucideIcon } from "lucide-react";
import { AcoesComprovante } from "./_components/acoes-comprovante";
import { FotosComprovante } from "./_components/fotos-comprovante";
import { LinkIndisponivel, type CodigoIndisponivel } from "./_components/link-indisponivel";
import { MapaComprovante } from "./_components/mapa-comprovante";

/** Página de token nunca pode ser estática nem cacheada por rota. */
export const dynamic = "force-dynamic";

// Server-side pode usar API_URL (interno); o browser precisa da pública, que já
// é bakeada no build do dashboard — nenhuma env nova aqui.
const API_SERVIDOR =
  process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const API_BROWSER = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

type Situacao = { rotulo: string; tom: "ok" | "neutro" | "atencao" };
type Local = { nome: string; cidade: string | null; uf: string | null; lat: number | null; lng: number | null };

type Comprovante = {
  ticket: string | null;
  data: string | null;
  situacao: Situacao;
  emitidoEm: string;
  linkExpiraEm: string;
  material: { nome: string } | null;
  motorista: { nome: string };
  veiculo: { placa: string };
  origem: Local | null;
  destino: Local | null;
  trechos: { rotulo: string; localNome: string | null; km: string | null }[];
  km: { informado: string; efetivo: string; ajustadoPorMinimo: boolean };
  toneladas: { informada: string; efetiva: string; ajustadoPorMinimo: boolean };
  pedagio: { total: string | null; itens: { praca: string; valor: string; data: string }[] };
  rotaGeometria: string | null;
  fotos: { id: string; rotacao: number }[];
};

type Resultado = { ok: true; dados: Comprovante } | { ok: false; code: CodigoIndisponivel };

/**
 * Busca o comprovante. `generateMetadata` e a página chamam a mesma função —
 * a memoização de request do App Router dedupa, então o acesso conta uma vez só
 * por carregamento.
 */
async function buscar(token: string): Promise<Resultado> {
  const res = await fetch(`${API_SERVIDOR}/publico/viagens/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (res.ok) return { ok: true, dados: (await res.json()) as Comprovante };

  const corpo = (await res.json().catch(() => null)) as { code?: string } | null;
  const code = corpo?.code;
  if (code === "LINK_EXPIRADO" || code === "LINK_REVOGADO") return { ok: false, code };
  return { ok: false, code: "LINK_INVALIDO" };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const r = await buscar(token);

  const base: Metadata = {
    // Comprovante de cliente jamais pode ser indexado.
    robots: { index: false, follow: false },
  };
  if (!r.ok) return { ...base, title: "Comprovante indisponível — Schaba" };

  const d = r.dados;
  const titulo = d.ticket ? `Comprovante de viagem — Ticket ${d.ticket}` : "Comprovante de viagem";
  const resumo = [
    d.data ? dataBR(d.data) : null,
    d.origem && d.destino ? `${d.origem.nome} → ${d.destino.nome}` : null,
    d.toneladas ? `${numBR(d.toneladas.efetiva)} t` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    ...base,
    title: `${titulo} — Schaba`,
    description: resumo,
    openGraph: {
      title: titulo,
      description: resumo,
      // Logo estático, NÃO a foto do ticket: o WhatsApp derruba preview grande
      // e a balança pode estar rotacionada/ilegível.
      images: ["/schaba-logo.png"],
      type: "website",
    },
  };
}

export default async function ComprovantePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const r = await buscar(token);
  if (!r.ok) return <LinkIndisponivel code={r.code} />;

  const d = r.dados;
  const urlComprovante = `${API_BROWSER}/publico/viagens/${encodeURIComponent(token)}`;
  const temPedagio = d.pedagio.total != null || d.pedagio.itens.length > 0;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-slate-800 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/schaba-logo.png" alt="Schaba" className="mb-3 h-8 w-auto" />
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Comprovante de viagem</h1>
          <p className="mt-1 text-slate-600">
            {d.ticket ? (
              <>
                Ticket <strong className="text-slate-900">{d.ticket}</strong>
              </>
            ) : (
              "Sem número de ticket"
            )}
            {d.data && <> · {dataBR(d.data)}</>}
          </p>
        </div>
        {/* No celular o header empilha; alinhar à direita ali deixaria o selo
            solto no meio da tela. Só no desktop o bloco vai pra direita. */}
        <div className="flex flex-wrap items-center gap-3 sm:flex-col sm:items-end">
          <Selo situacao={d.situacao} />
          <AcoesComprovante />
        </div>
      </header>

      <div className="space-y-6">
        <Card titulo="Trajeto">
          <div className="space-y-3">
            <Ponta rotulo="Origem" local={d.origem} cor="bg-green-600" />
            <div className="flex items-center gap-3 pl-[7px] text-sm text-slate-500">
              <ArrowDown className="h-4 w-4 shrink-0" />
              <span>
                <strong className="text-slate-900">{numBR(d.km.efetivo)} km</strong>
                {d.km.ajustadoPorMinimo && (
                  <span className="ml-2 text-xs text-slate-500">(mínimo contratado aplicado)</span>
                )}
              </span>
            </div>
            <Ponta rotulo="Destino" local={d.destino} cor="bg-red-600" />
          </div>

          {d.trechos.length > 0 && (
            <ul className="mt-4 space-y-1 border-t pt-3 text-sm text-slate-600">
              {d.trechos.map((t, i) => (
                <li key={i}>
                  {t.rotulo}
                  {t.localNome && <> · {t.localNome}</>}
                  {t.km && <> · +{numBR(t.km)} km</>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card titulo="Carga">
          {/* Um item por linha: no celular (de onde o cliente abre) quatro
              colunas viravam texto espremido e cortado. */}
          <dl className="space-y-2">
            <Campo icone={Package} rotulo="Material" valor={d.material?.nome ?? "—"} />
            <Campo
              icone={Scale}
              rotulo="Peso"
              valor={`${numBR(d.toneladas.efetiva)} t`}
              nota={d.toneladas.ajustadoPorMinimo ? "mínimo contratado" : undefined}
            />
            <Campo icone={Truck} rotulo="Placa" valor={d.veiculo.placa} />
            <Campo icone={User} rotulo="Motorista" valor={d.motorista.nome} />
          </dl>
        </Card>

        {temPedagio && (
          <Card titulo="Pedágio">
            <p className="text-2xl font-bold text-slate-900">
              {d.pedagio.total ? `R$ ${numBR(d.pedagio.total)}` : "—"}
            </p>
            {d.pedagio.itens.length > 0 && (
              <ul className="mt-3 divide-y border-t text-sm">
                {d.pedagio.itens.map((p, i) => (
                  <li key={i} className="flex justify-between py-2">
                    <span className="text-slate-600">{p.praca}</span>
                    <span className="font-medium text-slate-900">R$ {numBR(p.valor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {(d.origem || d.destino || d.rotaGeometria) && (
          <>
            <Card titulo="Mapa do trajeto" className="print:hidden">
              <MapaComprovante
                origem={pontoMapa(d.origem)}
                destino={pontoMapa(d.destino)}
                geometria={d.rotaGeometria}
              />
            </Card>
            {/* Leaflet imprime tiles em branco — no papel vai o texto. */}
            <div className="hidden print:block">
              <Card titulo="Mapa do trajeto">
                <p className="text-sm text-slate-600">
                  {d.origem?.nome ?? "—"} → {d.destino?.nome ?? "—"} · {numBR(d.km.efetivo)} km
                </p>
              </Card>
            </div>
          </>
        )}

        {d.fotos.length > 0 && (
          <Card titulo="Ticket de balança">
            <FotosComprovante fotos={d.fotos} urlComprovante={urlComprovante} />
          </Card>
        )}
      </div>

      <footer className="mt-10 border-t pt-6 text-xs text-slate-500">
        <p>
          Emitido em {dataHoraBR(d.emitidoEm)} · Link válido até {dataBR(d.linkExpiraEm)}
        </p>
        <p className="mt-1 font-medium text-slate-600">Schaba Transportes</p>
      </footer>
    </main>
  );
}

function Card({
  titulo,
  children,
  className = "",
}: {
  titulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border bg-white p-4 print:break-inside-avoid sm:p-5 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{titulo}</h2>
      {children}
    </section>
  );
}

function Ponta({ rotulo, local, cor }: { rotulo: string; local: Local | null; cor: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full ${cor}`} />
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</p>
        <p className="font-semibold text-slate-900">{local?.nome ?? "—"}</p>
        {local && (local.cidade || local.uf) && (
          <p className="flex items-center gap-1 text-sm text-slate-600">
            <MapPin className="h-3 w-3" />
            {[local.cidade, local.uf].filter(Boolean).join(" — ")}
          </p>
        )}
      </div>
    </div>
  );
}

function Campo({
  icone: Icone,
  rotulo,
  valor,
  nota,
}: {
  icone: LucideIcon;
  rotulo: string;
  valor: string;
  nota?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border bg-slate-50/60 px-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white text-slate-500 shadow-sm">
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-wide text-slate-500">{rotulo}</dt>
        <dd className="truncate font-semibold text-slate-900">{valor}</dd>
        {nota && <p className="text-[11px] text-slate-500">{nota}</p>}
      </div>
    </div>
  );
}

const TOM_CLASSE = {
  ok: "bg-green-100 text-green-800",
  neutro: "bg-slate-100 text-slate-700",
  atencao: "bg-amber-100 text-amber-800",
} as const;

function Selo({ situacao }: { situacao: Situacao }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${TOM_CLASSE[situacao.tom]}`}>
      {situacao.rotulo}
    </span>
  );
}

function pontoMapa(l: Local | null) {
  if (!l || l.lat == null || l.lng == null) return null;
  return { lat: l.lat, lng: l.lng, nome: l.nome };
}

/** `data` vem como YYYY-MM-DD (sem hora) — formatar em UTC pra não voltar um dia. */
function dataBR(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
  });
}

function dataHoraBR(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function numBR(s: string): string {
  return s.replace(".", ",");
}
