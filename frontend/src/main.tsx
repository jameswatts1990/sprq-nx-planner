import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// Global styles first, so every component's CSS module loads after them and can refine a
// shared class (.btn, .table, .status, form controls) at equal specificity - on eager and lazy
// pages alike.
import "./styles/base.css";

import App from "./App";
import { queryClient } from "./lib/queryClient";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root element not found");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
