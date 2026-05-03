import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Ronan Motorista",
  slug: "ronan-motorista",
  scheme: "ronan",
  version: "1.0.0",
  orientation: "portrait",
  platforms: ["ios", "android"],
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
    "./plugins/with-gradle-memory",
  ],
  experiments: {
    typedRoutes: false,
  },
  // OTA updates via EAS Update — quando push novo bundle JS, motorista
  // baixa silenciosamente na proxima vez que abrir o app.
  runtimeVersion: { policy: "appVersion" },
  updates: {
    fallbackToCacheTimeout: 0,
    url: "https://u.expo.dev/33e8e936-fbac-4bb3-9f98-5de6dc84da53",
    // Canonical way: requestHeaders sai como meta-data
    // expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY
    // (que e o nome que UpdatesConfiguration.kt:253 le).
    requestHeaders: {
      "expo-channel-name": "production",
    },
  },
  extra: {
    apiUrl:
      process.env.EXPO_PUBLIC_API_URL ?? "https://ronan-api.2azr6q.easypanel.host",
    eas: {
      projectId: "33e8e936-fbac-4bb3-9f98-5de6dc84da53",
    },
  },
};

export default config;
