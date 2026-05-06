"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Plus, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtBR, fmtDataHoraBR } from "@/lib/fechamento-helpers";
import {
  useBaixarArquivo,
  useEnvios,
  useMarcarEnvioEnviado,
  type EnvioStandalone,
} from "@/lib/fechamentos-api";

export default function EnviosPage() {
  const list = useEnvios({});
  const marcar = useMarcarEnvioEnviado();
  const baixar = useBaixarArquivo();
  const [editando, setEditando] = useState<EnvioStandalone | null>(null);
  const [canalEnvio, setCanalEnvio] = useState("WhatsApp");
  const [observacao, setObservacao] = useState("");

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Envios</h1>
          <p className="text-sm text-muted-foreground">
            Planilhas geradas pra mandar pras empresas-cliente que recebem o fechamento.
          </p>
        </div>
        <Link href="/envios/novo">
          <Button className="w-full md:w-auto">
            <Plus className="h-4 w-4" /> Novo envio
          </Button>
        </Link>
      </header>

      <div className="space-y-3 md:hidden">
        {list.isLoading && (
          <Card className="p-4 text-sm text-muted-foreground">Carregando...</Card>
        )}
        {list.data?.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">
            Nenhum envio gerado ainda.
          </Card>
        )}
        {list.data?.map((e) => {
          const periodoInicio = e.periodoInicio ?? e.fechamento?.periodoInicio;
          const periodoFim = e.periodoFim ?? e.fechamento?.periodoFim;
          return (
            <Card key={e.id} className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {e.empresaCliente?.nome ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtBR(periodoInicio)} → {fmtBR(periodoFim)}
                  </p>
                </div>
                {e.status === "ENVIADO" ? (
                  <Badge className="shrink-0 border-green-200 bg-green-50 text-green-800">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Enviado
                  </Badge>
                ) : (
                  <Badge className="shrink-0 border-blue-200 bg-blue-50 text-blue-800">
                    Gerado
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                {e.fechamentoId ? (
                  <span className="text-purple-700">
                    Fechamento v{e.fechamento?.versao}
                  </span>
                ) : (
                  <span className="text-blue-700">Direto</span>
                )}
                {e.totalLinhas != null && (
                  <span>
                    <span className="text-muted-foreground">Linhas: </span>
                    {e.totalLinhas}
                  </span>
                )}
                {e.layout?.nome && (
                  <span className="text-muted-foreground">{e.layout.nome}</span>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Período</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Linhas</TableHead>
              <TableHead>Layout</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Gerado em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading && (
              <TableRow>
                <TableCell colSpan={8}>Carregando...</TableCell>
              </TableRow>
            )}
            {list.data?.map((e) => {
              const periodoInicio = e.periodoInicio ?? e.fechamento?.periodoInicio;
              const periodoFim = e.periodoFim ?? e.fechamento?.periodoFim;
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">
                    {e.empresaCliente?.nome ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {fmtBR(periodoInicio)} → {fmtBR(periodoFim)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {e.fechamentoId ? (
                      <Badge className="border-purple-200 bg-purple-50 text-purple-800">
                        Fechamento v{e.fechamento?.versao}
                      </Badge>
                    ) : (
                      <Badge className="border-blue-200 bg-blue-50 text-blue-800">
                        Direto
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{e.totalLinhas ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.layout?.nome ?? "—"}
                  </TableCell>
                  <TableCell>
                    {e.status === "ENVIADO" ? (
                      <Badge className="border-green-200 bg-green-50 text-green-800">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Enviado
                      </Badge>
                    ) : (
                      <Badge className="border-blue-200 bg-blue-50 text-blue-800">
                        Gerado
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {fmtDataHoraBR(e.geradoEm)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Baixar"
                        onClick={() =>
                          baixar(`/admin/envios/${e.id}/download`, e.arquivoNome)
                        }
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      {e.status === "GERADO" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setEditando(e)}
                          title="Marcar como enviado"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {list.data?.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  Nenhum envio gerado ainda. Clique em "Novo envio" pra gerar a planilha pra
                  uma empresa-cliente.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!editando} onOpenChange={(open) => !open && setEditando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Marcar como enviado</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Canal de envio</Label>
              <Select value={canalEnvio} onChange={(e) => setCanalEnvio(e.target.value)}>
                <option>WhatsApp</option>
                <option>E-mail</option>
                <option>Entregue pessoalmente</option>
                <option>Outro</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Observação (opcional)</Label>
              <Input
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder='ex: "enviado no grupo da Construtora X"'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={marcar.isPending}
              onClick={async () => {
                if (!editando) return;
                await marcar.mutateAsync({
                  envioId: editando.id,
                  canalEnvio,
                  observacao: observacao || undefined,
                });
                setEditando(null);
                setObservacao("");
              }}
            >
              <Send className="h-4 w-4" /> Confirmar envio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
