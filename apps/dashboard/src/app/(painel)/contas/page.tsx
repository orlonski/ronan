"use client";

import { useState } from "react";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApiQuery, fetchApi, useAuthToken } from "@/lib/client-api";
import { usePermissoes } from "@/lib/permissoes";
import { fmtDataHoraSP } from "@/lib/datetime-br";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

type Conta = {
  id: string;
  nome: string;
  slug: string;
  cnpj: string | null;
  ativa: boolean;
  permiteAutoCadastro: boolean;
  logoUrl: string | null;
  codigoConvite: string | null;
  criadaEm: string;
  usuarios: number;
  motoristas: number;
  viagens: number;
};

/**
 * Empresas que usam o sistema. Tela da PLATAFORMA, não de nenhuma empresa —
 * gateada por `plataforma` no usuário, fora da matriz de papéis.
 */
export default function ContasPage() {
  const { plataforma, isLoading: carregandoPerm } = usePermissoes();
  const { data, isLoading, refetch } = useApiQuery<Conta[]>("/admin/contas");
  const token = useAuthToken();
  const [abrirNova, setAbrirNova] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    cnpj: "",
    adminNome: "",
    adminEmail: "",
    adminSenha: "",
  });

  if (carregandoPerm) return null;
  if (!plataforma) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Esta tela é da equipe da plataforma.
      </div>
    );
  }

  async function criar() {
    setSalvando(true);
    try {
      const criada = await fetchApi<{ nome: string; adminEmail: string }>("/admin/contas", {
        method: "POST",
        token,
        body: JSON.stringify({
          nome: form.nome,
          cnpj: form.cnpj || undefined,
          adminNome: form.adminNome,
          adminEmail: form.adminEmail,
          adminSenha: form.adminSenha,
        }),
      });
      toast.success(
        `${criada.nome} criada. O acesso é ${criada.adminEmail} com a senha que você definiu.`,
      );
      setAbrirNova(false);
      setForm({ nome: "", cnpj: "", adminNome: "", adminEmail: "", adminSenha: "" });
      void refetch();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não consegui criar a empresa.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtiva(conta: Conta) {
    try {
      await fetchApi(`/admin/contas/${conta.id}/ativa`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ ativa: !conta.ativa }),
      });
      toast.success(conta.ativa ? `${conta.nome} suspensa.` : `${conta.nome} reativada.`);
      void refetch();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não consegui mudar o status.");
    }
  }

  async function enviarLogo(conta: Conta, arquivo: File) {
    if (arquivo.size > 2 * 1024 * 1024) {
      toast.error("A logo precisa ter no máximo 2 MB.");
      return;
    }
    try {
      const form = new FormData();
      form.append("logo", arquivo);
      await fetchApi(`/admin/contas/${conta.id}/logo`, { method: "POST", token, body: form });
      toast.success(`Logo de ${conta.nome} atualizada.`);
      void refetch();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não consegui enviar a logo.");
    }
  }

  async function definirAutoCadastro(conta: Conta) {
    try {
      await fetchApi(`/admin/contas/${conta.id}/auto-cadastro`, { method: "PATCH", token });
      toast.success(`Cadastro pelo app agora cai em ${conta.nome}.`);
      void refetch();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não consegui mudar.");
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Building2 className="h-5 w-5" />
            Empresas
          </h1>
          <p className="text-sm text-muted-foreground">
            Cada empresa enxerga só os dados dela. Criar uma aqui já deixa ela pronta pra usar.
          </p>
        </div>
        <Button onClick={() => setAbrirNova(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nova empresa
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="grid gap-3">
          {(data ?? []).map((conta) => (
            <Card key={conta.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {/* A marca do cliente, quando ele já mandou uma. */}
                  <div className="flex h-10 w-16 shrink-0 items-center justify-center rounded border bg-muted/30">
                    {conta.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`${API_URL}${conta.logoUrl}`}
                        alt={conta.nome}
                        className="max-h-8 max-w-14 object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">sem logo</span>
                    )}
                  </div>
                  <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{conta.nome}</span>
                    {!conta.ativa && (
                      <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                        suspensa
                      </span>
                    )}
                    {conta.permiteAutoCadastro && (
                      <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        recebe cadastro pelo app
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs">
                    <span className="text-muted-foreground">código dos motoristas: </span>
                    <span className="font-mono font-medium">{conta.codigoConvite ?? "—"}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {conta.slug} · {conta.usuarios} usuário(s) · {conta.motoristas} motorista(s) ·{" "}
                    {conta.viagens} viagem(ns) · desde {fmtDataHoraSP(conta.criadaEm)}
                  </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    id={`logo-${conta.id}`}
                    onChange={(e) => {
                      const arquivo = e.target.files?.[0];
                      if (arquivo) void enviarLogo(conta, arquivo);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => document.getElementById(`logo-${conta.id}`)?.click()}
                  >
                    {conta.logoUrl ? "Trocar logo" : "Enviar logo"}
                  </Button>
                  {!conta.permiteAutoCadastro && (
                    <Button variant="outline" size="sm" onClick={() => definirAutoCadastro(conta)}>
                      Receber cadastro pelo app
                    </Button>
                  )}
                  <Button
                    variant={conta.ativa ? "destructive" : "default"}
                    size="sm"
                    onClick={() => alternarAtiva(conta)}
                  >
                    {conta.ativa ? "Suspender" : "Reativar"}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={abrirNova} onOpenChange={setAbrirNova}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova empresa</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="nome">Nome da empresa</Label>
              <Input
                id="nome"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Transportes Alex"
              />
            </div>
            <div>
              <Label htmlFor="cnpj">CNPJ (opcional)</Label>
              <Input
                id="cnpj"
                value={form.cnpj}
                onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
              />
            </div>
            <hr className="my-2" />
            <p className="text-xs text-muted-foreground">
              Quem vai administrar a empresa. É esse acesso que você entrega pra ela.
            </p>
            <div>
              <Label htmlFor="adminNome">Nome</Label>
              <Input
                id="adminNome"
                value={form.adminNome}
                onChange={(e) => setForm({ ...form, adminNome: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="adminEmail">E-mail</Label>
              <Input
                id="adminEmail"
                type="email"
                value={form.adminEmail}
                onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="adminSenha">Senha provisória</Label>
              <Input
                id="adminSenha"
                type="text"
                value={form.adminSenha}
                onChange={(e) => setForm({ ...form, adminSenha: e.target.value })}
                placeholder="mínimo 8 caracteres"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAbrirNova(false)}>
              Cancelar
            </Button>
            <Button
              onClick={criar}
              disabled={
                salvando ||
                !form.nome ||
                !form.adminNome ||
                !form.adminEmail ||
                form.adminSenha.length < 8
              }
            >
              {salvando ? "Criando…" : "Criar empresa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
