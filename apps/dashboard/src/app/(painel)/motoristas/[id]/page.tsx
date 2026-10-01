"use client";

import { use } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { formatCpf, formatTelefone, type StatusMotorista } from "@ronan/shared-types";
import { FormPageHeader } from "@/components/form-page-header";
import { Permitido } from "@/components/requer-tela";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusCadastroBadge } from "@/components/status-cadastro-badge";
import { DocumentosBadge } from "@/components/documentos-badge";
import { useResourceItem, useApiQuery } from "@/lib/client-api";
import { AppVersaoCard, type AppVersaoInfo } from "@/components/app-versao-badge";
import type { Motorista } from "../_components/motorista-form";
import { HistoricoNotificacoes } from "./historico-notificacoes";
import { PedirDocumentos } from "./pedir-documentos";
import { RegimeCard, type RegimeDaPessoa } from "./regime-card";
import { AcessoAppCard } from "./acesso-app-card";
import { WhatsappSuspeitoCard } from "./whatsapp-suspeito-card";
import { ConferenciaCalendarioMotorista } from "@/components/conferencia-calendario-motorista";
import { NumeroConfirmadoCard } from "@/components/numero-confirmado";
import { usePermissoes } from "@/lib/permissoes";

type ResumoVersoes = {
  latestUpdateId: string | null;
  latestBuiltAt: string | null;
  fonte: "eas" | "motoristas";
};

type Ficha = Motorista &
  AppVersaoInfo & {
    regime?: RegimeDaPessoa;
    status?: StatusMotorista;
    aceite?: "PENDENTE" | "ACEITO" | "RECUSADO";
    convidadoEm?: string | null;
    aprovadoEm?: string | null;
    ultimoLoginEm?: string | null;
    whatsappInalcancavelEm?: string | null;
    receberConferenciaDiaria?: boolean;
    conferenciaDesligadaEm?: string | null;
    conferenciaDesligadaOrigem?: "MOTORISTA" | "PAINEL" | null;
    conferenciaDesligadaPor?: { id: string; nome: string } | null;
    conferenciaDesligadaMotivo?: string | null;
  };

const REMUNERACAO_TEXTO: Record<string, string> = {
  PERCENTUAL_FRETE: "Percentual do frete",
  VALOR_POR_VIAGEM: "Valor por viagem",
  VALOR_POR_TONELADA: "Valor por tonelada",
  VALOR_POR_KM: "Valor por km",
};

function dataHora(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className="mt-0.5 break-words text-sm">{children ?? "—"}</dd>
    </div>
  );
}

/** FICHA do motorista, só leitura. A edição mora em `/motoristas/[id]/editar`. */
export default function FichaMotoristaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { temPermissao, temModulo } = usePermissoes();
  const verConferencia = temPermissao("conferencia-diaria.ver") && temModulo("conferencia-diaria.ver");
  const item = useResourceItem<Ficha>("/admin/motoristas", id);
  const resumo = useApiQuery<ResumoVersoes>("/admin/motoristas/versoes/resumo", {
    staleTime: 60_000,
  });
  const m = item.data;

  return (
    <div className="space-y-6">
      <FormPageHeader
        title={m ? m.nome : "Motorista"}
        backHref="/motoristas"
        right={
          m && (
            <Permitido chave="motoristas.editar">
              <Button asChild>
                <Link href={`/motoristas/${id}/editar`}>
                  <Pencil className="h-4 w-4" />
                  Editar
                </Link>
              </Button>
            </Permitido>
          )
        }
      />
      {item.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {item.isError && !m && (
        <p className="text-sm text-muted-foreground">Não foi possível abrir este motorista.</p>
      )}
      {m && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {m.aceite && m.aceite !== "ACEITO" ? (
              m.aceite === "PENDENTE" ? (
                <Badge className="border-amber-200 bg-amber-50 text-amber-700">Convite enviado</Badge>
              ) : (
                <Badge className="border-border bg-muted text-muted-foreground">Recusou</Badge>
              )
            ) : (
              m.status && <StatusCadastroBadge status={m.status} />
            )}
            <Badge
              className={
                m.ativo
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-border bg-muted text-muted-foreground"
              }
            >
              {m.ativo ? "Ativo" : "Inativo"}
            </Badge>
          </div>

          <section className="rounded-lg border border-border/60 bg-card p-4">
            <h3 className="mb-3 text-sm font-semibold">Dados do motorista</h3>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Campo rotulo="CPF">
                <span className="font-mono">{formatCpf(m.cpf)}</span>
              </Campo>
              <Campo rotulo="Telefone">{m.telefone ? formatTelefone(m.telefone) : null}</Campo>
              <Campo rotulo="Email">{m.email}</Campo>
              <Campo rotulo="Transportadora">{m.transportadora?.nome}</Campo>
              <Campo rotulo="Modalidade">{m.modalidade?.nome}</Campo>
              <Campo rotulo="Chave Pix">{m.chavePix}</Campo>
              <Campo rotulo="Pagamento próprio">
                {m.tipoRemuneracao ? (REMUNERACAO_TEXTO[m.tipoRemuneracao] ?? m.tipoRemuneracao) : "Segue a modalidade"}
              </Campo>
              <Campo rotulo="Convite">{dataHora(m.convidadoEm)}</Campo>
              <Campo rotulo="Aprovado em">{dataHora(m.aprovadoEm)}</Campo>
              <Campo rotulo="Último acesso ao app">{dataHora(m.ultimoLoginEm) ?? "Nunca entrou"}</Campo>
              <Campo rotulo="Placas">
                {m.veiculos.length === 0 ? null : (
                  <span className="flex flex-wrap gap-1">
                    {m.veiculos.map((v) => (
                      <span
                        key={v.id}
                        className={`rounded px-1.5 py-0.5 font-mono text-xs ${
                          v.id === m.veiculoDefaultId
                            ? "bg-blue-100 text-blue-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                        title={v.id === m.veiculoDefaultId ? "Placa padrão" : undefined}
                      >
                        {v.placa}
                        {v.modelo ? ` · ${v.modelo}` : ""}
                      </span>
                    ))}
                  </span>
                )}
              </Campo>
              <Campo rotulo="Veículo padrão">
                {m.veiculoDefault ? (
                  <span className="font-mono">{m.veiculoDefault.placa}</span>
                ) : null}
              </Campo>
              <Permitido chave="motoristas.documentos">
                <Campo rotulo="Documentos">
                  <DocumentosBadge motoristaId={id} motoristaNome={m.nome} documentos={m.documentos} />
                </Campo>
              </Permitido>
            </dl>
          </section>

          <AppVersaoCard
            motorista={m}
            latest={{
              latestUpdateId: resumo.data?.latestUpdateId ?? null,
              latestBuiltAt: resumo.data?.latestBuiltAt ?? null,
              degradado: resumo.data?.fonte === "motoristas",
            }}
          />
          {/* Antes do resto: quem abre a ficha precisa saber por onde essa
              pessoa recebe antes de mexer em qualquer coisa que envolva dinheiro. */}
          <WhatsappSuspeitoCard
            motoristaId={id}
            inalcancavelEm={m.whatsappInalcancavelEm}
            conferencia={m}
          />
          {verConferencia && <NumeroConfirmadoCard motoristaId={id} />}
          {verConferencia && <ConferenciaCalendarioMotorista motoristaId={id} />}
          <RegimeCard regime={m.regime ?? null} motoristaId={id} />
          <AcessoAppCard motoristaId={id} conferencia={m} />
          <PedirDocumentos motoristaId={id} />
          <HistoricoNotificacoes motoristaId={id} />
        </>
      )}
    </div>
  );
}
