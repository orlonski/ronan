"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CAPACIDADE_POR_CHAVE, type CapacidadeApp } from "@ronan/shared-types";
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
export const rotuloCapacidade = (c: string) => CAPACIDADE_POR_CHAVE[c as CapacidadeApp]?.label ?? c;

/** "também vê Iniciar viagem com GPS" / "não vê Ver os acertos". */
export function fraseDaDiferenca(e: Pick<ExcecaoApp, "efeito" | "capacidade">) {
  return `${e.efeito === "CONCEDER" ? "também vê" : "não vê"} ${rotuloCapacidade(e.capacidade)}`;
}

/**
 * 3. QUEM TEM ALGO DIFERENTE DO GRUPO, e por quê.
 *
 * Só aparece quando há alguém: lista vazia não precisa de seção. Pra dar ou
 * tirar algo de uma pessoa, o caminho é a ficha dela; aqui é a visão de todas.
 *
 * As que vieram da ficha antiga não vencem (decisão do dono): ficam aqui pra
 * alguém revisar quando quiser, com o motivo "Já era assim na ficha dele".
 */
export function PessoasDiferentes({ painel }: { painel: PainelAcessoApp }) {
  const total = Object.values(painel.excecoes).reduce((s, n) => s + n, 0);
  const [prazo, setPrazo] = useState("");
  const lista = useApiQuery<ExcecaoApp[]>(
    total > 0 ? `/admin/acesso-app/excecoes${prazo ? `?prazo=${prazo}` : ""}` : undefined,
  );
  const [todas, setTodas] = useState(false);

  if (total === 0) return null;

  // UMA LINHA POR PESSOA, não por item: "Adilson também vê GPS, pedágio e
  // ticket" se lê de relance; nove linhas do mesmo Adilson, não.
  const porPessoa = new Map<string, { cpf: string; nome: string; motoristaId?: string; tem: string[]; naoTem: string[]; motivos: Set<string> }>();
  for (const e of lista.data ?? []) {
    const p = porPessoa.get(e.cpf) ?? {
      cpf: e.cpf,
      nome: e.pessoa?.nome ?? e.cpf,
      motoristaId: e.pessoa?.motoristaId,
      tem: [],
      naoTem: [],
      motivos: new Set<string>(),
    };
    (e.efeito === "CONCEDER" ? p.tem : p.naoTem).push(
      rotuloCapacidade(e.capacidade) + (e.expiraEm ? ` (até ${fmt(e.expiraEm)})` : ""),
    );
    p.motivos.add(e.motivo);
    porPessoa.set(e.cpf, p);
  }
  const linhas = [...porPessoa.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  const visiveis = todas ? linhas : linhas.slice(0, 8);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Quem tem algo diferente do grupo</h2>
          <p className="text-sm text-muted-foreground">
            Pra dar ou tirar algo de uma pessoa só, abra a ficha dela.
          </p>
        </div>
        {(painel.excecoesVencendo > 0 || total > 8) && (
          <Select className="w-48" value={prazo} onChange={(e) => setPrazo(e.target.value)}>
            <option value="">Todas</option>
            <option value="vencendo">Acabam em 7 dias</option>
          </Select>
        )}
      </div>

      <Card className="divide-y divide-border">
        {lista.data?.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">Ninguém com esse filtro.</p>
        )}
        {visiveis.map((p) => (
          <div key={p.cpf} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">{p.nome}</p>
              {p.tem.length > 0 && <p className="text-emerald-800 dark:text-emerald-300">Também vê: {p.tem.join(", ")}</p>}
              {p.naoTem.length > 0 && <p className="text-amber-800 dark:text-amber-300">Não vê: {p.naoTem.join(", ")}</p>}
              <p className="text-xs text-muted-foreground">“{[...p.motivos].join("” · “")}”</p>
            </div>
            <Link href={p.motoristaId ? `/motoristas/${p.motoristaId}` : "/ponto/funcionarios"}>
              <Button variant="outline" size="sm">
                Abrir ficha
              </Button>
            </Link>
          </div>
        ))}
      </Card>
      {linhas.length > visiveis.length && (
        <Button variant="ghost" size="sm" onClick={() => setTodas(true)}>
          Ver todas as {linhas.length} pessoas
        </Button>
      )}
    </section>
  );
}

/** Desfaz a diferença: a pessoa volta a ter exatamente o que o grupo dela dá. */
export function RevogarExcecao({ excecao, onFechar }: { excecao: ExcecaoApp; onFechar: () => void }) {
  const token = useAuthToken();
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const cap = rotuloCapacidade(excecao.capacidade);
  const perde = excecao.efeito === "CONCEDER";

  return (
    <Dialog open onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Desfazer: {cap}</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          {excecao.pessoa?.nome ?? "A pessoa"} volta a ter o que o grupo dela dá.
          {perde && ` Se o grupo não tem “${cap}”, isso some do celular dela.`}
        </p>
        <Textarea
          rows={2}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Por quê? (fica registrado)"
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
                toast.success("Pronto: voltou a ser igual ao grupo.");
                void qc.invalidateQueries();
                onFechar();
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setSalvando(false);
              }
            }}
          >
            Desfazer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Reexport pra quem só precisa da chave do painel.
export { CHAVE_PAINEL };
