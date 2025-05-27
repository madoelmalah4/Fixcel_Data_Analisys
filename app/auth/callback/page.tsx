"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle, AlertCircle } from "lucide-react"
import { enhancedAuth } from "@/lib/enhanced-auth"

export default function AuthCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading")
  const [message, setMessage] = useState("")

  useEffect(() => {
    const handleAuthCallback = async () => {
      try {
        // Get the current session to check if email was confirmed
        const session = await enhancedAuth.getSession()

        if (session?.user?.email_confirmed_at) {
          setStatus("success")
          setMessage("Email confirmed successfully! You can now sign in.")

          // Redirect to app after a short delay
          setTimeout(() => {
            router.push("/app")
          }, 2000)
        } else {
          setStatus("error")
          setMessage("Email confirmation failed. Please try again or contact support.")
        }
      } catch (error) {
        console.error("Auth callback error:", error)
        setStatus("error")
        setMessage("An error occurred during email confirmation. Please try again.")
      }
    }

    handleAuthCallback()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            {status === "loading" && <Loader2 className="h-12 w-12 text-blue-600 animate-spin" />}
            {status === "success" && <CheckCircle className="h-12 w-12 text-green-600" />}
            {status === "error" && <AlertCircle className="h-12 w-12 text-red-600" />}
          </div>
          <CardTitle className="text-2xl">
            {status === "loading" && "Confirming Email..."}
            {status === "success" && "Email Confirmed!"}
            {status === "error" && "Confirmation Failed"}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          {status === "success" && (
            <div className="text-center">
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">Redirecting you to the app...</p>
              <Button onClick={() => router.push("/app")} className="w-full">
                Go to App Now
              </Button>
            </div>
          )}
          {status === "error" && (
            <div className="space-y-3">
              <Button onClick={() => router.push("/auth/login")} className="w-full">
                Back to Sign In
              </Button>
              <Button onClick={() => router.push("/auth/register")} variant="outline" className="w-full">
                Try Registration Again
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
