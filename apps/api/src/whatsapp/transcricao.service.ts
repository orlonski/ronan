import { Injectable, Logger } from "@nestjs/common";
import { EvolutionClientService } from "./evolution-client.service";

/**
 * Transcreve áudios do WhatsApp via OpenAI Whisper. Motorista que não escreve
 * bem (analfabeto funcional, dedo gordo, dirigindo) prefere áudio — sem isso
 * o agente WhatsApp não dá conta da realidade dele.
 *
 * Provider: OpenAI `whisper-1` (pt-BR forte, aceita opus direto, USD ~0,006/min).
 * Sem OPENAI_API_KEY o serviço degrada silencioso e devolve string vazia.
 */
@Injectable()
export class TranscricaoService {
  private readonly log = new Logger("TranscricaoService");
  private readonly modelo = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";
  private readonly apiKey = process.env.OPENAI_API_KEY ?? "";

  constructor(private readonly evolution: EvolutionClientService) {}

  get configurado() {
    return this.apiKey.length > 0;
  }

  async transcrever(payload: { key: unknown; message: unknown }): Promise<{
    texto: string;
    modelo: string;
    erro?: string;
  }> {
    if (!this.configurado) {
      return { texto: "", modelo: this.modelo, erro: "OPENAI_API_KEY ausente" };
    }
    const midia = await this.evolution.baixarMidia(payload);
    if (!midia) return { texto: "", modelo: this.modelo, erro: "Falha ao baixar áudio" };

    try {
      const form = new FormData();
      const blob = new Blob([new Uint8Array(midia.buffer)], { type: midia.mimetype });
      form.append("file", blob, "audio.ogg");
      form.append("model", this.modelo);
      form.append("language", "pt");
      form.append("response_format", "text");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const detalhe = await res.text().catch(() => "");
        this.log.warn(`Whisper falhou ${res.status}: ${detalhe.slice(0, 200)}`);
        return { texto: "", modelo: this.modelo, erro: `HTTP ${res.status}` };
      }
      const texto = (await res.text()).trim();
      if (this.eAlucinacao(texto)) {
        this.log.log(`Alucinação detectada e ignorada: "${texto.slice(0, 80)}"`);
        return { texto: "", modelo: this.modelo, erro: "Áudio sem fala (silêncio/ruído)" };
      }
      return { texto, modelo: this.modelo };
    } catch (e) {
      this.log.error(`Erro Whisper: ${(e as Error).message}`);
      return { texto: "", modelo: this.modelo, erro: (e as Error).message };
    }
  }

  /**
   * Whisper costuma alucinar frases conhecidas quando o áudio é silêncio ou
   * só ruído. Filtra essas pra evitar enviar pro agente.
   */
  private eAlucinacao(texto: string): boolean {
    if (!texto) return false;
    const t = texto.toLowerCase();
    const frases = [
      "subtítulos pela comunidade",
      "amara.org",
      "legendas pela comunidade",
      "obrigado por assistir",
      "thanks for watching",
    ];
    return frases.some((f) => t.includes(f));
  }
}
