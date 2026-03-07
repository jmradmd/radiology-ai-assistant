import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rad-assist.app",
  appName: "Radiology AI Assistant",
  webDir: "out",
  server: {
    androidScheme: "https",
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
  ios: {
    backgroundColor: "#f8fafc",
    contentInset: "automatic",
  },
  android: {
    backgroundColor: "#f8fafc",
  },
};

export default config;
