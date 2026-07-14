import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "물품 배분·정산", description: "로컬 영수증 물품 배분·정산" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body>{children}</body></html>; }
