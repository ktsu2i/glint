import "./app/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { SettingsWindowApp } from "./features/settings/SettingsWindow";

const rootElement = document.querySelector("#root");
if (rootElement === null) {
  throw new Error("#root element is missing from index.html");
}

createRoot(rootElement).render(
  <StrictMode>{window.location.hash === "#settings" ? <SettingsWindowApp /> : <App />}</StrictMode>,
);
