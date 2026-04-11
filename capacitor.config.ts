import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pharmacypro.app",
  appName: "Lumière de Vie Pharma",
  webDir: "web",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https"
  }
};

export default config;
