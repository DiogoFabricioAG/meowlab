import type { CapacitorConfig } from "@capacitor/cli";

const apiOrigin = (process.env.VITE_API_ORIGIN ?? "").trim();

const config: CapacitorConfig = {
  appId: "tech.meowlab.app",
  appName: "MeowLab",
  webDir: "../meowlab-app/dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: apiOrigin.startsWith("http://"),
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#FFFFFF",
      showSpinner: false,
    },
  },
};

export default config;
