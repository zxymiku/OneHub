import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design/tokens.css";
import "./design/depth.css";
import "./design/base.css";
import { App } from "./app/App";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("缺少 #root 挂载点");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
