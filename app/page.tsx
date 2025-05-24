"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import { ThemeToggle } from "@/components/theme-toggle"
import { FileSpreadsheet, Brain, CheckCircle, Download, Sparkles, Shield, Zap } from "lucide-react"

export default function LandingPage() {
  const { user } = useAuth()
  const router = useRouter()

  const handleGetStarted = () => {
    if (user) {
      router.push("/app")
    } else {
      router.push("/auth/login")
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Header */}
      <header className="container mx-auto px-4 py-6 flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <FileSpreadsheet className="h-8 w-8 text-blue-600" />
          <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Excel AI Assistant
          </span>
        </div>
        <div className="flex items-center space-x-4">
          <ThemeToggle />
          {user ? (
            <Button onClick={() => router.push("/app")} className="bg-blue-600 hover:bg-blue-700">
              Go to App
            </Button>
          ) : (
            <div className="space-x-2">
              <Button variant="ghost" onClick={() => router.push("/auth/login")}>
                Sign In
              </Button>
              <Button onClick={() => router.push("/auth/register")} className="bg-blue-600 hover:bg-blue-700">
                Get Started
              </Button>
            </div>
          )}
        </div>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <Badge variant="secondary" className="mb-4">
          <Sparkles className="h-4 w-4 mr-1" />
          Powered by Google Gemini AI
        </Badge>
        <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-blue-600 via-purple-600 to-blue-800 bg-clip-text text-transparent">
          Clean Your Excel Files
          <br />
          with AI Precision
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-3xl mx-auto">
          Upload your Excel files and let our AI assistant recommend smart cleaning actions. Accept or skip each
          suggestion to get perfectly prepared data for analysis.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button size="lg" onClick={handleGetStarted} className="bg-blue-600 hover:bg-blue-700 text-lg px-8 py-3">
            Start Cleaning Now
          </Button>
          <Button size="lg" variant="outline" className="text-lg px-8 py-3">
            Watch Demo
          </Button>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-20">
        <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
        <div className="grid md:grid-cols-4 gap-8">
          <Card className="text-center">
            <CardHeader>
              <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center mb-4">
                <FileSpreadsheet className="h-6 w-6 text-blue-600" />
              </div>
              <CardTitle>1. Upload Excel</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>Upload your .xlsx file (up to 5MB) securely to our platform</CardDescription>
            </CardContent>
          </Card>

          <Card className="text-center">
            <CardHeader>
              <div className="mx-auto w-12 h-12 bg-purple-100 dark:bg-purple-900 rounded-lg flex items-center justify-center mb-4">
                <Brain className="h-6 w-6 text-purple-600" />
              </div>
              <CardTitle>2. AI Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>Google Gemini analyzes your data and suggests cleaning actions</CardDescription>
            </CardContent>
          </Card>

          <Card className="text-center">
            <CardHeader>
              <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center mb-4">
                <CheckCircle className="h-6 w-6 text-green-600" />
              </div>
              <CardTitle>3. Review & Accept</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>Review each suggestion and choose to accept or skip</CardDescription>
            </CardContent>
          </Card>

          <Card className="text-center">
            <CardHeader>
              <div className="mx-auto w-12 h-12 bg-orange-100 dark:bg-orange-900 rounded-lg flex items-center justify-center mb-4">
                <Download className="h-6 w-6 text-orange-600" />
              </div>
              <CardTitle>4. Download Results</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>Get your cleaned Excel file and detailed summary report</CardDescription>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="container mx-auto px-4 py-20 bg-white/50 dark:bg-gray-800/50 rounded-3xl mx-4">
        <h2 className="text-3xl font-bold text-center mb-12">Why Choose Excel AI Assistant?</h2>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="flex items-start space-x-4">
            <Shield className="h-8 w-8 text-blue-600 mt-1" />
            <div>
              <h3 className="text-xl font-semibold mb-2">Secure & Private</h3>
              <p className="text-gray-600 dark:text-gray-300">
                Your data is protected with enterprise-grade security. Files are processed securely and never stored
                permanently.
              </p>
            </div>
          </div>
          <div className="flex items-start space-x-4">
            <Zap className="h-8 w-8 text-purple-600 mt-1" />
            <div>
              <h3 className="text-xl font-semibold mb-2">Lightning Fast</h3>
              <p className="text-gray-600 dark:text-gray-300">
                Powered by Google Gemini AI for intelligent and rapid data analysis and cleaning recommendations.
              </p>
            </div>
          </div>
          <div className="flex items-start space-x-4">
            <Brain className="h-8 w-8 text-green-600 mt-1" />
            <div>
              <h3 className="text-xl font-semibold mb-2">Smart Suggestions</h3>
              <p className="text-gray-600 dark:text-gray-300">
                AI understands your data context and provides relevant, actionable cleaning recommendations.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <h2 className="text-3xl font-bold mb-6">Ready to Clean Your Data?</h2>
        <p className="text-xl text-gray-600 dark:text-gray-300 mb-8">
          Join thousands of analysts who trust Excel AI Assistant for their data preparation needs.
        </p>
        <Button
          size="lg"
          onClick={handleGetStarted}
          className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8 py-3"
        >
          Start Your Free Session
        </Button>
      </section>

      {/* Footer */}
      <footer className="border-t bg-white/80 dark:bg-gray-900/80 backdrop-blur">
        <div className="container mx-auto px-4 py-8 text-center text-gray-600 dark:text-gray-300">
          <p>&copy; 2024 Excel AI Assistant. Built with ❤️ for data professionals.</p>
        </div>
      </footer>
    </div>
  )
}
