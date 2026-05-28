import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { CriarAbastecimentoInput } from "@ronan/shared-types";
import { ScreenHeader } from "@/components/screen-header";
import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, type SelectOption } from "@/components/ui/select";
import { PhotoCapture } from "@/components/photo-capture";
import { humanizeApiError } from "@/lib/api";
import { humanizeZodError } from "@/lib/validation";
import { hojeISO } from "@/lib/datetime";
import {
  useAbastecimentos,
  useCatalogos,
  useCriarAbastecimento,
  useMe,
  usePostosRecentes,
} from "@/lib/queries";
import { gerarClientId } from "@/lib/utils";
import type { FotoComprimida } from "@/lib/photo";

type TipoCombustivel = "DIESEL_S10" | "DIESEL_S500" | "ARLA_32" | "GASOLINA" | "ETANOL";

const TIPOS: { value: TipoCombustivel; label: string }[] = [
  { value: "DIESEL_S10", label: "Diesel S10" },
  { value: "DIESEL_S500", label: "Diesel S500" },
  { value: "ARLA_32", label: "ARLA 32" },
  { value: "GASOLINA", label: "Gasolina" },
  { value: "ETANOL", label: "Etanol" },
];

function combinarDataComHoraAtual(dataYmd: string): string {
  const agora = new Date();
  const [y, m, d] = dataYmd.split("-").map(Number);
  const dt = new Date(
    y!,
    (m ?? 1) - 1,
    d ?? 1,
    agora.getHours(),
    agora.getMinutes(),
    agora.getSeconds(),
  );
  return dt.toISOString();
}

export default function NovoAbastecimentoPage() {
  const navigate = useNavigate();
  const me = useMe();
  const cat = useCatalogos();
  const criar = useCriarAbastecimento();
  const postos = usePostosRecentes();
  const recentes = useAbastecimentos();

  const [veiculoId, setVeiculoId] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [data, setData] = useState(hojeISO());
  const [tipo, setTipo] = useState<TipoCombustivel>("DIESEL_S10");
  const [litros, setLitros] = useState("");
  const [valor, setValor] = useState("");
  const [emComboio, setEmComboio] = useState(false);
  const [odometro, setOdometro] = useState("");
  const [postoNome, setPostoNome] = useState("");
  const [tanqueCheio, setTanqueCheio] = useState(true);
  const [observacao, setObservacao] = useState("");
  const [foto, setFoto] = useState<FotoComprimida | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (me.data?.veiculoDefaultId && !veiculoId) {
      setVeiculoId(me.data.veiculoDefaultId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data]);

  const veiculoOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.veiculos ?? []).map((v) => ({
        value: v.id,
        label: v.placa,
        sublabel: v.modelo ?? undefined,
      })),
    [cat.data?.veiculos],
  );

  const empresaOptions: SelectOption[] = useMemo(
    () =>
      (cat.data?.empresas ?? []).map((e) => ({
        value: e.id,
        label: e.nome,
      })),
    [cat.data?.empresas],
  );

  const tipoOptions: SelectOption[] = useMemo(
    () => TIPOS.map((t) => ({ value: t.value, label: t.label })),
    [],
  );

  const precoLitro = useMemo(() => {
    const l = parseFloat(litros.replace(",", "."));
    const v = parseFloat(valor.replace(",", "."));
    if (!Number.isFinite(l) || !Number.isFinite(v) || l <= 0) return null;
    return v / l;
  }, [litros, valor]);

  const ultimoOdometroDoVeiculo = useMemo<number | null>(() => {
    if (!veiculoId || !recentes.data) return null;
    const doVeiculo = recentes.data.filter((a) => a.veiculo.id === veiculoId);
    if (doVeiculo.length === 0) return null;
    return Math.max(...doVeiculo.map((a) => a.odometro));
  }, [veiculoId, recentes.data]);

  async function salvar() {
    setErro(null);
    if (!veiculoId) return setErro("Escolha a placa.");
    if (!empresaId) return setErro("Escolha a empresa.");
    const litrosNum = parseFloat(litros.replace(",", "."));
    if (!Number.isFinite(litrosNum) || litrosNum <= 0) {
      return setErro("Informe os litros.");
    }
    const valorNum = parseFloat(valor.replace(",", "."));
    if (!emComboio && (!Number.isFinite(valorNum) || valorNum <= 0)) {
      return setErro('Informe o valor (ou marque "em comboio").');
    }
    const odometroNum = parseInt(odometro.replace(/\D/g, ""), 10);
    if (!Number.isFinite(odometroNum) || odometroNum < 0) {
      return setErro("Informe o odômetro.");
    }
    if (
      ultimoOdometroDoVeiculo !== null &&
      odometroNum < ultimoOdometroDoVeiculo
    ) {
      return setErro(
        `Odômetro (${odometroNum} km) é menor que o último registrado pra esse veículo (${ultimoOdometroDoVeiculo} km).`,
      );
    }

    setSubmitting(true);
    try {
      const payload = {
        clientId: gerarClientId(),
        veiculoId,
        empresaId,
        data: combinarDataComHoraAtual(data),
        tipo,
        litros: litrosNum,
        valorTotal: emComboio ? undefined : valorNum,
        emComboio,
        odometro: odometroNum,
        postoNome: postoNome.trim() || undefined,
        tanqueCheio,
        observacao: observacao.trim() || undefined,
        criadoOfflineEm: new Date().toISOString(),
      };
      const parsed = CriarAbastecimentoInput.safeParse(payload);
      if (!parsed.success) {
        setErro(humanizeZodError(parsed.error));
        setSubmitting(false);
        return;
      }

      await criar({
        payload,
        foto: foto ? { blob: foto.blob, mime: foto.mime } : undefined,
      });
      navigate(-1);
    } catch (err) {
      setErro(humanizeApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen-safe flex-col bg-background pb-20">
      <ScreenHeader title="Novo abastecimento" />

      {(cat.isLoading || me.isLoading) && !cat.data && !me.data && (
        <div className="py-8 text-center text-sm text-muted-foreground">Carregando dados...</div>
      )}

      {cat.data && (
        <div className="space-y-4 p-4 pb-32">
          <div className="space-y-2">
            <Label>Placa</Label>
            <Select
              value={veiculoId}
              onChange={setVeiculoId}
              options={veiculoOptions}
              placeholder="Escolha a placa"
              searchable
              title="Placa"
            />
          </div>

          <div className="space-y-2">
            <Label>Empresa</Label>
            <Select
              value={empresaId}
              onChange={setEmpresaId}
              options={empresaOptions}
              placeholder="Escolha a empresa"
              searchable
              title="Empresa"
              emptyMessage="Nenhuma empresa cadastrada"
            />
          </div>

          <div className="space-y-2">
            <Label>Data</Label>
            <DateField value={data} onChange={setData} disabled={submitting} />
          </div>

          <div className="space-y-2">
            <Label>Tipo de combustível</Label>
            <Select
              value={tipo}
              onChange={(v) => setTipo(v as TipoCombustivel)}
              options={tipoOptions}
              placeholder="Tipo"
              title="Combustível"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-2">
              <Label htmlFor="litros">Litros</Label>
              <Input
                id="litros"
                value={litros}
                onChange={(e) => setLitros(e.target.value)}
                inputMode="decimal"
                placeholder="0,000"
                disabled={submitting}
                maxLength={8}
              />
              <p className="text-xs text-muted-foreground">Em litros (máx 2000)</p>
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="valor">Valor (R$)</Label>
              <Input
                id="valor"
                value={emComboio ? "" : valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                placeholder={emComboio ? "—" : "0,00"}
                disabled={submitting || emComboio}
                maxLength={8}
              />
              <p className="text-xs text-muted-foreground">
                {emComboio ? "Preenchido depois pelo escritório" : "Em R$ (máx 50000)"}
              </p>
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <input
              type="checkbox"
              checked={emComboio}
              onChange={(e) => setEmComboio(e.target.checked)}
              disabled={submitting}
              className="mt-1 h-5 w-5 accent-primary"
            />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Abastecimento em comboio</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Marque se ainda não soube o valor. O escritório completa depois.
              </p>
            </div>
          </label>

          {!emComboio && precoLitro !== null && (
            <div className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">Preço por litro</p>
              <p className="text-base font-semibold">
                R$ {precoLitro.toFixed(3).replace(".", ",")}/L
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="odometro">Odômetro (km)</Label>
            <Input
              id="odometro"
              value={odometro}
              onChange={(e) => setOdometro(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              placeholder="123456"
              disabled={submitting}
              maxLength={8}
            />
            {ultimoOdometroDoVeiculo !== null && (
              <p className="text-xs text-muted-foreground">
                Último registrado: {ultimoOdometroDoVeiculo.toLocaleString("pt-BR")} km
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="posto">Posto</Label>
            <Input
              id="posto"
              value={postoNome}
              onChange={(e) => setPostoNome(e.target.value)}
              placeholder='ex: "Posto Trevo BR-376"'
              autoCapitalize="words"
              disabled={submitting}
              maxLength={120}
            />
            {postos.data && postos.data.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {postos.data.slice(0, 5).map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => setPostoNome(p)}
                    className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="flex-1 pr-2">
              <p className="font-medium text-foreground">Tanque cheio</p>
              <p className="text-xs text-muted-foreground">
                Marque se completou o tanque — usado pra calcular consumo médio.
              </p>
            </div>
            <input
              type="checkbox"
              checked={tanqueCheio}
              onChange={(e) => setTanqueCheio(e.target.checked)}
              disabled={submitting}
              className="h-5 w-5 accent-primary"
            />
          </label>

          <div className="space-y-2">
            <Label htmlFor="obs">Observação</Label>
            <Input
              id="obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="opcional"
              disabled={submitting}
              maxLength={500}
            />
          </div>

          <div className="space-y-2">
            <Label>Foto do comprovante</Label>
            <p className="text-xs text-muted-foreground">opcional</p>
            <PhotoCapture value={foto} onChange={setFoto} obrigatorio={false} label="" />
          </div>

          {erro && (
            <p className="rounded-xl border-2 border-destructive bg-destructive/10 p-3 text-sm font-medium text-destructive whitespace-pre-line">
              {erro}
            </p>
          )}
        </div>
      )}

      {cat.data && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background p-4 pb-safe">
          <Button onClick={salvar} size="xl" className="w-full" loading={submitting}>
            <Check size={20} />
            {submitting ? "Salvando..." : "Salvar abastecimento"}
          </Button>
        </div>
      )}
    </div>
  );
}
