"use client";

import { useState } from "react";
import {
  Camera,
  DollarSign,
  FileText,
  Flag,
  MapPin,
  MessageSquare,
  Pencil,
  Plus,
  Repeat,
  Ticket,
  Weight,
} from "lucide-react";
import type { TipoEventoViagem } from "@ronan/shared-types";
import { StatusToggle } from "@/components/status-toggle";
import { Permitido, RequerTela } from "@/components/requer-tela";
import { ExcluirButton } from "@/components/excluir-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApiQuery, useUpdateResource } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { TipoEventoDialog } from "./_components/tipo-evento-dialog";

const PATH = "/admin/tipos-evento-viagem";

// Ícones do "o que pede", só quando o flag está ligado.
const PEDE_ICONES: { key: keyof TipoEventoViagem; label: string; Icon: typeof MapPin }[] = [
  { key: "pedeGps", label: "GPS", Icon: MapPin },
  { key: "pedeFoto", label: "Foto", Icon: Camera },
  { key: "pedeToneladas", label: "Toneladas", Icon: Weight },
  { key: "pedeValor", label: "Valor", Icon: DollarSign },
  { key: "pedeTicket", label: "Ticket", Icon: Ticket },
  { key: "pedeObservacao", label: "Observação", Icon: MessageSquare },
];

function FlagsMarco({ t }: { t: TipoEventoViagem }) {
  const badges: React.ReactNode[] = [];
  if (t.obrigatorio)
    badges.push(
      <Badge key="obr" className="border-transparent bg-red-100 text-red-700">
        <Flag className="mr-1 h-3 w-3" /> Obrigatório
      </Badge>,
    );
  if (t.repetivel)
    badges.push(
      <Badge key="rep" className="border-transparent bg-blue-100 text-blue-700">
        <Repeat className="mr-1 h-3 w-3" /> Repetível
      </Badge>,
    );
  if (t.ehCarga)
    badges.push(
      <Badge key="car" className="border-transparent bg-amber-100 text-amber-700">
        Carga
      </Badge>,
    );
  if (t.ehDescarga)
    badges.push(
      <Badge key="des" className="border-transparent bg-emerald-100 text-emerald-700">
        Descarga
      </Badge>,
    );
  if (badges.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return <div className="flex flex-wrap gap-1">{badges}</div>;
}

function PedeIcones({ t }: { t: TipoEventoViagem }) {
  const ativos = PEDE_ICONES.filter((p) => t[p.key]);
  if (ativos.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5 text-muted-foreground">
      {ativos.map(({ key, label, Icon }) => (
        <span key={key} title={label} className="inline-flex items-center">
          <Icon className="h-4 w-4" />
        </span>
      ))}
    </div>
  );
}

export default function TiposEventoViagemPage() {
  const { temPermissao } = usePermissoes();
  const list = useApiQuery<TipoEventoViagem[]>(PATH);
  const update = useUpdateResource<{ ativo?: boolean }, TipoEventoViagem>(PATH, PATH);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<TipoEventoViagem | undefined>(undefined);
  // Bump força a remontagem do dialog pra resetar o estado do form ao trocar de item.
  const [dialogKey, setDialogKey] = useState(0);

  function abrirNovo() {
    setEditando(undefined);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  function abrirEdicao(t: TipoEventoViagem) {
    setEditando(t);
    setDialogKey((k) => k + 1);
    setDialogOpen(true);
  }

  const podeEditar = temPermissao("tipos-evento-viagem.editar");
  const dados = list.data ?? [];

  return (
    <RequerTela chave="tipos-evento-viagem.ver">
      <div className="space-y-6">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Eventos da viagem</h1>
            <p className="text-sm text-muted-foreground">
              Catálogo de eventos que o motorista registra durante a viagem. A ordem define a
              sequência guiada no app; &quot;obrigatório&quot; é um marco que bloqueia finalizar.
            </p>
          </div>
          <Permitido chave="tipos-evento-viagem.criar">
            <Button onClick={abrirNovo}>
              <Plus className="h-4 w-4" /> Novo evento
            </Button>
          </Permitido>
        </header>

        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 text-center">Ordem</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Comportamento</TableHead>
                <TableHead>Pede</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-24 text-center">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    Carregando…
                  </TableCell>
                </TableRow>
              )}
              {!list.isLoading && dados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    Nenhum evento cadastrado.
                  </TableCell>
                </TableRow>
              )}
              {dados.map((t) => (
                <TableRow key={t.id} className={t.ativo ? undefined : "opacity-60"}>
                  <TableCell className="text-center tabular-nums">{t.ordem}</TableCell>
                  <TableCell className="font-medium">{t.nome}</TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{t.slug}</code>
                  </TableCell>
                  <TableCell>
                    <FlagsMarco t={t} />
                  </TableCell>
                  <TableCell>
                    <PedeIcones t={t} />
                  </TableCell>
                  <TableCell>
                    {podeEditar ? (
                      <StatusToggle
                        active={t.ativo}
                        onChange={(next) => update.mutate({ id: t.id, body: { ativo: next } })}
                        size="sm"
                        label
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t.ativo ? "ativo" : "inativo"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-center">
                      <Permitido chave="tipos-evento-viagem.editar">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Editar"
                          onClick={() => abrirEdicao(t)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Permitido>
                      <ExcluirButton
                        perm="tipos-evento-viagem.excluir"
                        path={PATH}
                        id={t.id}
                        nomeRecurso={`o evento "${t.nome}"`}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5 shrink-0" />
          Excluir um evento que já tem registros históricos apenas o desativa (soft-delete), pra não
          quebrar viagens antigas.
        </p>

        <TipoEventoDialog
          key={dialogKey}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initial={editando}
        />
      </div>
    </RequerTela>
  );
}
