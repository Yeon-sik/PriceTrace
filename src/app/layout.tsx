import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "가격 추적기", description: "관측된 상품 가격을 카테고리별로 비교하는 가격 추적기" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body>{children}</body></html>; }
