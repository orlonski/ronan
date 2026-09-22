"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CAPACIDADE_POR_CHAVE, type CapacidadeApp } from "@ronan/shared-types";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { LoadingCard } from "@/components/loading";
import { ErroCard } from "@/components/erro-estado";
import { usePermissoes } from "@/lib/permissoes";
import { fetchApi, useApiQuery, useAuthToken } from "@/lib/client-api";
import { CHAVE_PAINEL, type PainelAcessoApp } from "./tipos";

export type ExcecaoApp = {
  id: string;
  cpf: string;
  capacidade: string;
  efeito: "CONCEDER" | "NEGAR";
  motivo: string;
  origem: string;
  expiraEm: string | null;
  criadoEm: string;
  pessoa?: { nome: string; motoristaId?: string; funcionarioId?: string };
};

const fmt = (d: string) => new Date(d).toLocaleDateString("pt-BR");

/**
 * AS EXCEÇÕES VIVAS — quem tem algo diferente do perfil, e por quê.
 *
 * ⚠️ As herdadas (origem MIGRACAO) são o presente congelado: o que cada ficha
 * dizia quando a empresa passou pras regras. Por decisão do dono elas NÃO
 * vencem. Ficam aqui, filtráveis, pra alguém revisar quando quiser.
 */
export type FiltroExcecoes = { origem?: string; prazo?: string };

export function AbaExcecoes({ painel, inicial }: { painel: PainelAcessoApp; inicial?: FiltroExcecoes }) {
  const [origem, setOrigem] = useState(inicial?.origem ?? "");
  const [prazo, setPrazo] = useState(inicial?.prazo ?? "");
  const qs = new URLSearchParams({ ...(origem ? { origem } : {}), ...(prazo ? { prazo } : {}) }).toString();
  const lista = useApiQuery<ExcecaoApp[]>(`/admin/acesso-app/excecoes${qs ? `?${qs}` : ""}`);
  const [revogando, setRevogando] = useState<ExcecaoApp | null>(null);
  const { temPermissao } = usePermissoes();
  const podeRevogar = painel.fonte === "REGRAS" && temPermissao("perfis-acesso.aplicar");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Pra dar ou tirar algo de uma pessoa só, abra a ficha dela. Aqui fica a lista de todas.
        </p>
        <div className="flex flex-wrap gap-2">
          <Select className="w-56" value={origem} onChange={(e) => setOrigem(e.target.value)}>
            <option value="">De qualquer origem</option>
            <option value="MIGRACAO">Herdadas da ficha antiga</option>
            <option value="MANUAL">Abertas à mão</option>
          </Select>
          <Select className="w-56" value={prazo} onChange={(e) => setPrazo(e.target.value)}>
            <option value="">Com ou sem prazo</option>
            <option value="vencendo">Vencem em 7 dias</option>
            <option value="sem">Sem prazo</option>
          </Select>
        </div>
      </div>

      {lista.isLoading && <LoadingCard />}
      {lista.error && <ErroCard erro={lista.error} onRetry={() => lista.refetch()} />}
      {lista.data?.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          {origem || prazo
            ? "Nenhuma exceção com esse filtro."
            : "Nenhuma exceção: todo mundo tem exatamente o que o perfil dá."}
        </Card>
      )}
      {!!lista.data?.length && (
        <Card className="divide-y divide-border">
          {lista.data.map((e) => (
            <div key={e.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {e.pessoa?.motoristaId ? (
                    <Link href={`/motoristas/${e.pessoa.motoristaId}`} className="font-medium hover:underline">
                      {e.pessoa.nome}
                    </Link>
                  ) : (
                    <span className="font-medium">{e.pessoa?.nome ?? e.cpf}</span>
                  )}{" "}
                  {e.efeito === "CONCEDER" ? (
                    <Badge className="border-emerald-300 bg-emerald-50 text-emerald-700">ganha</Badge>
                  ) : (
                    <Badge className="border-amber-300 bg-amber-50 text-amber-800">não tem</Badge>
                  )}{" "}
                  <strong>{CAPACIDADE_POR_CHAVE[e.capacidade as CapacidadeApp]?.label ?? e.capacidade}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  “{e.motivo}” · desde {fmt(e.criadoEm)}
                  {e.expiraEm ? ` · até ${fmt(e.expiraEm)}` : " · sem prazo"}
                  {e.origem === "MIGRACAO" && " · herdada"}
                </p>
              </div>
              {podeRevogar && (
                <Button variant="outline" size="sm" onClick={() => setRevogando(e)}>
                  Voltar ao perfil
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}

      {revogando && <RevogarExcecao excecao={revogando} onFechar={() => setRevogando(null)} />}
    </div>
  );
}

export function RevogarExcecao({ excecao, onFechar }: { excecao: ExcecaoApp; onFechar: () => void }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const cap = CAPACIDADE_POR_CHAVE[excecao.capacidade as CapacidadeApp]?.label ?? excecao.capacidade;
  const perde = excecao.efeito === "CONCEDER";

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Voltar ao perfil</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          {excecao.pessoa?.nome ?? "A pessoa"} passa a ter o que o perfil dela dá em{" "}
          <strong>{cap}</strong>
          {perde ? " — se o perfil não dá, ela perde isso no celular." : "."}
        </p>
        <Textarea
          rows={3}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Por que a exceção acabou (quem ler daqui a seis meses precisa entender)"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            variant={perde ? "warning" : "default"}
            disabled={salvando || motivo.trim().length < 10}
            onClick={async () => {
              setSalvando(true);
              try {
                await fetchApi(`/admin/acesso-app/excecoes/${excecao.id}/revogar`, {
                  method: "POST",
                  token,
                  body: JSON.stringify({ motivo }),
                });
                toast.success("Pronto: voltou ao perfil.");
                void qc.invalidateQueries();
                onFechar();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSalvando(false);
              }
            }}
          >
            Voltar ao perfil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Reexport pra quem só precisa da chave do painel.
export { CHAVE_PAINEL };
