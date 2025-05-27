import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { EnhancedAuthProvider } from "@/contexts/enhanced-auth-context"
import { Toaster } from "@/components/ui/toaster"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Excel AI Assistant - Clean & Prepare Your Data",
  description: "AI-powered Excel file cleaning and data preparation tool with advanced normalization features",
    generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <EnhancedAuthProvider>
            {children}
            <Toaster />
          </EnhancedAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
