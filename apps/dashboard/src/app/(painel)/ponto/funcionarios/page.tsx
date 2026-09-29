"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Smartphone, Users } from "lucide-react";
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
import { apiBaseUrl, fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { hojeSP } from "@/lib/datetime-br";
import { usePermissoes } from "@/lib/permissoes";
import { MotoristaCombobox } from "@/components/fk-comboboxes";
import { maskCpf } from "../../motoristas/_components/motorista-form";
import { AcessoAppCard } from "../../motoristas/[id]/acesso-app-card";
import { DocumentosDoFuncionario } from "./documentos-funcionario";
import { ComecarPonto, PATH, PrecisaFundamento, useConfigPonto } from "../_lib";

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
 * ⚠️ NÃO é a tela de Motoristas: aquele é o cadastro de quem DIRIGE. O
 * motorista CLT da própria transportadora está nos dois de propósito — dirige
 * pelo cadastro de motorista e bate ponto por este.
 *
 * O que não pode é outra coisa: a mesma pessoa ser REGISTRADA e PARCEIRA ao
 * mesmo tempo (paga por produção e por folha). Quem impede é o banco,
 * pelo `RegimeVigente`: contratar alguém com regime de parceiro vivo devolve
 * 409 dizendo o que encerrar antes. Esta frase dizia "não pode estar nos
 * dois cadastros", e contradizia a ficha do motorista e a tela de perfis.
 */
/**
 * O que a empresa pede de quem é registrado — o cadastro mora em Minha
 * empresa › Documentos que pedimos, mas quem pensa nisso está aqui, olhando
 * pros registrados. Conta TUDO que está ativo: desde 23/09/2026 são só dois
 * públicos, e os dois chegam ao registrado — `REGISTRADOS` pelo cadastro de
 * funcionário e `TODOS` ("todo mundo, motoristas também") também, pelo de
 * funcionário ou, se ele for motorista CLT, pelo de motorista
 * (`exigidosDoRegistrado` na API). Por isso o link abre a lista sem filtro:
 * o número tem que bater com o que a pessoa vê lá.
 */
function DocumentosQuePedimos() {
  const { temPermissao, temModulo } = usePermissoes();
  const ve = temPermissao("documentos-exigidos.ver") && temModulo("documentos-exigidos.ver");
  const lista = useApiQuery<{ publico?: string; ativo: boolean }[]>(
    ve ? "/admin/admissao/documentos-exigidos" : undefined,
  );
  if (!ve || !lista.data) return null;
  const n = lista.data.filter((e) => e.ativo).length;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="flex items-center gap-2 text-sm">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span>
          <strong>Documentos que pedimos a quem é registrado:</strong>{" "}
          {n === 0 ? "nenhum ainda" : n === 1 ? "1 documento" : `${n} documentos`}
        </span>
      </div>
      <Link href="/documentos-exigidos" className="text-sm text-primary underline">
        {n === 0 ? "Escolher o que pedir" : "Ver a lista"}
      </Link>
    </Card>
  );
}

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
  const [vendoAcesso, setVendoAcesso] = useState<Funcionario | null>(null);
  const [vendoDocs, setVendoDocs] = useState<Funcionario | null>(null);
  const config = useConfigPonto();
  const [prefill, setPrefill] = useState<{ id: string; nome: string; cpf: string } | null>(null);

  // Vindo da ficha do motorista ("Registrar pra bater ponto"): abre a
  // contratação já com nome e CPF dele. Só o id viaja na URL — CPF em query
  // string ficaria no histórico do navegador.
  useEffect(() => {
    if (!token) return;
    const id = new URLSearchParams(window.location.search).get("motorista");
    if (!id) return;
    window.history.replaceState(null, "", "/ponto/funcionarios");
    fetchApi<{ nome: string; cpf: string }>(`/admin/motoristas/${id}`, { token })
      .then((m) => {
        setPrefill({ id, nome: m.nome, cpf: m.cpf });
        setNovo(true);
      })
      .catch(() => toast.error("Não consegui abrir os dados do motorista."));
  }, [token]);

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
      <ComecarPonto />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Users className="h-6 w-6 text-muted-foreground" />
            Quem bate ponto
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            <strong className="text-foreground">Quem está nesta lista bate ponto no app.</strong>{" "}
            Serve para quem é registrado em carteira, motorista ou não. Para incluir alguém,
            toque em “Registrar contratação”.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {temPermissao("funcionarios.importar") && <Importar />}
          {temPermissao("funcionarios.criar") && (
            <Button onClick={() => setNovo(true)}>
              <Plus className="mr-1 h-4 w-4" /> Registrar contratação
            </Button>
          )}
        </div>
      </div>

      <DocumentosQuePedimos />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} />
        Mostrar quem já foi desligado
      </label>

      {itens.length === 0 ? (
        <EstadoVazio
          titulo="Ninguém bate ponto ainda"
          descricao="Toque em “Registrar contratação”, no alto da tela, e informe nome e CPF de quem vai bater ponto."
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
                  {f.cargo ?? "sem cargo"} · CPF {maskCpf(f.cpf)}
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
              <Button variant="outline" size="sm" onClick={() => setVendoDocs(f)}>
                <FileText className="mr-1 h-4 w-4" /> Documentos
              </Button>
              {f.ativo && (
                <Button variant="outline" size="sm" onClick={() => setVendoAcesso(f)}>
                  <Smartphone className="mr-1 h-4 w-4" /> Acesso ao app
                </Button>
              )}
              {f.ativo && temPermissao("funcionarios.desligar") && <Desligar id={f.id} nome={f.nome} />}
            </div>
          ))}
        </Card>
      )}

      {novo && (
        <DialogContratar
          inicial={prefill}
          onFechar={() => {
            setNovo(false);
            setPrefill(null);
          }}
        />
      )}
      {/* O mesmo card da ficha do motorista: o acesso é da pessoa, e quem só
          é registrado também precisa ver (e explicar) o que aparece no app dele. */}
      {vendoDocs && (
        <DocumentosDoFuncionario
          funcionarioId={vendoDocs.id}
          nome={vendoDocs.nome}
          onFechar={() => setVendoDocs(null)}
        />
      )}
      {vendoAcesso && (
        <Dialog open onOpenChange={(o) => !o && setVendoAcesso(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{vendoAcesso.nome}</DialogTitle>
            </DialogHeader>
            <AcessoAppCard funcionarioId={vendoAcesso.id} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

type Previa = {
  criar: { linha: number; nome: string; cpf: string; cargo?: string; matricula?: string; admitidoEm?: string; jornada?: string }[];
  bloqueadas: { linha: number; descricao: string; motivo: string }[];
};

/**
 * Importar por planilha: modelo, prévia e confirmação.
 *
 * ⚠️ A prévia NÃO grava. O que o parser não aceitou aparece com o motivo,
 * linha a linha — inclusive o caso que não é erro de planilha: CPF que já tem
 * contrato de parceiro autônomo. Esse é a trava fazendo o trabalho dela, e o
 * texto diz o que encerrar.
 */
function Importar() {
  const token = useAuthToken();
  const qc = useQueryClient();
  const arquivo = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);

  async function baixarModelo() {
    const r = await fetch(`${apiBaseUrl}${PATH}/funcionarios/modelo`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) return toast.error("Não consegui gerar o modelo.");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-funcionarios.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  const ler = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("arquivo", file);
      return fetchApi<Previa>(`${PATH}/funcionarios/importacao/previa`, {
        token,
        method: "POST",
        body: fd,
      });
    },
    onSuccess: (r) => setPrevia(r),
    onError: (e: Error) => toast.error("Não consegui ler", { description: e.message }),
  });

  const confirmar = useMutation({
    mutationFn: () =>
      fetchApi<{ criados: number; falharam: { descricao: string; motivo: string }[] }>(
        `${PATH}/funcionarios/importacao/confirmar`,
        { token, method: "POST", body: JSON.stringify({ linhas: previa?.criar ?? [] }) },
      ),
    onSuccess: (r) => {
      toast.success(`${r.criados} cadastrado(s).`, {
        description: r.falharam.length ? `${r.falharam.length} não entraram.` : undefined,
      });
      void qc.invalidateQueries({ queryKey: [PATH, "funcionarios"] });
      setPrevia(null);
    },
    onError: (e: Error) => toast.error("Não consegui cadastrar", { description: e.message }),
  });

  return (
    <>
      <Button variant="outline" onClick={() => void baixarModelo()}>
        Baixar planilha modelo
      </Button>
      <Button variant="outline" disabled={ler.isPending} onClick={() => arquivo.current?.click()}>
        {ler.isPending ? "Lendo…" : "Importar planilha"}
      </Button>
      <input
        ref={arquivo}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) ler.mutate(f);
          e.target.value = "";
        }}
      />

      {previa && (
        <Dialog open onOpenChange={() => setPrevia(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Confira antes de cadastrar</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p>
                <strong>{previa.criar.length}</strong> pronto(s) pra cadastrar.
              </p>
              {previa.criar.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded border p-2">
                  {previa.criar.map((l) => (
                    <div key={l.linha} className="border-b py-1 last:border-0">
                      {l.nome} · {maskCpf(l.cpf)}
                      {l.jornada ? ` · ${l.jornada}` : " · sem jornada"}
                    </div>
                  ))}
                </div>
              )}
              {previa.bloqueadas.length > 0 && (
                <div className="rounded border border-amber-500/50 bg-amber-500/5 p-2">
                  <p className="font-medium">
                    {previa.bloqueadas.length} linha(s) não entram:
                  </p>
                  <ul className="ml-4 list-disc">
                    {previa.bloqueadas.map((b) => (
                      <li key={b.linha}>
                        <strong>{b.descricao}</strong> — {b.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPrevia(null)}>
                Cancelar
              </Button>
              <Button
                disabled={previa.criar.length === 0 || confirmar.isPending}
                onClick={() => confirmar.mutate()}
              >
                {confirmar.isPending ? "Cadastrando…" : `Cadastrar ${previa.criar.length}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function DialogContratar({
  onFechar,
  inicial,
}: {
  onFechar: () => void;
  inicial?: { id?: string; nome: string; cpf: string } | null;
}) {
  const token = useAuthToken();
  const qc = useQueryClient();
  // Motorista já cadastrado: nome e CPF vêm do cadastro, ninguém digita de
  // novo. Digitar só faz sentido pra quem NÃO dirige (mecânico, escritório) e
  // não tem cadastro de motorista.
  const [motoristaId, setMotoristaId] = useState<string | undefined>(inicial?.id);
  const [form, setForm] = useState({
    nome: inicial?.nome ?? "",
    cpf: inicial?.cpf ?? "",
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
            <Label>Quem vai bater ponto?</Label>
            <MotoristaCombobox
              triggerClassName="w-full"
              value={motoristaId}
              initialOption={
                inicial?.id ? { value: inicial.id, label: inicial.nome } : undefined
              }
              placeholder="Buscar motorista já cadastrado…"
              onChange={(id) => {
                setMotoristaId(id);
                if (!id) return setForm((f) => ({ ...f, nome: "", cpf: "" }));
                fetchApi<{ nome: string; cpf: string }>(`/admin/motoristas/${id}`, { token })
                  .then((m) => setForm((f) => ({ ...f, nome: m.nome, cpf: m.cpf })))
                  .catch(() => toast.error("Não consegui abrir os dados do motorista."));
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Se ele já dirige, escolha aqui: nome e CPF vêm do cadastro. Se não dirige (mecânico,
              escritório…), deixe em branco e preencha abaixo.
            </p>
          </div>
          {!motoristaId && (
            <div>
              <Label htmlFor="func-nome">Nome completo</Label>
              <Input
                id="func-nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {!motoristaId && (
              <div>
                <Label htmlFor="func-cpf">CPF</Label>
                <Input
                  id="func-cpf"
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  value={maskCpf(form.cpf)}
                  onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  É por ele que o aplicativo reconhece a pessoa.
                </p>
              </div>
            )}
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
