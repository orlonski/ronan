/**
 * Gravação e reprodução de áudio do chat.
 *
 * Envolve o `expo-audio` num par de hooks bem burros de propósito, porque a
 * tela do chat já tem complexidade demais: quem chama só quer "começa",
 * "para e me dá o arquivo" e "toca isso aqui".
 *
 * Importante: `expo-audio` é módulo NATIVO. Este arquivo só funciona em build
 * novo — não vai por OTA pra quem está na 1.0.5.
 */

import { useCallback, useEffect, useState } from "react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { MAX_DURACAO_AUDIO_SEG } from "@ronan/shared-types";

export type GravacaoPronta = {
  uri: string;
  /** Segundos inteiros — áudio de 0s não existe, então o piso é 1. */
  duracaoSegundos: number;
  mimetype: string;
};

export type MotivoFalhaGravacao = "permissao" | "hardware";

/**
 * Gravador do chat. Devolve o estado que a UI mostra (gravando, quantos
 * segundos) e as três ações.
 *
 * `atingiuTeto` existe pra a tela cortar sozinha no limite de duração: sem
 * isso, um motorista que esquece o dedo no botão manda um arquivo de 40
 * minutos que não sobe em 4G e ainda custa caro de transcrever.
 */
export function useGravadorChat() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const estado = useAudioRecorderState(recorder);
  const [erro, setErro] = useState<MotivoFalhaGravacao | null>(null);

  const segundos = Math.floor((estado.durationMillis ?? 0) / 1000);

  const comecar = useCallback(async (): Promise<boolean> => {
    setErro(null);
    try {
      const permissao = await requestRecordingPermissionsAsync();
      if (!permissao.granted) {
        setErro("permissao");
        return false;
      }
      // Sem `allowsRecording`, o iOS mantém a sessão em modo de playback e a
      // gravação sai praticamente muda depois que o app já tocou algum som.
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      return true;
    } catch {
      setErro("hardware");
      return false;
    }
  }, [recorder]);

  const parar = useCallback(async (): Promise<GravacaoPronta | null> => {
    try {
      // Lê a duração ANTES do stop: depois de parar o estado zera, e a bolha
      // sairia com "0:00".
      const duracaoMs = estado.durationMillis ?? 0;
      await recorder.stop();
      const uri = recorder.uri;
      // Devolve o mic pro sistema; senão a voz da navegação (expo-speech) sai
      // abafada depois de gravar.
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
      });
      if (!uri) return null;
      return {
        uri,
        duracaoSegundos: Math.max(1, Math.round(duracaoMs / 1000)),
        mimetype: "audio/m4a",
      };
    } catch {
      setErro("hardware");
      return null;
    }
  }, [recorder, estado.durationMillis]);

  const cancelar = useCallback(async (): Promise<void> => {
    try {
      if (recorder.isRecording) await recorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
      });
    } catch {
      /* já parado — nada a desfazer */
    }
  }, [recorder]);

  return {
    gravando: estado.isRecording,
    segundos,
    atingiuTeto: segundos >= MAX_DURACAO_AUDIO_SEG,
    erro,
    comecar,
    parar,
    cancelar,
  };
}

/** Player de uma bolha de áudio. Um por bolha. */
export function usePlayerChat(source: { uri: string; headers?: Record<string, string> } | null) {
  const player = useAudioPlayer(source ?? null);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    // Terminou: volta pro começo, senão o próximo play cai direto no fim.
    if (status.didJustFinish) {
      void player.seekTo(0);
      player.pause();
    }
  }, [status.didJustFinish, player]);

  const alternar = useCallback(async () => {
    if (!source) return;
    if (player.playing) {
      player.pause();
      return;
    }
    // Configura a sessão pra TOCAR antes de dar play.
    //
    // Sem isso o iPhone com o botãozinho lateral no silencioso simplesmente
    // não emite som — o play "funciona" (a barra anda) e o motorista jura que
    // o áudio está quebrado. E se ele acabou de gravar, a sessão ainda está em
    // modo de gravação, o que deixa a reprodução muda mesmo com o som ligado.
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "duckOthers",
      });
    } catch {
      /* se falhar, tenta tocar assim mesmo */
    }
    player.play();
  }, [player, source]);

  return {
    tocando: status.playing,
    posicaoSeg: Math.floor(status.currentTime ?? 0),
    carregado: status.isLoaded,
    alternar,
  };
}

/** mm:ss pra mostrar duração/posição na bolha. */
export function fmtDuracao(segundos: number): string {
  const mm = Math.floor(segundos / 60);
  const ss = String(Math.max(0, segundos % 60)).padStart(2, "0");
  return `${mm}:${ss}`;
}
