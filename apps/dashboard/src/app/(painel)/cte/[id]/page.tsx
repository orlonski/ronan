"use client";

import * as React from "react";
import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, CircleAlert, Clock, Copy, FileText, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { RequerTela } from "@/components/requer-tela";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadingCard } from "@/components/loading";
import { fetchApi, useAuthToken } from "@/lib/client-api";

type Documento = {
  id: string;
  viagemId: string | null;
  modelo: string;
  serie: number;
  numero: number;
  chave: string;
  ambiente: number;
  emissor: string;
  status: "RASCUNHO" | "ENVIADO" | "AUTORIZADO" | "REJEITADO" | "CANCELADO" | "ERRO";
  protocolo: string | null;
  autorizadoEm: string | null;
  codigoRetorno: string | null;
  motivo: string | null;
  payload: unknown;
  retorno: unknown;
  xml: string | null;
  canceladoEm: string | null;
  cancelamentoMotivo: string | null;
  criadoEm: string;
};

const VISUAL: Record<Documento["status"], { rotulo: string; classe: string; Icone: typeof CheckCircle2 }> = {
  AUTORIZADO: { rotulo: "Autorizado", classe: "bg-emerald-100 text-emerald-800", Icone: CheckCircle2 },
  REJEITADO: { rotulo: "Rejeitado", classe: "bg-red-100 text-red-800", Icone: CircleAlert },
  ERRO: { rotulo: "Falhou no envio", classe: "bg-amber-100 text-amber-800", Icone: CircleAlert },
  ENVIADO: { rotulo: "Enviado", classe: "bg-blue-100 text-blue-800", Icone: Clock },
  RASCUNHO: { rotulo: "Rascunho", classe: "bg-slate-100 text-slate-700", Icone: FileText },
  CANCELADO: { rotulo: "Cancelado", classe: "bg-slate-200 text-slate-700", Icone: Ban },
};

export default function DetalheCtePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequerTela chave="cte.ver">
      <Conteudo id={id} />
    </RequerTela>
  );
}

/**
 * Os dois lados da conversa com a SEFAZ.
 *
 * Sem isto, uma rejeição vira "deu erro" e vira discussão sobre o que foi
 * mandado. O documento guarda o que saiu e o que voltou desde o rascunho —
 * esta tela só mostra.
 */
function Conteudo({ id }: { id: string }) {
  const token = useAuthToken();
  const { data, isLoading } = useQuery({
    queryKey: ["cte", "detalhe", id],
    enabled: Boolean(token),
    queryFn: () => fetchApi<Documento>(`/admin/cte/${id}`, { token: token! }),
  });

  if (isLoading || !data) return <LoadingCard />;
  const vis = VISUAL[data.status];

  return (
    <div className="space-y-5">
      <div>
        <Link href="/cte" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> CT-e emitidos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          CT-e nº {data.numero} · série {data.serie}
        </h1>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={`border-transparent ${vis.classe}`}>
            <vis.Icone className="mr-1 h-3 w-3" /> {vis.rotulo}
          </Badge>
          {data.emissor === "SIMULADOR" && (
            <Badge className="border-transparent bg-purple-100 text-purple-800">
              <FlaskConical className="mr-1 h-3 w-3" /> Simulado
            </Badge>
          )}
          {data.ambiente === 2 && (
            <Badge className="border-transparent bg-slate-100 text-slate-600">Homologação</Badge>
          )}
          {/* Série reservada de teste: o documento existe, mas não faz parte da
              numeração fiscal da empresa. */}
          {data.serie === 999 && (
            <Badge className="border-transparent bg-amber-100 text-amber-800">Emissão de teste</Badge>
          )}
        </div>

        <Campo rotulo="Chave" valor={data.chave} copiavel />
        {data.protocolo && <Campo rotulo="Protocolo" valor={data.protocolo} copiavel />}
        {data.codigoRetorno && (
          <Campo rotulo="Retorno da SEFAZ" valor={`${data.codigoRetorno} — ${data.motivo ?? ""}`} />
        )}
        {!data.codigoRetorno && data.motivo && <Campo rotulo="Situação" valor={data.motivo} />}
        <Campo
          rotulo="Emitido em"
          valor={new Date(data.criadoEm).toLocaleString("pt-BR")}
        />
        {data.canceladoEm && (
          <Campo
            rotulo="Cancelado"
            valor={`${new Date(data.canceladoEm).toLocaleString("pt-BR")} — ${data.cancelamentoMotivo ?? ""}`}
          />
        )}
        {data.viagemId && (
          <Link href={`/viagens/${data.viagemId}`} className="text-sm underline">
            Ver a viagem
          </Link>
        )}
      </Card>

      {/* O XML assinado é o documento. Ele precisa ser guardado por cinco anos,
          e é o que se manda pro contador quando alguém pergunta. */}
      <Bloco
        titulo="XML enviado"
        subtitulo="O documento como ele saiu daqui — é este que a SEFAZ conferiu."
        conteudo={data.xml}
        nome={`cte-${data.chave}.xml`}
      />

      <Bloco
        titulo="Resposta da SEFAZ"
        subtitulo="O que voltou, cru. É aqui que mora o motivo real de uma rejeição."
        conteudo={
          data.retorno ? JSON.stringify(data.retorno, null, 2) : null
        }
        nome={`retorno-${data.chave}.json`}
      />

      <Bloco
        titulo="Dados montados"
        subtitulo="Campo a campo, antes de virar XML. Serve pra achar de onde veio um valor errado."
        conteudo={data.payload ? JSON.stringify(data.payload, null, 2) : null}
        nome={`payload-${data.chave}.json`}
      />
    </div>
  );
}

function Campo({ rotulo, valor, copiavel }: { rotulo: string; valor: string; copiavel?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="w-40 shrink-0 text-sm text-muted-foreground">{rotulo}</span>
      <span className="flex-1 break-all font-mono text-sm">{valor}</span>
      {copiavel && (
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            void navigator.clipboard.writeText(valor);
            toast.success("Copiado.");
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Um bloco de texto cru, fechado por padrão.
 *
 * Fechado porque a página é pra diagnóstico e não pra leitura: quem abre quer
 * saber o status, e só quando algo deu errado é que quer os 6 KB de XML.
 */
function Bloco({
  titulo,
  subtitulo,
  conteudo,
  nome,
}: {
  titulo: string;
  subtitulo: string;
  conteudo: string | null;
  nome: string;
}) {
  const [aberto, setAberto] = React.useState(false);
  if (!conteudo) {
    return (
      <Card className="p-4">
        <p className="font-medium">{titulo}</p>
        <p className="text-sm text-muted-foreground">Nada guardado aqui.</p>
      </Card>
    );
  }
  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{titulo}</p>
          <p className="text-sm text-muted-foreground">{subtitulo}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setAberto((v) => !v)}>
            {aberto ? "Esconder" : "Ver"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(conteudo);
              toast.success(`${titulo} copiado.`);
            }}
          >
            <Copy className="h-3.5 w-3.5" /> Copiar
          </Button>
        </div>
      </div>
      {aberto && (
        <pre className="max-h-96 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
          {conteudo}
        </pre>
      )}
      <p className="text-xs text-muted-foreground">
        {(conteudo.length / 1024).toFixed(1)} KB · {nome}
      </p>
    </Card>
  );
}
