import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./AdminApp";
import { initializeTheme } from "../ui/theme";
import "../styles/tokens.css";
import "../styles/admin.css";

initializeTheme(window.localStorage);

const root = document.getElementById("admin");
if (!root) throw new Error("Missing #admin root element.");

createRoot(root).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
