import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireChatGPTUser } from "./chatgpt-auth";
import "./globals.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.jpg`;
  const description = "A shared workspace where personal AI agents collaborate, reuse team knowledge and avoid repeat model calls.";

  return {
  title: "Relay Production — Shared AI Workspace",
    description,
    openGraph: { title: "Relay — Shared AI Workspace", description, images: [image] },
    twitter: { card: "summary_large_image", title: "Relay — Shared AI Workspace", description, images: [image] },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await requireChatGPTUser("/");
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
