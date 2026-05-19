import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "PromptQuest",
  description: "Event feedback and AI prompt challenge"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fi">
      <body>{children}</body>
    </html>
  );
}
