import { useEffect, useRef, useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { Camera, Crop, RotateCcw, RotateCw, X } from "lucide-react-native";
import {
  ActivityIndicator,
  Image,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";

export type CapturedPhoto = { uri: string; mime: string };

export function PhotoCapture({
  value,
  onChange,
}: {
  value: CapturedPhoto | null;
  onChange: (p: CapturedPhoto | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [taking, setTaking] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  async function abrir() {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) return;
    }
    setPreviewUri(null);
    setCropping(false);
    setOpen(true);
  }

  async function capturar() {
    if (!cameraRef.current || taking) return;
    setTaking(true);
    try {
      const shot = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!shot?.uri) return;
      // Comprime + redimensiona pra max 1920px largura (foto de ticket nao precisa mais)
      const compressed = await ImageManipulator.manipulateAsync(
        shot.uri,
        [{ resize: { width: 1920 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      setPreviewUri(compressed.uri);
    } finally {
      setTaking(false);
    }
  }

  function refazer() {
    setCropping(false);
    setPreviewUri(null);
  }

  function confirmar() {
    if (!previewUri) return;
    onChange({ uri: previewUri, mime: "image/jpeg" });
    setOpen(false);
    setCropping(false);
    setPreviewUri(null);
  }

  function descartar() {
    setOpen(false);
    setCropping(false);
    setPreviewUri(null);
  }

  return (
    <>
      {value ? (
        <View className="gap-2">
          <View className="overflow-hidden rounded-lg border border-border">
            <Image
              source={{ uri: value.uri }}
              style={{ width: "100%", aspectRatio: 4 / 3 }}
              resizeMode="cover"
            />
          </View>
          <View className="flex-row gap-2">
            <Button variant="outline" size="sm" className="flex-1" onPress={abrir}>
              <Camera size={16} color="#0f172a" />
              <Text className="text-sm font-medium text-foreground">Refazer</Text>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="flex-1"
              onPress={() => onChange(null)}
            >
              <X size={16} color="#0f172a" />
              <Text className="text-sm font-medium text-foreground">Remover</Text>
            </Button>
          </View>
        </View>
      ) : (
        <Pressable
          onPress={abrir}
          className="h-32 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30"
        >
          <Camera size={28} color="#64748b" />
          <Text className="text-sm font-medium text-muted-foreground">
            Tocar para abrir a câmera
          </Text>
        </Pressable>
      )}

      <Modal
        visible={open}
        animationType="slide"
        onRequestClose={descartar}
        statusBarTranslucent
      >
        <View className="flex-1 bg-black">
          {previewUri && cropping ? (
            <CropMode
              uri={previewUri}
              onDone={(novaUri) => {
                setPreviewUri(novaUri);
                setCropping(false);
              }}
              onCancelar={() => setCropping(false)}
            />
          ) : previewUri ? (
            <PreviewMode
              uri={previewUri}
              onRefazer={refazer}
              onRecortar={() => setCropping(true)}
              onConfirmar={confirmar}
              onCancelar={descartar}
            />
          ) : (
            <CaptureMode
              cameraRef={cameraRef}
              taking={taking}
              onCapturar={capturar}
              onCancelar={descartar}
              hasPermission={permission?.granted ?? false}
              onRequestPermission={requestPermission}
            />
          )}
        </View>
      </Modal>
    </>
  );
}

function CaptureMode({
  cameraRef,
  taking,
  onCapturar,
  onCancelar,
  hasPermission,
  onRequestPermission,
}: {
  cameraRef: React.RefObject<CameraView | null>;
  taking: boolean;
  onCapturar: () => void;
  onCancelar: () => void;
  hasPermission: boolean;
  onRequestPermission: () => void;
}) {
  if (!hasPermission) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-black px-6">
        <Text className="text-center text-base text-white">
          Precisamos da permissão de câmera pra tirar a foto do ticket.
        </Text>
        <Button onPress={onRequestPermission}>Permitir câmera</Button>
        <Button variant="ghost" onPress={onCancelar}>
          <Text className="text-white">Cancelar</Text>
        </Button>
      </SafeAreaView>
    );
  }

  return (
    <>
      <CameraView
        ref={cameraRef}
        style={{ flex: 1 }}
        facing="back"
      />
      <SafeAreaView edges={["top"]} className="absolute left-0 right-0 top-0">
        <View className="px-4 pt-2">
          <Pressable
            onPress={onCancelar}
            className="h-10 w-10 items-center justify-center rounded-full bg-black/50"
          >
            <X size={20} color="white" />
          </Pressable>
        </View>
      </SafeAreaView>
      <SafeAreaView edges={["bottom"]} className="absolute bottom-0 left-0 right-0">
        <View className="items-center pb-6">
          <Pressable
            onPress={onCapturar}
            disabled={taking}
            className="h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/30"
          >
            {taking ? (
              <ActivityIndicator color="white" />
            ) : (
              <View className="h-16 w-16 rounded-full bg-white" />
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </>
  );
}

function PreviewMode({
  uri,
  onRefazer,
  onRecortar,
  onConfirmar,
  onCancelar,
}: {
  uri: string;
  onRefazer: () => void;
  onRecortar: () => void;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <>
      <View className="flex-1">
        <Image source={{ uri }} style={{ flex: 1 }} resizeMode="contain" />
      </View>
      <SafeAreaView edges={["top"]} className="absolute left-0 right-0 top-0">
        <View className="px-4 pt-2">
          <Pressable
            onPress={onCancelar}
            className="h-10 w-10 items-center justify-center rounded-full bg-black/50"
          >
            <X size={20} color="white" />
          </Pressable>
        </View>
      </SafeAreaView>
      <SafeAreaView edges={["bottom"]} className="bg-black">
        <View className="flex-row gap-3 px-4 py-4">
          <Button variant="outline" className="flex-1 bg-transparent" onPress={onRefazer}>
            <RotateCcw size={18} color="white" />
            <Text className="text-base font-medium text-white">Refazer</Text>
          </Button>
          <Button variant="outline" className="flex-1 bg-transparent" onPress={onRecortar}>
            <Crop size={18} color="white" />
            <Text className="text-base font-medium text-white">Recortar</Text>
          </Button>
          <Button className="flex-1" onPress={onConfirmar}>
            Usar foto
          </Button>
        </View>
      </SafeAreaView>
    </>
  );
}

const HANDLE = 28; // raio do alvo de toque da alca (px)
const MIN_CROP = 64; // tamanho minimo do retangulo de recorte (px de tela)

// Recortador interativo: imagem em "contain" + retangulo de recorte com 4 alcas.
// Tudo em JS (gesture-handler + reanimated + expo-image-manipulator, ja no binario),
// entao publica via OTA sem novo build de loja.
function CropMode({
  uri,
  onDone,
  onCancelar,
}: {
  uri: string;
  onDone: (uri: string) => void;
  onCancelar: () => void;
}) {
  // uri de trabalho: muda quando o motorista gira a imagem
  const [workUri, setWorkUri] = useState(uri);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [container, setContainer] = useState<{ w: number; h: number } | null>(null);
  // Retangulo da imagem efetivamente exibida (contain => letterbox)
  const [disp, setDisp] = useState<{
    scale: number;
    offsetX: number;
    offsetY: number;
    w: number;
    h: number;
  } | null>(null);
  const [working, setWorking] = useState(false);

  // Retangulo de recorte em coords de tela (relativas ao container)
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  // Snapshot no inicio do gesto
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const sw = useSharedValue(0);
  const sh = useSharedValue(0);
  // Limites = area exibida da imagem (pra clamp nos worklets)
  const bx = useSharedValue(0);
  const by = useSharedValue(0);
  const bw = useSharedValue(0);
  const bh = useSharedValue(0);

  // Mede dimensoes reais do arquivo (re-roda quando gira)
  useEffect(() => {
    let alive = true;
    setImgSize(null);
    Image.getSize(
      workUri,
      (ww, hh) => {
        if (alive) setImgSize({ w: ww, h: hh });
      },
      () => {
        if (alive) setImgSize(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [workUri]);

  // Calcula area exibida + reinicia o retangulo cobrindo a imagem inteira
  useEffect(() => {
    if (!imgSize || !container) return;
    const scale = Math.min(container.w / imgSize.w, container.h / imgSize.h);
    const dw = imgSize.w * scale;
    const dh = imgSize.h * scale;
    const offsetX = (container.w - dw) / 2;
    const offsetY = (container.h - dh) / 2;
    setDisp({ scale, offsetX, offsetY, w: dw, h: dh });
    bx.value = offsetX;
    by.value = offsetY;
    bw.value = dw;
    bh.value = dh;
    x.value = offsetX;
    y.value = offsetY;
    w.value = dw;
    h.value = dh;
  }, [imgSize, container, bx, by, bw, bh, x, y, w, h]);

  function onContainerLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setContainer({ w: width, h: height });
  }

  // Mover o retangulo inteiro
  const moveGesture = Gesture.Pan()
    .onBegin(() => {
      sx.value = x.value;
      sy.value = y.value;
      sw.value = w.value;
      sh.value = h.value;
    })
    .onUpdate((e) => {
      const nx = sx.value + e.translationX;
      const ny = sy.value + e.translationY;
      x.value = Math.min(Math.max(nx, bx.value), bx.value + bw.value - sw.value);
      y.value = Math.min(Math.max(ny, by.value), by.value + bh.value - sh.value);
    });

  // Fabrica de gestos pras alcas. corner: 0=TL 1=TR 2=BL 3=BR
  function makeCorner(corner: number) {
    return Gesture.Pan()
      .onBegin(() => {
        sx.value = x.value;
        sy.value = y.value;
        sw.value = w.value;
        sh.value = h.value;
      })
      .onUpdate((e) => {
        const left = sx.value;
        const top = sy.value;
        const right = sx.value + sw.value;
        const bottom = sy.value + sh.value;
        const minX = bx.value;
        const minY = by.value;
        const maxX = bx.value + bw.value;
        const maxY = by.value + bh.value;
        if (corner === 0 || corner === 2) {
          // borda esquerda se move (direita fixa)
          const nl = Math.min(Math.max(left + e.translationX, minX), right - MIN_CROP);
          x.value = nl;
          w.value = right - nl;
        } else {
          // borda direita se move (esquerda fixa)
          const nr = Math.min(Math.max(right + e.translationX, left + MIN_CROP), maxX);
          w.value = nr - left;
        }
        if (corner === 0 || corner === 1) {
          // borda de cima se move (baixo fixo)
          const nt = Math.min(Math.max(top + e.translationY, minY), bottom - MIN_CROP);
          y.value = nt;
          h.value = bottom - nt;
        } else {
          // borda de baixo se move (cima fixo)
          const nb = Math.min(Math.max(bottom + e.translationY, top + MIN_CROP), maxY);
          h.value = nb - top;
        }
      });
  }
  const tl = makeCorner(0);
  const tr = makeCorner(1);
  const bl = makeCorner(2);
  const br = makeCorner(3);

  // Sombreamento fora do retangulo (4 faixas)
  const dimTop = useAnimatedStyle(() => ({
    left: 0,
    right: 0,
    top: 0,
    height: y.value,
  }));
  const dimBottom = useAnimatedStyle(() => ({
    left: 0,
    right: 0,
    top: y.value + h.value,
    bottom: 0,
  }));
  const dimLeft = useAnimatedStyle(() => ({
    left: 0,
    top: y.value,
    width: x.value,
    height: h.value,
  }));
  const dimRight = useAnimatedStyle(() => ({
    left: x.value + w.value,
    right: 0,
    top: y.value,
    height: h.value,
  }));
  const rectStyle = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
  }));
  const hTL = useAnimatedStyle(() => ({
    left: x.value - HANDLE / 2,
    top: y.value - HANDLE / 2,
  }));
  const hTR = useAnimatedStyle(() => ({
    left: x.value + w.value - HANDLE / 2,
    top: y.value - HANDLE / 2,
  }));
  const hBL = useAnimatedStyle(() => ({
    left: x.value - HANDLE / 2,
    top: y.value + h.value - HANDLE / 2,
  }));
  const hBR = useAnimatedStyle(() => ({
    left: x.value + w.value - HANDLE / 2,
    top: y.value + h.value - HANDLE / 2,
  }));

  async function girar() {
    if (working) return;
    setWorking(true);
    try {
      const r = await ImageManipulator.manipulateAsync(
        workUri,
        [{ rotate: 90 }],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );
      setWorkUri(r.uri); // dispara remedicao + reset do retangulo
    } finally {
      setWorking(false);
    }
  }

  async function aplicar() {
    if (!disp || !imgSize || working) return;
    setWorking(true);
    try {
      // tela -> pixels da imagem de origem
      const relX = (x.value - disp.offsetX) / disp.scale;
      const relY = (y.value - disp.offsetY) / disp.scale;
      const relW = w.value / disp.scale;
      const relH = h.value / disp.scale;
      const originX = Math.max(0, Math.round(relX));
      const originY = Math.max(0, Math.round(relY));
      const width = Math.min(imgSize.w - originX, Math.round(relW));
      const height = Math.min(imgSize.h - originY, Math.round(relH));
      const r = await ImageManipulator.manipulateAsync(
        workUri,
        [{ crop: { originX, originY, width, height } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      onDone(r.uri);
    } finally {
      setWorking(false);
    }
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View className="flex-1" onLayout={onContainerLayout}>
        <Image
          source={{ uri: workUri }}
          style={{ flex: 1 }}
          resizeMode="contain"
        />
        {disp ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[{ position: "absolute", backgroundColor: "rgba(0,0,0,0.6)" }, dimTop]}
            />
            <Animated.View
              pointerEvents="none"
              style={[{ position: "absolute", backgroundColor: "rgba(0,0,0,0.6)" }, dimBottom]}
            />
            <Animated.View
              pointerEvents="none"
              style={[{ position: "absolute", backgroundColor: "rgba(0,0,0,0.6)" }, dimLeft]}
            />
            <Animated.View
              pointerEvents="none"
              style={[{ position: "absolute", backgroundColor: "rgba(0,0,0,0.6)" }, dimRight]}
            />
            <GestureDetector gesture={moveGesture}>
              <Animated.View
                style={[
                  {
                    position: "absolute",
                    borderWidth: 2,
                    borderColor: "white",
                  },
                  rectStyle,
                ]}
              />
            </GestureDetector>
            {(
              [
                [hTL, tl],
                [hTR, tr],
                [hBL, bl],
                [hBR, br],
              ] as const
            ).map(([style, gesture], i) => (
              <GestureDetector key={i} gesture={gesture}>
                <Animated.View
                  style={[
                    { position: "absolute", width: HANDLE, height: HANDLE },
                    style,
                  ]}
                >
                  <View
                    style={{
                      width: HANDLE,
                      height: HANDLE,
                      borderRadius: HANDLE / 2,
                      backgroundColor: "white",
                      borderWidth: 2,
                      borderColor: "#0f172a",
                    }}
                  />
                </Animated.View>
              </GestureDetector>
            ))}
          </>
        ) : (
          <View className="absolute inset-0 items-center justify-center">
            <ActivityIndicator color="white" />
          </View>
        )}
      </View>
      <SafeAreaView edges={["top"]} className="absolute left-0 right-0 top-0">
        <View className="flex-row items-center justify-between px-4 pt-2">
          <Pressable
            onPress={onCancelar}
            className="h-10 w-10 items-center justify-center rounded-full bg-black/50"
          >
            <X size={20} color="white" />
          </Pressable>
          <Pressable
            onPress={girar}
            disabled={working}
            className="h-10 flex-row items-center gap-2 rounded-full bg-black/50 px-4"
          >
            <RotateCw size={18} color="white" />
            <Text className="text-sm font-medium text-white">Girar</Text>
          </Pressable>
        </View>
      </SafeAreaView>
      <SafeAreaView edges={["bottom"]} className="bg-black">
        <View className="flex-row gap-3 px-4 py-4">
          <Button
            variant="outline"
            className="flex-1 bg-transparent"
            onPress={onCancelar}
            disabled={working}
          >
            <Text className="text-base font-medium text-white">Cancelar</Text>
          </Button>
          <Button className="flex-1" onPress={aplicar} loading={working} disabled={working}>
            Aplicar
          </Button>
        </View>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
