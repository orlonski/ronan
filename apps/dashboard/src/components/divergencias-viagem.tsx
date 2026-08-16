import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * O que o lançamento do motorista trouxe pendente.
 *
 * O servidor não recusa mais lançamento nenhum: quando falta dado ou o
 * lançamento aponta pra um cadastro que sumiu, a viagem entra assim mesmo e o
 * motivo vem carimbado aqui (ver `common/divergencias.ts` na API). Esta é a
 * ponta onde isso vira trabalho de quem confere — antes essa informação
 * simplesmente não existia deste lado: virava um "erro" na tela do motorista,
 * que não tinha como resolver nenhum desses casos, e a viagem morria no
 * celular dele.
 *
 * A maioria se resolve preenchendo o campo que falta na própria edição da
 * viagem: o backend fecha o carimbo sozinho quando o campo aparece.
 */

export type DivergenciaViagem = {
  id: string;
  motivo: string;
  detalhe: string;
  dados?: unknown;
  criadoEm?: string;
  resolvidoEm?: string | null;
  resolvidoPor?: { id: string; nome: string } | null;
};

/** Rótulo curto por motivo — o `detalhe` que vem do servidor diz o resto. */
const MOTIVO_LABEL: Record<string, string> = {
  FALTA_MATERIAL: "Sem material",
  FALTA_LOCAL_DESCARGA: "Sem local de descarga",
  FALTA_KM: "Sem km",
  FALTA_TONELADAS: "Sem peso",
  FALTA_CLIENTE: "Sem cliente",
  CADASTRO_VEICULO_SUMIU: "Placa fora do cadastro",
  CADASTRO_CLIENTE_SUMIU: "Cliente fora do cadastro",
  CADASTRO_MATERIAL_SUMIU: "Material fora do cadastro",
  CADASTRO_LOCAL_SUMIU: "Local fora do cadastro",
  CADASTRO_TIPO_SERVICO_SUMIU: "Tipo de serviço fora do cadastro",
  VIAGEM_ANTERIOR_ABERTA: "Ficou aberta",
  RESGATADA_DO_APP: "Estava presa no celular",
  PAYLOAD_PARCIAL: "App em versão antiga",
};

export function motivoDivergenciaLabel(motivo: string): string {
  return MOTIVO_LABEL[motivo] ?? motivo;
}

/** Selo compacto pra listagem: diz quantas pendências a viagem tem. */
export function DivergenciasBadge({
  divergencias,
  className,
}: {
  divergencias?: DivergenciaViagem[] | null;
  className?: string;
}) {
  const abertas = (divergencias ?? []).filter((d) => !d.resolvidoEm);
  if (abertas.length === 0) return null;

  // Uma só: mostra o motivo, que é mais útil que a contagem.
  const texto =
    abertas.length === 1 && abertas[0]
      ? motivoDivergenciaLabel(abertas[0].motivo)
      : `${abertas.length} pendências`;

  return (
    <Badge
      className={cn("gap-1 border-amber-300 bg-amber-100 text-amber-900", className)}
      title={abertas.map((d) => d.detalhe).join("\n")}
    >
      <AlertCircle className="h-3 w-3" />
      {texto}
    </Badge>
  );
}

/** Bloco do detalhe da viagem: o que houve, em português, item a item. */
export function DivergenciasCard({
  divergencias,
}: {
  divergencias?: DivergenciaViagem[] | null;
}) {
  const todas = divergencias ?? [];
  if (todas.length === 0) return null;

  const abertas = todas.filter((d) => !d.resolvidoEm);
  const resolvidas = todas.filter((d) => d.resolvidoEm);

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-amber-700" />
        <h3 className="font-semibold text-amber-900">
          {abertas.length > 0
            ? "O que falta nesta viagem"
            : "Pendências desta viagem (todas resolvidas)"}
        </h3>
      </div>

      <p className="mt-1 text-sm text-amber-800">
        O motorista lançou e o sistema aceitou. Estes pontos ficaram pendentes do
        lado de cá — a maioria se resolve preenchendo o campo na edição da viagem.
      </p>

      <ul className="mt-3 space-y-2">
        {abertas.map((d) => (
          <li key={d.id} className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="flex items-start gap-2">
              <Badge className="shrink-0 border-amber-300 bg-amber-100 text-amber-900">
                {motivoDivergenciaLabel(d.motivo)}
              </Badge>
              <p className="text-sm text-gray-800">{d.detalhe}</p>
            </div>
            {d.dados != null && (
              <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-2 text-[11px] text-gray-600">
                {JSON.stringify(d.dados, null, 2)}
              </pre>
            )}
          </li>
        ))}

        {resolvidas.map((d) => (
          <li
            key={d.id}
            className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            <p className="text-sm text-gray-500">
              <span className="font-medium">{motivoDivergenciaLabel(d.motivo)}</span> —
              resolvida{d.resolvidoPor ? ` por ${d.resolvidoPor.nome}` : ""}.
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
