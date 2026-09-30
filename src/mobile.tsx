import React from "react";
import ReactDOM from "react-dom/client";
import MobileRail from "./MobileRail";
import { initializeMobile } from "./mobile/mobile-bridge";
import "./mobile.css";

async function start() {
  try { await initializeMobile(); ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><MobileRail/></React.StrictMode>); }
  catch { const root = document.getElementById("root")!; root.textContent = "手机服务未能启动，请关闭应用重试，或通过项目页面反馈问题。"; }
}
void start();
