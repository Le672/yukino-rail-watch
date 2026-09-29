const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("railLocation", {
  start: () => ipcRenderer.invoke("rail:location-start"),
  stop: () => ipcRenderer.invoke("rail:location-stop"),
  onUpdate: listener => {
    const handler = (_event, data) => listener(data);
    ipcRenderer.on("rail:location", handler);
    return () => ipcRenderer.removeListener("rail:location", handler);
  },
});

contextBridge.exposeInMainWorld("railDesktop", {
  getState: () => ipcRenderer.invoke("rail:get-state"),
  configure: (settings) => ipcRenderer.invoke("rail:configure", settings),
  checkNow: (settings) => ipcRenderer.invoke("rail:check-now", settings),
  stations: () => ipcRenderer.invoke("rail:stations"),
  onUpdate: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on("rail:update", handler);
    return () => ipcRenderer.removeListener("rail:update", handler);
  },
});
