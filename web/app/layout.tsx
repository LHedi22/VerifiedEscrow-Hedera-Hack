import "./globals.css";
import { cookies } from "next/headers";
import Header from "@/components/Header";
import HealthFooter from "@/components/HealthFooter";
import Providers from "@/components/Providers";
import type { Role } from "@/lib/api";
import { PERSONA_COOKIE, ROLES } from "@/lib/persona";

export const metadata = { title: "Verified Escrow" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const c = cookies().get(PERSONA_COOKIE)?.value as Role | undefined;
  const persona: Role = c && ROLES.includes(c) ? c : "client";
  return (
    <html lang="en">
      <body>
        <Providers persona={persona}>
          <Header />
          <main className="page">{children}</main>
          <HealthFooter />
        </Providers>
      </body>
    </html>
  );
}
