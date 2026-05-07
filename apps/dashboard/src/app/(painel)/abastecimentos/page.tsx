"use client";

import Link from "next/link";
import { useState } from "react";
import { Camera, ExternalLink, Filter, Fuel } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { fmtNum } from "@/lib/fechamento-helpers";
import { useQuery } from "@tanstack/react-query";

type Abastecimento = {
  id: string;
  data: string;
  tipo: string;
  litros: string;
  valorTotal: string;
  precoLitro: string | null;
  odometro: number;
  postoNome: string | null;
  tanqueCheio: boolean;
  veiculo: { id: string; placa: string; modelo: string | null };
  motorista: { id: string; nome: string };
  _count: { fotos: number };
};

type ListaAbastecimentos = {
  itens: Abastecimento[];
  totais: { count: number; litros: string; valor: string };
};

const TIPO_LABEL: Record<string, string> = {
  DIESEL_S10: "Diesel S10",
  DIESEL_S500: "Diesel S500",
  ARLA_32: "ARLA 32",
  GASOLINA: "Gasolina",
  ETANOL: "Etanol",
};

const TIPO_COLOR: Record<string, string> = {
  DIESEL_S10: "bg-blue-100 text-blue-800 border-blue-200",
  DIESEL_S500: "bg-indigo-100 text-indigo-800 border-indigo-200",
  ARLA_32: "bg-cyan-100 text-cyan-800 border-cyan-200",
  GASOLINA: "bg-amber-100 text-amber-900 border-amber-200",
  ETANOL: "bg-green-100 text-green-800 border-green-200",
};

export default function AbastecimentosPage() {
  const token = useAuthToken();
  const [tipo, setTipo] = useState<string>("");
  const list = useQuery({
    queryKey: ["abastecimentos-admin", tipo],
    enabled: !!token,
    queryFn: () =>
      fetchApi<ListaAbastecimentos>(
        `/admin/abastecimentos${tipo ? `?tipo=${tipo}` : ""}`,
        { token },
      ),
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Abastecimentos</h1>
          <p className="text-sm text-muted-foreground">
            Combustível registrado pelos motoristas, com odômetro e foto.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            className="w-full md:w-48"
          >
            <option value="">Todos os tipos</option>
            <option value="DIESEL_S10">Diesel S10</option>
            <option value="DIESEL_S500">Diesel S500</option>
            <option value="ARLA_32">ARLA 32</option>
            <option value="GASOLINA">Gasolina</option>
            <option value="ETANOL">Etanol</option>
          </Select>
        </div>
      </header>

      {/* Card resumo */}
      {list.data && list.data.totais.count > 0 && (
        <Card className="grid grid-cols-3 gap-4 p-4">
          <Resumo label="Abastecimentos" value={list.data.totais.count.toLocaleString("pt-BR")} />
          <Resumo
            label="Litros"
            value={`${fmtNum(list.data.totais.litros, 2)} L`}
          />
          <Resumo
            label="Valor total"
            value={`R$ ${fmtNum(list.data.totais.valor, 2)}`}
          />
        </Card>
      )}

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {list.isLoading && (
          <Card className="p-4 text-sm text-muted-foreground">Carregando...</Card>
        )}
        {list.data?.itens.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhum abastecimento nesse filtro.
          </Card>
        )}
        {list.data?.itens.map((a) => (
          <Link key={a.id} href={`/abastecimentos/${a.id}`} className="block">
            <Card className="space-y-3 p-4 hover:bg-muted/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {a.postoNome ?? "Posto não informado"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtData(a.data)} · {a.veiculo.placa} · {a.motorista.nome}
                  </p>
                </div>
                <Badge className={TIPO_COLOR[a.tipo] ?? ""}>
                  {TIPO_LABEL[a.tipo] ?? a.tipo}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs">
                <span>
                  <span className="text-muted-foreground">L: </span>
                  <span className="font-medium">{fmtNum(a.litros, 2)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">R$: </span>
                  <span className="font-medium">{fmtNum(a.valorTotal, 2)}</span>
                </span>
                {a.precoLitro && (
                  <span>
                    <span className="text-muted-foreground">R$/L: </span>
                    <span className="font-medium">{fmtNum(a.precoLitro, 3)}</span>
                  </span>
                )}
                <span>
                  <span className="text-muted-foreground">km: </span>
                  <span className="font-mono">
                    {a.odometro.toLocaleString("pt-BR")}
                  </span>
                </span>
                {a._count.fotos > 0 && (
                  <span className="flex items-center gap-1">
                    <Camera className="h-3 w-3" />
                    {a._count.fotos}
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
              <TableHead>Tipo</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Placa</TableHead>
              <TableHead>Motorista</TableHead>
              <TableHead>Posto</TableHead>
              <TableHead>Litros</TableHead>
              <TableHead>R$ total</TableHead>
              <TableHead>R$/L</TableHead>
              <TableHead>Odômetro</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={10}>Carregando...</TableCell>
              </TableRow>
            )}
            {list.data?.itens.map((a) => (
              <TableRow key={a.id}>
                <TableCell>
                  <Badge className={TIPO_COLOR[a.tipo] ?? ""}>
                    {TIPO_LABEL[a.tipo] ?? a.tipo}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{fmtData(a.data)}</TableCell>
                <TableCell className="font-mono text-sm">
                  {a.veiculo.placa}
                </TableCell>
                <TableCell className="text-sm">{a.motorista.nome}</TableCell>
                <TableCell className="text-sm">
                  {a.postoNome ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-sm">{fmtNum(a.litros, 2)}</TableCell>
                <TableCell className="text-sm">
                  R$ {fmtNum(a.valorTotal, 2)}
                </TableCell>
                <TableCell className="text-sm">
                  {a.precoLitro ? `R$ ${fmtNum(a.precoLitro, 3)}` : "—"}
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {a.odometro.toLocaleString("pt-BR")}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {a._count.fotos > 0 && (
                      <Camera className="h-4 w-4 text-muted-foreground" />
                    )}
                    <Link href={`/abastecimentos/${a.id}`}>
                      <span className="rounded p-1 hover:bg-muted">
                        <ExternalLink className="h-4 w-4" />
                      </span>
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {list.data?.itens.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="py-8 text-center text-muted-foreground"
                >
                  <Fuel className="mx-auto mb-2 h-8 w-8 opacity-40" />
                  Nenhum abastecimento nesse filtro.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function Resumo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function fmtData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

