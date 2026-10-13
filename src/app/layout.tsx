import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const suit = localFont({ src: "./fonts/SUIT-Variable.woff2", variable: "--font-suit", weight: "100 900", display: "swap" });

export const metadata: Metadata = {
  title: "PriceTrace · 가격의 순간을 선명하게",
  description: "출처와 시점이 분명한 가격 관측 기록. 상품과 음식점 메뉴의 관측가를 탐색하고 비교하세요.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko" className={suit.variable}><body>{children}</body></html>;
}
