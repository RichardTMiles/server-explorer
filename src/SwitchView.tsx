import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { SwitchConsoleApp } from "./SwitchConsoleApp";
import rawSwitchStyles from "./switchStyles.css?raw";

const switchStyles = `${rawSwitchStyles
  .replace(":root", ":host")
  .replace("body {", ":host {")}

:host {
  display: block;
  min-width: 0;
}

.app-shell {
  min-height: calc(100vh - 154px);
}
`;

export function SwitchView() {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const rootRef = React.useRef<Root | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadow.replaceChildren();

    const style = document.createElement("style");
    style.textContent = switchStyles;

    const mount = document.createElement("div");
    shadow.append(style, mount);

    const root = createRoot(mount);
    rootRef.current = root;
    root.render(<SwitchConsoleApp />);

    return () => {
      rootRef.current?.unmount();
      rootRef.current = null;
      shadow.replaceChildren();
    };
  }, []);

  return (
    <main className="switch-view">
      <div ref={hostRef} className="switch-view-host" />
    </main>
  );
}
