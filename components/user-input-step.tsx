"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Brain, Send, Loader2, CheckCircle, X, User, AlertCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface UserInputRecommendation {
  id: string
  userRequest: string
  aiResponse: string
  actionType: string
  targetColumn?: string
  status: "pending" | "accepted" | "rejected"
  reasoning: string
}

interface UserInputStepProps {
  onSubmitRequest: (request: string) => Promise<UserInputRecommendation>
  onDecision: (recommendationId: string, decision: "accept" | "reject") => void
  currentRecommendation?: UserInputRecommendation
  loading?: boolean
}

export function UserInputStep({
  onSubmitRequest,
  onDecision,
  currentRecommendation,
  loading = false,
}: UserInputStepProps) {
  const [userInput, setUserInput] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      handleSubmitRequest()
    }
  }

  return (
    <div className="space-y-6">
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
            Describe what you'd like to do with your data, and our AI will provide specific recommendations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Textarea
              placeholder="Example: 'Remove all empty rows', 'Fix phone number formats', 'Fill missing email addresses', 'Remove duplicate customers', etc."
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={handleKeyPress}
              rows={4}
              disabled={submitting || loading}
              className="resize-none"
            />
            <div className="flex justify-between items-center">
              <div className="text-xs text-gray-500 dark:text-gray-400">Press Ctrl+Enter to submit quickly</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">{userInput.length}/500 characters</div>
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

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2">
            {[
              "Remove empty rows",
              "Fix phone formats",
              "Fill missing data",
              "Remove duplicates",
              "Standardize names",
              "Clean email formats",
              "Fix date formats",
              "Remove special characters",
            ].map((suggestion) => (
              <Button
                key={suggestion}
                variant="outline"
                size="sm"
                onClick={() => setUserInput(suggestion)}
                disabled={submitting || loading}
                className="text-xs h-8"
              >
                {suggestion}
              </Button>
            ))}
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
                  <CardTitle className="text-lg">AI Recommendation</CardTitle>
                  <CardDescription>Based on your request: "{currentRecommendation.userRequest}"</CardDescription>
                </div>
              </div>
              <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                {currentRecommendation.actionType.replace(/_/g, " ").toUpperCase()}
              </Badge>
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
                <h3 className="font-medium">AI is thinking...</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Analyzing your request and generating a recommendation
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
