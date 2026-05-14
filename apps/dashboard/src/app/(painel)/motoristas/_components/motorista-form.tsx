"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Loader2, Plus, Trash2 } from "lucide-react";
import {
  TIPOS_DOCUMENTO_MOTORISTA,
  cpfDigits,
  isCpfValid,
  isTelefoneValid,
  maskTelefone,
  telefoneDigits,
  type MotoristaDocumentoOutput,
  type TipoDocumentoMotorista,
} from "@ronan/shared-types";
import { DocumentoRow } from "@/components/documento-row";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthToken, useCreateResource, useUpdateResource } from "@/lib/client-api";
import {
  baixarZipDocumentos,
  useDocumentosMotorista,
} from "@/lib/motorista-documentos-api";

type Veiculo = { id: string; placa: string; modelo: string | null };
type DocumentoResumo = { tipo: TipoDocumentoMotorista; validade: string | null };
export type Motorista = {
  id: string;
  nome: string;
  cpf: string;
  telefone: string | null;
  email: string | null;
  ativo: boolean;
  veiculoDefaultId: string | null;
  veiculoDefault: Veiculo | null;
  veiculos: Veiculo[];
  documentos: DocumentoResumo[];
};

const PATH = "/admin/motoristas";

type PlacaRow = { placa: string; modelo: string };
type FormShape = {
  nome: string;
  cpf: string;
  senha: string;
  telefone: string;
  email: string;
  placas: PlacaRow[];
  /** Placa string (não id). Backend resolve. */
  placaDefault: string | null;
};

const empty: FormShape = {
  nome: "",
  cpf: "",
  senha: "",
  telefone: "",
  email: "",
  placas: [],
  placaDefault: null,
};

const placaRegex = /^[A-Z]{3}-?\d[A-Z\d]\d{2}$/i;

function maskCpf(input: string): string {
  const d = cpfDigits(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

type Props = { initial?: Motorista };

export function MotoristaForm({ initial }: Props) {
  const router = useRouter();
  const create = useCreateResource<Record<string, unknown>, Motorista>(PATH, PATH);
  const update = useUpdateResource<Record<string, unknown>, Motorista>(PATH, PATH);

  const [form, setForm] = useState<FormShape>(
    initial
      ? {
          nome: initial.nome,
          cpf: maskCpf(initial.cpf),
          senha: "",
          telefone: maskTelefone(initial.telefone ?? ""),
          email: initial.email ?? "",
          placas: initial.veiculos.map((v) => ({ placa: v.placa, modelo: v.modelo ?? "" })),
          placaDefault: initial.veiculoDefault?.placa ?? null,
        }
      : empty,
  );

  function addPlaca() {
    setForm((f) => ({ ...f, placas: [...f.placas, { placa: "", modelo: "" }] }));
  }
  function removePlaca(idx: number) {
    setForm((f) => {
      const removida = f.placas[idx]?.placa.toUpperCase();
      const novas = f.placas.filter((_, i) => i !== idx);
      const novoDefault =
        removida && f.placaDefault === removida ? null : f.placaDefault;
      return { ...f, placas: novas, placaDefault: novoDefault };
    });
  }
  function updatePlaca(idx: number, key: keyof PlacaRow, value: string) {
    setForm((f) => {
      const novas = f.placas.map((p, i) => (i === idx ? { ...p, [key]: value } : p));
      const original = f.placas[idx];
      let novoDefault = f.placaDefault;
      if (key === "placa" && original && f.placaDefault === original.placa.toUpperCase()) {
        novoDefault = value.toUpperCase();
      }
      return { ...f, placas: novas, placaDefault: novoDefault };
    });
  }
  function setDefault(placa: string) {
    setForm((f) => ({ ...f, placaDefault: placa.toUpperCase() }));
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const cpfDigitos = cpfDigits(form.cpf);
    if (!isCpfValid(cpfDigitos)) {
      alert("CPF inválido. Confira os dígitos.");
      return;
    }
    const telDigitos = telefoneDigits(form.telefone);
    if (telDigitos && !isTelefoneValid(telDigitos)) {
      alert("Telefone deve ter 10 ou 11 dígitos (com DDD).");
      return;
    }
    const emailTrim = form.email.trim();
    if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
      alert("Email inválido.");
      return;
    }
    const placasLimpas = form.placas
      .map((p) => ({ placa: p.placa.trim().toUpperCase(), modelo: p.modelo.trim() }))
      .filter((p) => p.placa !== "");
    for (const p of placasLimpas) {
      if (!placaRegex.test(p.placa)) {
        alert(`Placa "${p.placa}" inválida. Use ABC1D23 (Mercosul) ou ABC1234 (antigo).`);
        return;
      }
    }
    const placasSet = new Set(placasLimpas.map((p) => p.placa));
    if (placasSet.size !== placasLimpas.length) {
      alert("Há placas repetidas. Remova duplicadas.");
      return;
    }
    let placaDefault = form.placaDefault;
    if (placaDefault && !placasSet.has(placaDefault)) placaDefault = null;
    if (!placaDefault && placasLimpas.length === 1) {
      placaDefault = placasLimpas[0]!.placa;
    }
    const placasPayload = placasLimpas.map((p) => ({
      placa: p.placa,
      modelo: p.modelo || undefined,
    }));

    if (initial) {
      const body: Record<string, unknown> = {
        nome: form.nome,
        cpf: cpfDigitos,
        telefone: telDigitos || undefined,
        email: emailTrim || undefined,
        placas: placasPayload,
        placaDefault,
      };
      if (form.senha) body.novaSenha = form.senha;
      await update.mutateAsync({ id: initial.id, body });
    } else {
      await create.mutateAsync({
        nome: form.nome,
        cpf: cpfDigitos,
        senha: form.senha,
        telefone: telDigitos || undefined,
        email: emailTrim || undefined,
        placas: placasPayload,
        placaDefault,
      });
    }
    router.push("/motoristas");
  }

  const saving = create.isPending || update.isPending;

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className={initial ? "grid grid-cols-1 gap-6 lg:grid-cols-2" : ""}>
        <Card className="space-y-4 p-6">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label>Nome</Label>
              <Input
                required
                autoFocus
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>CPF (login)</Label>
              <Input
                required
                inputMode="numeric"
                placeholder="000.000.000-00"
                value={form.cpf}
                onChange={(e) => setForm({ ...form, cpf: maskCpf(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>{initial ? "Nova senha (opcional)" : "Senha"}</Label>
              <Input
                type="password"
                minLength={initial ? 0 : 6}
                required={!initial}
                value={form.senha}
                onChange={(e) => setForm({ ...form, senha: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Telefone</Label>
              <Input
                inputMode="tel"
                placeholder="(00) 00000-0000"
                value={form.telefone}
                onChange={(e) => setForm({ ...form, telefone: maskTelefone(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="motorista@email.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Placas</Label>
              <Button type="button" variant="outline" size="sm" onClick={addPlaca}>
                <Plus className="h-3.5 w-3.5" /> Adicionar placa
              </Button>
            </div>
            {form.placas.length === 0 ? (
              <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                Nenhuma placa cadastrada. Clique em &quot;Adicionar placa&quot; pra incluir.
              </p>
            ) : (
              <div className="space-y-2">
                {form.placas.map((p, idx) => {
                  const placaUpper = p.placa.toUpperCase();
                  const ehPadrao = placaUpper !== "" && form.placaDefault === placaUpper;
                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-2 rounded-md border bg-background p-2"
                    >
                      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                        <Input
                          placeholder="ABC1D23"
                          value={p.placa}
                          maxLength={8}
                          onChange={(e) =>
                            updatePlaca(idx, "placa", e.target.value.toUpperCase())
                          }
                          className="font-mono"
                        />
                        <Input
                          placeholder="Modelo (opcional)"
                          value={p.modelo}
                          maxLength={80}
                          onChange={(e) => updatePlaca(idx, "modelo", e.target.value)}
                        />
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {form.placas.length > 1 && placaUpper && (
                          <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="radio"
                              name="placa-default"
                              checked={ehPadrao}
                              onChange={() => setDefault(placaUpper)}
                              className="h-3 w-3 accent-blue-600"
                            />
                            padrão
                          </label>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removePlaca(idx)}
                          title="Remover placa"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>

        {initial && (
          <Card className="p-6">
            <DocumentosSection motoristaId={initial.id} motoristaNome={initial.nome} />
          </Card>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Link href="/motoristas">
          <Button type="button" variant="outline">
            Cancelar
          </Button>
        </Link>
        <Button type="submit" disabled={saving}>
          Salvar
        </Button>
      </div>
    </form>
  );
}

function DocumentosSection({
  motoristaId,
  motoristaNome,
}: {
  motoristaId: string;
  motoristaNome: string;
}) {
  const { data: docs, isLoading } = useDocumentosMotorista(motoristaId);
  const token = useAuthToken();
  const [baixandoZip, setBaixandoZip] = useState(false);

  const porTipo = useMemo(() => {
    const map = new Map<TipoDocumentoMotorista, MotoristaDocumentoOutput>();
    for (const d of docs ?? []) map.set(d.tipo, d);
    return map;
  }, [docs]);

  const temAlgum = (docs?.length ?? 0) > 0;

  async function onBaixarZip() {
    if (!token) return;
    setBaixandoZip(true);
    try {
      await baixarZipDocumentos(motoristaId, token, `documentos-${motoristaNome}.zip`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao baixar zip");
    } finally {
      setBaixandoZip(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Documentos</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBaixarZip}
          disabled={!temAlgum || baixandoZip}
          title={temAlgum ? "Baixar todos os documentos em zip" : "Nenhum documento anexado"}
        >
          {baixandoZip ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          <span className="ml-1">Baixar zip</span>
        </Button>
      </div>
      {isLoading ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
          Carregando documentos…
        </p>
      ) : (
        <div className="space-y-2">
          {TIPOS_DOCUMENTO_MOTORISTA.map((tipo) => (
            <DocumentoRow
              key={tipo}
              motoristaId={motoristaId}
              tipo={tipo}
              doc={porTipo.get(tipo)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
