"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Brain, Send, Loader2, CheckCircle, X, User, AlertCircle, Download } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { supabase } from "@/lib/supabase"

interface UserInputRecommendation {
  id: string
  userRequest: string
  aiResponse: string
  actionType: string
  targetColumn?: string
  status: "pending" | "accepted" | "rejected"
  reasoning: string
  category?: string
  priority?: string
  estimatedTime?: string
}

interface EnhancedUserInputStepProps {
  onSubmitRequest: (request: string) => Promise<UserInputRecommendation>
  onDecision: (recommendationId: string, decision: "accept" | "reject") => void
  currentRecommendation?: UserInputRecommendation
  loading?: boolean
  sessionId: string
  filename: string
  acceptedCount: number
}

export function EnhancedUserInputStep({
  onSubmitRequest,
  onDecision,
  currentRecommendation,
  loading = false,
  sessionId,
  filename,
  acceptedCount,
}: EnhancedUserInputStepProps) {
  const [userInput, setUserInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const { toast } = useToast()

  const handleSubmitRequest = async () => {
    if (!userInput.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      await onSubmitRequest(userInput.trim())
      setUserInput("")
    } catch (error) {
      console.error("Failed to submit request:", error)
      const errorMessage = error instanceof Error ? error.message : "Failed to process your request"
      setError(errorMessage)
      toast({
        title: "Request Failed",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDecision = async (decision: "accept" | "reject") => {
    if (!currentRecommendation) return

    setProcessing(true)
    setError(null)
    try {
      await onDecision(currentRecommendation.id, decision)
    } catch (error) {
      console.error("Failed to process decision:", error)
      const errorMessage = error instanceof Error ? error.message : "Failed to process your decision"
      setError(errorMessage)
      toast({
        title: "Decision Failed",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setProcessing(false)
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        throw new Error("Not authenticated")
      }

      const response = await fetch("/api/download/excel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ sessionId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Download failed")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `cleaned_${filename}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: "Download Complete",
        description: "Your cleaned Excel file has been downloaded",
      })
    } catch (error) {
      console.error("Download failed:", error)
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Failed to download file",
        variant: "destructive",
      })
    } finally {
      setDownloading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      handleSubmitRequest()
    }
  }

  const smartSuggestions = [
    "Normalize customer data into separate tables",
    "Remove duplicate entries and standardize formats",
    "Split address into separate components",
    "Create lookup tables for categories",
    "Fix phone number and email formats",
    "Remove empty rows and columns",
    "Validate data integrity constraints",
    "Optimize table structure for database",
    "Split multi-value fields into separate rows",
    "Create foreign key relationships",
  ]

  return (
    <div className="space-y-6">
      {/* Progress and Download Section */}
      <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-lg">Manual Cleaning Progress</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {acceptedCount} changes applied to {filename}
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <Badge variant="secondary" className="px-3 py-1">
                {acceptedCount} Applied
              </Badge>
              <Button onClick={handleDownload} disabled={downloading} className="bg-green-600 hover:bg-green-700">
                {downloading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-2" />
                )}
                Download Excel
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800">
          <CardContent className="pt-6">
            <div className="flex items-center space-x-2 text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Error: {error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* User Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <User className="h-5 w-5 text-blue-600" />
            <span>Tell AI What You Want</span>
          </CardTitle>
          <CardDescription>
            Describe what you'd like to do with your data. Our enhanced AI can handle complex data normalization and
            optimization tasks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Textarea
              placeholder="Example: 'Normalize this data for a database', 'Split customer addresses into separate fields', 'Create lookup tables for product categories', etc."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={handleKeyPress}
              rows={4}
              disabled={submitting || loading}
              className="resize-none"
            />
            <div className="flex justify-between items-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">Press Ctrl+Enter to submit quickly</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{userInput.length}/1000 characters</div>
            </div>
          </div>

          <Button
            onClick={handleSubmitRequest}
            disabled={!userInput.trim() || submitting || loading}
            className="w-full"
          >
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            {submitting ? "Getting AI Recommendation..." : "Get AI Recommendation"}
          </Button>

          {/* Smart Suggestions */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">Smart Suggestions:</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {smartSuggestions.map((suggestion) => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  onClick={() => setUserInput(suggestion)}
                  disabled={submitting || loading}
                  className="text-xs h-auto py-2 px-3 text-left justify-start"
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Recommendation Response */}
      {currentRecommendation && (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950 dark:border-blue-800">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
                  <Brain className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-lg">Enhanced AI Recommendation</CardTitle>
                  <CardDescription>Based on your request: "{currentRecommendation.userRequest}"</CardDescription>
                </div>
              </div>
              <div className="flex flex-col items-end space-y-2">
                <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                  {currentRecommendation.actionType.replace(/_/g, " ").toUpperCase()}
                </Badge>
                {currentRecommendation.category && (
                  <Badge variant="outline" className="text-xs">
                    {currentRecommendation.category}
                  </Badge>
                )}
                {currentRecommendation.priority && (
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      currentRecommendation.priority === "critical"
                        ? "border-red-500 text-red-600"
                        : currentRecommendation.priority === "high"
                          ? "border-orange-500 text-orange-600"
                          : currentRecommendation.priority === "medium"
                            ? "border-yellow-500 text-yellow-600"
                            : "border-green-500 text-green-600"
                    }`}
                  >
                    {currentRecommendation.priority} priority
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="p-4 bg-white dark:bg-gray-800 rounded-lg border">
              <h4 className="font-medium mb-2 text-blue-900 dark:text-blue-100">AI Response:</h4>
              <p className="text-gray-900 dark:text-gray-100 leading-relaxed mb-3">
                {currentRecommendation.aiResponse}
              </p>

              {currentRecommendation.targetColumn && (
                <div className="mt-3">
                  <Badge variant="outline">Target Column: {currentRecommendation.targetColumn}</Badge>
                </div>
              )}

              <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-700 rounded text-sm">
                <strong>Reasoning:</strong> {currentRecommendation.reasoning}
              </div>

              {currentRecommendation.estimatedTime && (
                <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                  Estimated time: {currentRecommendation.estimatedTime}
                </div>
              )}
            </div>

            <div className="flex space-x-3">
              <Button
                onClick={() => handleDecision("accept")}
                disabled={processing}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                {processing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Approve & Apply
              </Button>

              <Button
                onClick={() => handleDecision("reject")}
                disabled={processing}
                variant="outline"
                className="flex-1 border-red-200 text-red-600 hover:bg-red-50"
              >
                <X className="h-4 w-4 mr-2" />
                Reject
              </Button>
            </div>

            <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
              The AI will apply this change to your data if you approve it
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {loading && !currentRecommendation && (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center space-y-4">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <div className="text-center">
                <h3 className="font-medium">Enhanced AI is analyzing...</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Analyzing your request for advanced data normalization and optimization
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
