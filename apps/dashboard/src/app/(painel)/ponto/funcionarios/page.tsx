"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { RequerTela } from "@/components/requer-tela";
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
import { EstadoVazio } from "@/components/estado-vazio";
import { fetchApi, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";
import { usePermissoes } from "@/lib/permissoes";
import { PATH, PrecisaFundamento, useConfigPonto } from "../_lib";

type Funcionario = {
  id: string;
  nome: string;
  cpf: string;
  cargo: string | null;
  matricula: string | null;
  admitidoEm: string;
  desligadoEm: string | null;
  ativo: boolean;
  jornadas: { modelo: { id: string; nome: string }; vigenteDe: string }[];
};

type Modelo = { id: string; nome: string };

/**
 * QUEM BATE PONTO — o cadastro de funcionário registrado.
 *
 * ⚠️ NÃO é a tela de Motoristas, e a diferença não é de organização: aquele
 * é o cadastro de PARCEIRO AUTÔNOMO. A mesma pessoa não pode estar nos dois,
 * e quem impede é o banco: contratar alguém que já tem contrato de parceiro
 * ativo devolve 409 dizendo o que encerrar antes.
 */
export default function FuncionariosPage() {
  return (
    <RequerTela chave="funcionarios.ver">
      <Conteudo />
    </RequerTela>
  );
}

function Conteudo() {
  const token = useAuthToken();
  const { temPermissao } = usePermissoes();
  const [novo, setNovo] = useState(false);
  const [inativos, setInativos] = useState(false);
  const config = useConfigPonto();

  const lista = useQuery({
    queryKey: [PATH, "funcionarios", inativos],
    enabled: !!token,
    queryFn: () =>
      fetchApi<Funcionario[]>(`${PATH}/funcionarios?inativos=${inativos}`, { token }),
  });

  if (config.data && !config.data.fundamento) return <PrecisaFundamento />;

  const itens = lista.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Users className="h-6 w-6 text-muted-foreground" />
            Quem bate ponto
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Funcionário registrado em carteira. Quem é parceiro autônomo fica na tela de
            Motoristas — a mesma pessoa não pode estar nos dois.
          </p>
        </div>
        {temPermissao("funcionarios.criar") && (
          <Button onClick={() => setNovo(true)}>
            <Plus className="mr-1 h-4 w-4" /> Registrar contratação
          </Button>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} />
        Mostrar quem já foi desligado
      </label>

      {itens.length === 0 ? (
        <EstadoVazio
          titulo="Ninguém cadastrado"
          descricao="Registre a contratação de quem é CLT para ele começar a bater ponto pelo app."
        />
      ) : (
        <Card className="divide-y p-0">
          {itens.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-56 flex-1">
                <Link href={`/ponto/espelho/${f.id}`} className="font-medium hover:underline">
                  {f.nome}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {f.cargo ?? "sem cargo"} · CPF {f.cpf}
                  {f.matricula ? ` · matrícula ${f.matricula}` : ""}
                </span>
              </div>
              <div className="text-sm">
                {f.jornadas[0] ? (
                  f.jornadas[0].modelo.nome
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">sem jornada definida</span>
                )}
              </div>
              {!f.ativo && (
                <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  desligado
                </span>
              )}
              {f.ativo && temPermissao("funcionarios.desligar") && <Desligar id={f.id} nome={f.nome} />}
            </div>
          ))}
        </Card>
      )}

      {novo && <DialogContratar onFechar={() => setNovo(false)} />}
    </div>
  );
}

function DialogContratar({ onFechar }: { onFechar: () => void }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    nome: "",
    cpf: "",
    cargo: "",
    matricula: "",
    admitidoEm: hojeSP(),
    modeloJornadaId: "",
  });

  const modelos = useQuery({
    queryKey: [PATH, "jornadas"],
    enabled: !!token,
    queryFn: () => fetchApi<Modelo[]>(`${PATH}/jornadas`, { token }),
  });

  const criar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/funcionarios`, {
        token,
        method: "POST",
        body: JSON.stringify({
          nome: form.nome.trim(),
          cpf: form.cpf.replace(/\D/g, ""),
          cargo: form.cargo || undefined,
          matricula: form.matricula || undefined,
          admitidoEm: form.admitidoEm,
          modeloJornadaId: form.modeloJornadaId || undefined,
        }),
      }),
    onSuccess: () => {
      toast.success("Contratação registrada.", {
        description: "Ele já pode bater o ponto pelo aplicativo, com o CPF dele.",
      });
      void qc.invalidateQueries({ queryKey: [PATH, "funcionarios"] });
      onFechar();
    },
    onError: (e: Error) => toast.error("Não consegui registrar", { description: e.message }),
  });

  return (
    <Dialog open onOpenChange={onFechar}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar contratação</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="func-nome">Nome completo</Label>
            <Input
              id="func-nome"
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="func-cpf">CPF</Label>
              <Input
                id="func-cpf"
                inputMode="numeric"
                value={form.cpf}
                onChange={(e) => setForm({ ...form, cpf: e.target.value })}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                É por ele que o aplicativo reconhece a pessoa — e é o que impede a mesma pessoa
                estar como parceiro autônomo ao mesmo tempo.
              </p>
            </div>
            <div>
              <Label htmlFor="func-admissao">Admitido em</Label>
              <Input
                id="func-admissao"
                type="date"
                value={form.admitidoEm}
                onChange={(e) => setForm({ ...form, admitidoEm: e.target.value })}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label htmlFor="func-cargo">Cargo</Label>
              <Input
                id="func-cargo"
                value={form.cargo}
                onChange={(e) => setForm({ ...form, cargo: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="func-matricula">Matrícula</Label>
              <Input
                id="func-matricula"
                value={form.matricula}
                onChange={(e) => setForm({ ...form, matricula: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="func-jornada">Jornada</Label>
            <Select
              id="func-jornada"
              value={form.modeloJornadaId}
              onChange={(e) => setForm({ ...form, modeloJornadaId: e.target.value })}
            >
              <option value="">Definir depois</option>
              {(modelos.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Sem jornada não existe previsto, e sem previsto o espelho não fecha.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={form.nome.trim().length < 3 || form.cpf.replace(/\D/g, "").length !== 11 || criar.isPending}
            onClick={() => criar.mutate()}
          >
            {criar.isPending ? "Registrando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Desligar({ id, nome }: { id: string; nome: string }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState({ desligadoEm: hojeSP(), motivo: "" });

  const salvar = useMutation({
    mutationFn: () =>
      fetchApi(`${PATH}/funcionarios/${id}/desligar`, {
        token,
        method: "POST",
        body: JSON.stringify(form),
      }),
    onSuccess: () => {
      toast.success("Desligamento registrado.", {
        description: "Ele para de bater ponto, mas continua enxergando os próprios registros.",
      });
      void qc.invalidateQueries({ queryKey: [PATH, "funcionarios"] });
      setAberto(false);
    },
    onError: (e: Error) => toast.error("Não consegui desligar", { description: e.message }),
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        Desligar
      </Button>
      {aberto && (
        <Dialog open onOpenChange={() => setAberto(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Desligar {nome}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="desl-data">Último dia</Label>
                <Input
                  id="desl-data"
                  type="date"
                  value={form.desligadoEm}
                  onChange={(e) => setForm({ ...form, desligadoEm: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="desl-motivo">Motivo</Label>
                <Input
                  id="desl-motivo"
                  value={form.motivo}
                  onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Ele para de registrar e o CPF fica livre — pode virar parceiro autônomo depois. O
                espelho e os comprovantes continuam disponíveis pra ele no app.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAberto(false)}>
                Cancelar
              </Button>
              <Button
                variant="destructive"
                disabled={form.motivo.trim().length < 3 || salvar.isPending}
                onClick={() => salvar.mutate()}
              >
                {salvar.isPending ? "Registrando…" : "Registrar desligamento"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
