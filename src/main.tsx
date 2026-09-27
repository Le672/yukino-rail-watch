import React from "react";
import { createRoot } from "react-dom/client";
import Rail from "./Rail";
import "./style.css";

createRoot(document.getElementById("root")!).render(<React.StrictMode><Rail /></React.StrictMode>);
