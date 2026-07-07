/**
 * Expo config plugin: liga a feature flag `useRawPropsJsiValue` da nova
 * arquitetura do React Native no MainApplication (Android).
 *
 * Sem ela, o PreviewView do react-native-vision-camera (nitro) crasha ao passar
 * `previewOutput` como prop: "Cannot cast dynamic to a jsi::Value type. Please
 * use the 'useRawPropsJsiValue' feature flag...". Injeta o override logo após o
 * SoLoader.init (native já carregado) e antes do RN inicializar.
 */
const { withMainApplication } = require("@expo/config-plugins");

const OVERRIDE = `    com.facebook.react.internal.featureflags.ReactNativeFeatureFlags.override(
      object : com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsDefaults() {
        override fun useRawPropsJsiValue(): Boolean = true
      })`;

module.exports = function withRawPropsJsiValue(config) {
  return withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes("useRawPropsJsiValue")) {
      return cfg; // já injetado
    }
    const soLoader = "SoLoader.init(this, OpenSourceMergedSoMapping)";
    if (src.includes(soLoader)) {
      src = src.replace(soLoader, `${soLoader}\n${OVERRIDE}`);
    } else if (src.includes("super.onCreate()")) {
      src = src.replace("super.onCreate()", `super.onCreate()\n${OVERRIDE}`);
    } else {
      throw new Error(
        "with-rawprops-jsi: não achei onde injetar no MainApplication (SoLoader.init/super.onCreate).",
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
};
