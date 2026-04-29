import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export type SugestaoEndereco = {
  fonte: "VIACEP";
  logradouro?: string;
  bairro?: string;
  cidade: string;
  uf: string;
  cep?: string;
};

type ViaCepResponse = {
  cep: string;
  logradouro: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
};

@Injectable()
export class GeocodingService {
  private readonly log = new Logger(GeocodingService.name);

  constructor(private readonly config: ConfigService) {}

  async buscarPorCep(cepRaw: string): Promise<SugestaoEndereco | null> {
    const cep = cepRaw.replace(/\D/g, "");
    if (cep.length !== 8) return null;
    const base = this.config.get<string>("VIACEP_URL") ?? "https://viacep.com.br/ws";
    try {
      const res = await fetch(`${base}/${cep}/json/`);
      if (!res.ok) return null;
      const data = (await res.json()) as ViaCepResponse;
      if (data.erro) return null;
      return {
        fonte: "VIACEP",
        logradouro: data.logradouro || undefined,
        bairro: data.bairro || undefined,
        cidade: data.localidade,
        uf: data.uf,
        cep: data.cep,
      };
    } catch (err) {
      this.log.warn(`ViaCEP falhou: ${(err as Error).message}`);
      return null;
    }
  }
}
