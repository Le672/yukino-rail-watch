import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "bond.yukino.rail",
  appName: "Yukino 余票",
  webDir: "dist-mobile",
  server: { androidScheme: "https", cleartext: false },
  android: { allowMixedContent: false },
  ios: { contentInset: "never", backgroundColor: "#f3f6f4" },
  plugins: {
    CapacitorHttp: { enabled: true },
    LocalNotifications: { smallIcon: "ic_stat_rail", iconColor: "#315c42", presentationOptions: ["banner", "list", "sound"] },
  },
};
export default config;
