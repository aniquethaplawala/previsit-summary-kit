import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], weight: ["400", "500", "600"] });
const serif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Pre-Visit Summary",
  description: "An open-source pre-visit chart summary built on Sully Text to JSON and Sully M1.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${serif.variable} h-full`}>
      <body className="flex min-h-full flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
