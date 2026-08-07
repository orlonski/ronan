import { Injectable, Logger } from "@nestjs/common";

export type ResultadoTranscricao = {
  texto: string;
  modelo: string;
  erro?: string;
};

/**
 * Transcrição de áudio via OpenAI Whisper — genérica, recebe o buffer pronto.
 *
 * Nasceu dentro do módulo do WhatsApp, amarrada ao download da Evolution. Saiu
 * de lá quando o chat do app passou a precisar da mesma coisa: quem tem o áudio
 * (WhatsApp, MinIO, o que for) baixa e entrega o buffer; aqui só transcreve.
 *
 * Motorista que não escreve bem — analfabeto funcional, dedo grosso, dirigindo
 * — prefere áudio. A transcrição é o que faz o outro lado conseguir LER isso
 * sem parar o caminhão, e é o que torna a conversa pesquisável.
 *
 * Provider: `whisper-1` (pt-BR forte, aceita opus/m4a direto, ~US$0,006/min).
 * Sem OPENAI_API_KEY degrada em silêncio e devolve string vazia — áudio sem
 * transcrição continua tocando normalmente.
 */
@Injectable()
export class TranscricaoService {
  private readonly log = new Logger("TranscricaoService");
  private readonly modelo = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";
  private readonly apiKey = process.env.OPENAI_API_KEY ?? "";

  get configurado() {
    return this.apiKey.length > 0;
  }

  async transcreverBuffer(
    buffer: Buffer,
    mimetype: string,
    nomeArquivo = "audio.ogg",
  ): Promise<ResultadoTranscricao> {
    if (!this.configurado) {
      return { texto: "", modelo: this.modelo, erro: "OPENAI_API_KEY ausente" };
    }
    try {
      const form = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mimetype });
      form.append("file", blob, nomeArquivo);
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
   * Whisper costuma alucinar frases conhecidas quando o áudio é silêncio ou só
   * ruído — e num caminhão em movimento isso acontece bastante.
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
