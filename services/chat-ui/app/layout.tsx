// The HTML shell: CopilotKit's chat styles, then this app's.
import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "./styles.css";

export const metadata: Metadata = {
  // The page replaces it with CHAT_TITLE once its settings are loaded.
  title: "Chat",
  description: "A chat whose MCP tool calls go through a gateway.",
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
