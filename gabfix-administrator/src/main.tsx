import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { registerAdminServiceWorker } from "./lib/pwa";
import "./styles.css";

void registerAdminServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
