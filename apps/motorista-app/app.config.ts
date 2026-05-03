import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Ronan Motorista",
  slug: "ronan-motorista",
  scheme: "ronan",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#13316b",
  },
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: false,
    bundleIdentifier: "br.com.ronan.motorista",
    buildNumber: "1",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription:
        "Para tirar foto do ticket de carga e descarga da viagem.",
      NSPhotoLibraryUsageDescription:
        "Para anexar foto do ticket à viagem (opcional).",
    },
  },
  android: {
    package: "br.com.ronan.motorista",
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#13316b",
    },
    permissions: [
      "android.permission.CAMERA",
      "android.permission.INTERNET",
    ],
  },
  plugins: [
    "expo-router",
    "expo-secure-store",
    "@react-native-community/datetimepicker",
    [
      "expo-camera",
      {
        cameraPermission:
          "Para tirar foto do ticket de carga e descarga da viagem.",
      },
    ],
    "./plugins/with-abi-splits",
  ],
  experiments: {
    typedRoutes: false,
  },
  extra: {
    apiUrl:
      process.env.EXPO_PUBLIC_API_URL ?? "https://ronan-api.2azr6q.easypanel.host",
  },
};

export default config;
