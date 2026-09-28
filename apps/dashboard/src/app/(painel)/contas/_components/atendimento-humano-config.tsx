"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { fetchApi, useAuthToken } from "@/lib/client-api";

/** O que esta seção lê e escreve em `/admin/contas/configuracao`. */
export type ConfigAtendimentoHumano = {
  sdrAtendenteNome: string;
  sdrLinkApresentacao: string;
  sdrHorariosDemo: string[];
  chatwootTimeComercialId: number | null;
  chatwootTimeOperacaoId: number | null;
  alertaComercialTelefones: string[];
  alertaEscalonarTelefones: string[];
  alertaEscalonarMinutos: number;
  atendimentoHoraInicio: number;
  atendimentoHoraFim: number;
  atendimentoDias: number[];
};

const PATH = "/admin/contas/configuracao";
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** "(42) 99999-8888, 42 98888 7777" → ["5542999998888", "5542988887777"]. */
function telefonesDoTexto(texto: string): string[] {
  return texto
    .split(/[,;\n]/)
    .map((t) => t.replace(/\D/g, ""))
    .filter(Boolean)
    .map((d) => (d.startsWith("55") ? d : `55${d}`));
}

/** "5542999998888" → "(42) 99999-8888", pra ler na tela. */
function telefoneBonito(d: string): string {
  const s = d.replace(/^55/, "");
  if (s.length === 11) return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`;
  if (s.length === 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
  return d;
}

/**
 * Quando o robô passa a conversa pra uma pessoa: quem atende, quem é avisado,
 * em que horário.
 *
 * Existe porque, até aqui, "alguém vai te chamar em breve" era uma etiqueta no
 * Chatwoot que ninguém olhava — e dez leads ficaram esperando. O nome aparece
 * pro prospect; os telefones recebem o aviso no WhatsApp com o botão que abre
 * a conversa.
 */
export function AtendimentoHumanoConfig({
  data,
  onSalvo,
}: {
  data: ConfigAtendimentoHumano;
  onSalvo: () => void;
}) {
  const token = useAuthToken();
  const [nome, setNome] = useState("");
  const [link, setLink] = useState("");
  const [avisar, setAvisar] = useState("");
  const [escalonar, setEscalonar] = useState("");
  const [horarios, setHorarios] = useState("");

  const { data: times } = useQuery({
    queryKey: [PATH, "times"],
    enabled: !!token,
    queryFn: () => fetchApi<{ id: number; nome: string }[]>("/admin/contas/chatwoot/times", { token }),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    setNome(data.sdrAtendenteNome);
    setLink(data.sdrLinkApresentacao);
    setAvisar(data.alertaComercialTelefones.map(telefoneBonito).join(", "));
    setEscalonar(data.alertaEscalonarTelefones.map(telefoneBonito).join(", "));
    setHorarios(data.sdrHorariosDemo.join(", "));
  }, [data]);

  async function salvar(mudanca: Partial<ConfigAtendimentoHumano>, aviso: string) {
    try {
      await fetchApi(PATH, { method: "PATCH", token, body: JSON.stringify(mudanca) });
      toast.success(aviso);
      onSalvo();
    } catch (e) {
      toast.error("Não foi possível salvar", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  }

  const semAviso = data.alertaComercialTelefones.length === 0;

  return (
    <div className="w-full space-y-3 border-t pt-3 text-sm">
      <div>
        <p className="font-medium">Quando o robô passa a conversa pra uma pessoa</p>
        <p className="text-muted-foreground">
          Ele sai da conversa na hora, diz pro cliente quem vai atender e avisa quem está abaixo.
          Qualquer coisa feita por gente no Chatwoot (responder, atribuir, etiquetar) também tira o
          robô da conversa.
        </p>
        {semAviso && (
          <p className="mt-1 font-medium text-amber-700 dark:text-amber-500">
            Ninguém recebe aviso no WhatsApp ainda — preencha quem é avisado.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <Label htmlFor="atendenteNome" className="text-xs">
            Quem atende (o cliente vê este nome)
          </Label>
          <Input
            id="atendenteNome"
            value={nome}
            placeholder="ex.: Fernando"
            onChange={(e) => setNome(e.target.value)}
            onBlur={() => {
              if (nome.trim() === data.sdrAtendenteNome) return;
              void salvar({ sdrAtendenteNome: nome.trim() }, "Nome de quem atende salvo.");
            }}
          />
        </div>

        <div>
          <Label htmlFor="avisarTelefones" className="text-xs">
            Quem é avisado no WhatsApp
          </Label>
          <Input
            id="avisarTelefones"
            value={avisar}
            placeholder="(42) 99999-8888, …"
            onChange={(e) => setAvisar(e.target.value)}
            onBlur={() => {
              const lista = telefonesDoTexto(avisar);
              if (lista.join() === data.alertaComercialTelefones.join()) return;
              void salvar({ alertaComercialTelefones: lista }, "Quem é avisado foi atualizado.");
            }}
          />
        </div>

        <div>
          <Label htmlFor="escalonarTelefones" className="text-xs">
            Se ninguém responder em {data.alertaEscalonarMinutos} min, avisar
          </Label>
          <Input
            id="escalonarTelefones"
            value={escalonar}
            placeholder="(42) 99999-8888"
            onChange={(e) => setEscalonar(e.target.value)}
            onBlur={() => {
              const lista = telefonesDoTexto(escalonar);
              if (lista.join() === data.alertaEscalonarTelefones.join()) return;
              void salvar({ alertaEscalonarTelefones: lista }, "Escalonamento atualizado.");
            }}
          />
        </div>

        <div>
          <Label className="text-xs">Time no Chatwoot (vendas)</Label>
          <Select
            value={data.chatwootTimeComercialId ?? ""}
            onChange={(e) =>
              void salvar(
                { chatwootTimeComercialId: e.target.value ? Number(e.target.value) : null },
                "Time de vendas salvo.",
              )
            }
          >
            <option value="">Nenhum (só etiqueta)</option>
            {(times ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label className="text-xs">Time no Chatwoot (operação)</Label>
          <Select
            value={data.chatwootTimeOperacaoId ?? ""}
            onChange={(e) =>
              void salvar(
                { chatwootTimeOperacaoId: e.target.value ? Number(e.target.value) : null },
                "Time de operação salvo.",
              )
            }
          >
            <option value="">Nenhum (só etiqueta)</option>
            {(times ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="linkApresentacao" className="text-xs">
            O que ele mostra na primeira mensagem
          </Label>
          <Input
            id="linkApresentacao"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onBlur={() => {
              const v = link.trim();
              if (!v || v === data.sdrLinkApresentacao) {
                setLink(data.sdrLinkApresentacao);
                return;
              }
              void salvar({ sdrLinkApresentacao: v }, "Link da apresentação salvo.");
            }}
          />
        </div>

        <div>
          <Label htmlFor="horariosDemo" className="text-xs">
            Horários que ele oferece pra ligação
          </Label>
          <Input
            id="horariosDemo"
            value={horarios}
            placeholder="09:00, 10:30, 14:00, 16:00"
            onChange={(e) => setHorarios(e.target.value)}
            onBlur={() => {
              const lista = horarios
                .split(/[,;\s]+/)
                .map((h) => h.trim())
                .filter(Boolean);
              if (lista.join() === data.sdrHorariosDemo.join()) return;
              void salvar({ sdrHorariosDemo: lista }, "Horários de ligação salvos.");
            }}
          />
        </div>

        <div className="sm:col-span-2">
          <Label className="text-xs">Horário de atendimento</Label>
          <div className="flex flex-wrap items-center gap-2">
            <span>das</span>
            <Select
              value={data.atendimentoHoraInicio}
              onChange={(e) =>
                void salvar({ atendimentoHoraInicio: Number(e.target.value) }, "Horário salvo.")
              }
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </Select>
            <span>às</span>
            <Select
              value={data.atendimentoHoraFim}
              onChange={(e) =>
                void salvar({ atendimentoHoraFim: Number(e.target.value) }, "Horário salvo.")
              }
            >
              {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </Select>
            {DIAS.map((d, i) => {
              const ativo = data.atendimentoDias.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() =>
                    void salvar(
                      {
                        atendimentoDias: ativo
                          ? data.atendimentoDias.filter((x) => x !== i)
                          : [...data.atendimentoDias, i].sort(),
                      },
                      "Dias de atendimento salvos.",
                    )
                  }
                  className={`rounded-md border px-2 py-1 text-xs ${
                    ativo ? "border-blue-600 bg-blue-600 text-white" : "hover:bg-accent/40"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Fora desse horário o robô diz quando alguém responde, e o prazo do aviso só começa a
            contar na abertura.
          </p>
        </div>
      </div>
    </div>
  );
}
