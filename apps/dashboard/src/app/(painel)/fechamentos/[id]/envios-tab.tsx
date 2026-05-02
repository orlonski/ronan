"use client";

import { useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Send } from "lucide-react";
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
import { fmtDataHoraBR } from "@/lib/fechamento-helpers";
import {
  useBaixarArquivo,
  useMarcarEnviado,
  type EnvioFechamento,
  type FechamentoDetalhe,
} from "@/lib/fechamentos-api";

export function EnviosTab({ fechamento }: { fechamento: FechamentoDetalhe }) {
  const marcar = useMarcarEnviado(fechamento.id);
  const baixar = useBaixarArquivo();
  const [editando, setEditando] = useState<EnvioFechamento | null>(null);
  const [canalEnvio, setCanalEnvio] = useState("WhatsApp");
  const [observacao, setObservacao] = useState("");

  if (fechamento.envios.length === 0) {
    return (
      <Card className="p-8 text-center">
        <FileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Nenhuma planilha gerada ainda. Use o botão <strong>Exportar planilha</strong> no topo
          quando todas as divergências estiverem conferidas.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {fechamento.envios.map((e) => (
        <Card key={e.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{e.arquivoNome}</span>
                {e.status === "ENVIADO" ? (
                  <Badge className="border-green-200 bg-green-50 text-green-800">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Enviado
                  </Badge>
                ) : (
                  <Badge className="border-blue-200 bg-blue-50 text-blue-800">Gerado</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Gerado por {e.geradoPor?.nome ?? "—"} em {fmtDataHoraBR(e.geradoEm)}
                {e.layout?.nome && ` · layout "${e.layout.nome}"`}
              </p>
              {e.status === "ENVIADO" && (
                <p className="text-xs text-green-700">
                  Enviado em {fmtDataHoraBR(e.marcadoEnviadoEm)} via{" "}
                  <strong>{e.canalEnvio}</strong>
                  {e.observacao && ` — ${e.observacao}`}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  baixar(
                    `/admin/envios/${e.id}/download`,
                    e.arquivoNome,
                  )
                }
              >
                <Download className="h-4 w-4" /> Baixar
              </Button>
              {e.status === "GERADO" && (
                <Button size="sm" onClick={() => setEditando(e)}>
                  <Send className="h-4 w-4" /> Marcar como enviado
                </Button>
              )}
            </div>
          </div>
        </Card>
      ))}

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
                placeholder='ex: "enviado pra o Ronan no grupo da Gamerim"'
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
              Confirmar envio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
