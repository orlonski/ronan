"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { use } from "react";
import {
  ArrowLeft,
  Camera,
  Fuel,
  Gauge,
  MapPin,
  User as UserIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { fmtNum } from "@/lib/fechamento-helpers";
import { useQuery } from "@tanstack/react-query";

const PontoMap = dynamic(
  () => import("@/components/ponto-map").then((m) => m.PontoMap),
  { ssr: false, loading: () => <div className="h-64 rounded-lg border bg-muted/30" /> },
);

type AbastecimentoDetalhe = {
  id: string;
  data: string;
  tipo: string;
  litros: string;
  valorTotal: string;
  precoLitro: string | null;
  odometro: number;
  postoNome: string | null;
  tanqueCheio: boolean;
  observacao: string | null;
  lat: number | null;
  lng: number | null;
  precisao: number | null;
  veiculo: { id: string; placa: string; modelo: string | null };
  motorista: { id: string; nome: string; usuario: string };
  fotos: { id: string; storageKey: string; capturadaEm: string }[];
  sincronizadoEm: string;
};

const TIPO_LABEL: Record<string, string> = {
  DIESEL_S10: "Diesel S10",
  DIESEL_S500: "Diesel S500",
  ARLA_32: "ARLA 32",
  GASOLINA: "Gasolina",
  ETANOL: "Etanol",
};

export default function AbastecimentoDetalhePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const token = useAuthToken();
  const a = useQuery({
    queryKey: ["abastecimento-admin", id],
    enabled: !!token,
    queryFn: () =>
      fetchApi<AbastecimentoDetalhe>(`/admin/abastecimentos/${id}`, { token }),
  });

  if (a.isLoading)
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  if (!a.data)
    return <p className="text-sm text-red-600">Abastecimento não encontrado.</p>;

  const x = a.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/abastecimentos"
          className="rounded p-1 hover:bg-muted"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Abastecimento
          </h1>
          <p className="text-sm text-muted-foreground">
            {fmtDataHora(x.data)} · {x.veiculo.placa} · {x.motorista.nome}
          </p>
        </div>
        <Badge>{TIPO_LABEL[x.tipo] ?? x.tipo}</Badge>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Dados do abastecimento
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Info
              icon={Fuel}
              label="Litros"
              value={`${fmtNum(x.litros, 3)} L`}
            />
            <Info
              label="Valor total"
              value={`R$ ${fmtNum(x.valorTotal, 2)}`}
            />
            <Info
              label="Preço por litro"
              value={x.precoLitro ? `R$ ${fmtNum(x.precoLitro, 3)}/L` : "—"}
            />
            <Info
              icon={Gauge}
              label="Odômetro"
              value={`${x.odometro.toLocaleString("pt-BR")} km`}
            />
            <Info
              label="Tanque cheio"
              value={x.tanqueCheio ? "Sim" : "Não"}
            />
            <Info label="Tipo" value={TIPO_LABEL[x.tipo] ?? x.tipo} />
          </div>

          <div className="border-t pt-4">
            <Info
              icon={MapPin}
              label="Posto"
              value={x.postoNome ?? "Não informado"}
            />
            {x.observacao && (
              <div className="mt-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Observação
                </p>
                <p className="text-sm">{x.observacao}</p>
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <Info
              icon={UserIcon}
              label="Motorista"
              value={`${x.motorista.nome} (${x.motorista.usuario})`}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Veículo: {x.veiculo.placa}
              {x.veiculo.modelo ? ` · ${x.veiculo.modelo}` : ""}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sincronizado em {fmtDataHora(x.sincronizadoEm)}
            </p>
          </div>
        </Card>

        <div className="space-y-4">
          {x.lat !== null && x.lng !== null ? (
            <Card className="space-y-3 p-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Local do abastecimento
              </h2>
              <PontoMap
                lat={x.lat}
                lng={x.lng}
                label={x.postoNome ?? "Abastecimento"}
              />
              <p className="font-mono text-xs text-muted-foreground">
                {x.lat.toFixed(6)}, {x.lng.toFixed(6)}
                {x.precisao !== null && ` · precisão ${x.precisao.toFixed(0)}m`}
              </p>
            </Card>
          ) : (
            <Card className="p-5">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Local do abastecimento
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Coordenadas não capturadas (GPS indisponível ou permissão negada).
              </p>
            </Card>
          )}

          {x.fotos.length > 0 && (
            <Card className="space-y-3 p-5">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                <Camera className="h-4 w-4" />
                Fotos do comprovante
              </h2>
              <div className="grid grid-cols-2 gap-3">
                {x.fotos.map((f) => (
                  <FotoThumb
                    key={f.id}
                    abastecimentoId={x.id}
                    fotoId={f.id}
                    token={token}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}

function FotoThumb({
  abastecimentoId,
  fotoId,
  token,
}: {
  abastecimentoId: string;
  fotoId: string;
  token: string | undefined;
}) {
  const q = useQuery({
    queryKey: ["abastecimento-foto-blob", abastecimentoId, fotoId],
    enabled: !!token,
    staleTime: 30 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";
      const res = await fetch(
        `${apiUrl}/admin/abastecimentos/${abastecimentoId}/fotos/${fotoId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
  });

  if (q.isLoading || !q.data) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-md border bg-muted text-xs text-muted-foreground">
        carregando...
      </div>
    );
  }

  return (
    <a
      href={q.data}
      target="_blank"
      rel="noopener"
      className="aspect-square overflow-hidden rounded-md border bg-muted transition-opacity hover:opacity-80"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={q.data} alt="Comprovante" className="h-full w-full object-cover" />
    </a>
  );
}

function fmtDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
