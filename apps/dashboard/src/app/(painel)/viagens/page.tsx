"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUp, Camera, ExternalLink, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LoadingCard, LoadingInline } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { fmtBR, fmtNum } from "@/lib/fechamento-helpers";
import { useQuery } from "@tanstack/react-query";

type Viagem = {
  id: string;
  data: string;
  toneladas: string;
  ticket: string;
  km: string;
  status: string;
  veiculo: { id: string; placa: string };
  motorista: { id: string; nome: string };
  obra: { id: string; nome: string };
  material: { id: string; nome: string };
  localCarga: { id: string; nome: string; cidade: string; uf: string };
  localDescarga: { id: string; nome: string; cidade: string; uf: string };
  fotos: { id: string; storageKey: string }[];
};

const STATUS_VIAGEM_LABEL: Record<string, string> = {
  ENVIADA: "Aguardando",
  EM_CONFERENCIA: "Em conferência",
  OK: "OK",
  DIVERGENTE: "Divergente",
  AJUSTADA: "Ajustada",
  RASCUNHO_OFFLINE: "Rascunho",
};

const STATUS_VIAGEM_COLOR: Record<string, string> = {
  ENVIADA: "bg-amber-100 text-amber-900 border-amber-200",
  EM_CONFERENCIA: "bg-purple-100 text-purple-800 border-purple-200",
  OK: "bg-green-100 text-green-800 border-green-200",
  DIVERGENTE: "bg-red-100 text-red-800 border-red-200",
  AJUSTADA: "bg-blue-100 text-blue-800 border-blue-200",
  RASCUNHO_OFFLINE: "bg-gray-100 text-gray-700 border-gray-200",
};

export default function ViagensPage() {
  const token = useAuthToken();
  const [status, setStatus] = useState<string>("");
  const list = useQuery({
    queryKey: ["viagens-admin", status],
    enabled: !!token,
    queryFn: () =>
      fetchApi<Viagem[]>(`/admin/viagens${status ? `?status=${status}` : ""}`, { token }),
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Viagens</h1>
          <p className="text-sm text-muted-foreground">
            Lançamentos dos motoristas, com status visual de conferência.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full md:w-48"
          >
            <option value="">Todos os status</option>
            <option value="ENVIADA">Aguardando</option>
            <option value="EM_CONFERENCIA">Em conferência</option>
            <option value="OK">OK</option>
            <option value="DIVERGENTE">Divergente</option>
            <option value="AJUSTADA">Ajustada</option>
          </Select>
        </div>
      </header>

      {/* Mobile: cards verticais */}
      <div className="space-y-3 md:hidden">
        {list.isLoading && (
          <LoadingCard />
        )}
        {list.data?.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma viagem nesse filtro.
          </Card>
        )}
        {list.data?.map((v) => (
          <Link key={v.id} href={`/viagens/${v.id}`} className="block">
            <Card className="space-y-3 p-4 hover:bg-muted/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{v.obra.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtBR(v.data)} · {v.veiculo.placa} · {v.motorista.nome}
                  </p>
                </div>
                <Badge className={STATUS_VIAGEM_COLOR[v.status] ?? ""}>
                  {STATUS_VIAGEM_LABEL[v.status] ?? v.status}
                </Badge>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-1.5">
                  <ArrowUp className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{v.localCarga.nome}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ArrowDown className="h-3 w-3 text-muted-foreground" />
                  <span className="truncate">{v.localDescarga.nome}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs">
                <span>
                  <span className="text-muted-foreground">Material: </span>
                  {v.material.nome}
                </span>
                <span>
                  <span className="text-muted-foreground">T: </span>
                  <span className="font-medium">{fmtNum(v.toneladas, 3)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">km: </span>
                  <span className="font-medium">{fmtNum(v.km, 2)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">Ticket: </span>
                  <span className="font-mono">{v.ticket}</span>
                </span>
                {v.fotos.length > 0 && (
                  <span className="flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    {v.fotos.length}
                  </span>
                )}
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Desktop: tabela */}
      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Placa</TableHead>
              <TableHead>Motorista</TableHead>
              <TableHead>Material / Obra</TableHead>
              <TableHead>Trajeto</TableHead>
              <TableHead>Toneladas</TableHead>
              <TableHead>Ticket</TableHead>
              <TableHead>Km</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={10}><LoadingInline /></TableCell>
              </TableRow>
            )}
            {list.data?.map((v) => (
              <TableRow key={v.id}>
                <TableCell>
                  <Badge className={STATUS_VIAGEM_COLOR[v.status] ?? ""}>
                    {STATUS_VIAGEM_LABEL[v.status] ?? v.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{fmtBR(v.data)}</TableCell>
                <TableCell className="font-mono text-sm">{v.veiculo.placa}</TableCell>
                <TableCell className="text-sm">{v.motorista.nome}</TableCell>
                <TableCell className="text-sm">
                  <div className="font-medium">{v.material.nome}</div>
                  <div className="text-xs text-muted-foreground">{v.obra.nome}</div>
                </TableCell>
                <TableCell className="text-xs">
                  <div className="flex items-center gap-1">
                    <ArrowUp className="h-3 w-3 text-muted-foreground" />
                    {v.localCarga.nome.length > 28
                      ? v.localCarga.nome.slice(0, 25) + "..."
                      : v.localCarga.nome}
                  </div>
                  <div className="flex items-center gap-1">
                    <ArrowDown className="h-3 w-3 text-muted-foreground" />
                    {v.localDescarga.nome.length > 28
                      ? v.localDescarga.nome.slice(0, 25) + "..."
                      : v.localDescarga.nome}
                  </div>
                </TableCell>
                <TableCell className="text-sm">{fmtNum(v.toneladas, 3)}</TableCell>
                <TableCell className="font-mono text-sm">{v.ticket}</TableCell>
                <TableCell className="text-sm">{fmtNum(v.km, 2)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {v.fotos.length > 0 && (
                      <Camera className="h-4 w-4 text-muted-foreground" />
                    )}
                    <Link href={`/viagens/${v.id}`}>
                      <span className="rounded p-1 hover:bg-muted">
                        <ExternalLink className="h-4 w-4" />
                      </span>
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                  Nenhuma viagem nesse filtro.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
