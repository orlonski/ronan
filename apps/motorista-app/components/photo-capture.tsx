import { useRef, useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import { Camera, RotateCcw, X } from "lucide-react-native";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
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
  const cameraRef = useRef<CameraView>(null);

  async function abrir() {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) return;
    }
    setPreviewUri(null);
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
    setPreviewUri(null);
  }

  function confirmar() {
    if (!previewUri) return;
    onChange({ uri: previewUri, mime: "image/jpeg" });
    setOpen(false);
    setPreviewUri(null);
  }

  function descartar() {
    setOpen(false);
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
          {previewUri ? (
            <PreviewMode
              uri={previewUri}
              onRefazer={refazer}
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
  onConfirmar,
  onCancelar,
}: {
  uri: string;
  onRefazer: () => void;
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
          <Button className="flex-1" onPress={onConfirmar}>
            Usar foto
          </Button>
        </View>
      </SafeAreaView>
    </>
  );
}
