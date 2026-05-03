/**
 * Aumenta heap + metaspace do Gradle daemon. Sem isso, builds com
 * expo-updates e plugins extra estouram metaspace (default 512m insuficiente).
 */
const { withGradleProperties } = require("@expo/config-plugins");

const JVM_ARGS = "-Xmx4096m -XX:MaxMetaspaceSize=1g";

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const idx = props.findIndex(
      (p) => p.type === "property" && p.key === "org.gradle.jvmargs",
    );
    if (idx >= 0) {
      props[idx] = { type: "property", key: "org.gradle.jvmargs", value: JVM_ARGS };
    } else {
      props.push({ type: "property", key: "org.gradle.jvmargs", value: JVM_ARGS });
    }
    return cfg;
  });
};
