"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, X, Brain, Loader2 } from "lucide-react"

interface CleaningRecommendation {
  id: string
  step: number
  message: string
  actionType: string
  targetColumn?: string
  status: "pending" | "accepted" | "skipped"
}

interface CleaningStepProps {
  recommendation: CleaningRecommendation
  onDecision: (id: string, decision: "accept" | "skip") => void
}

export function CleaningStep({ recommendation, onDecision }: CleaningStepProps) {
  const [processing, setProcessing] = useState(false)

  const handleDecision = async (decision: "accept" | "skip") => {
    setProcessing(true)
    await onDecision(recommendation.id, decision)
    setProcessing(false)
  }

  const getActionTypeColor = (actionType: string) => {
    switch (actionType) {
      case "fill_missing":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      case "remove_duplicates":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
      case "standardize_format":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      case "fix_data_types":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
    }
  }

  const getActionTypeLabel = (actionType: string) => {
    switch (actionType) {
      case "fill_missing":
        return "Fill Missing Values"
      case "remove_duplicates":
        return "Remove Duplicates"
      case "standardize_format":
        return "Standardize Format"
      case "fix_data_types":
        return "Fix Data Types"
      default:
        return "Data Cleaning"
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Brain className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-lg">AI Recommendation</CardTitle>
              <CardDescription>Review this suggestion and choose whether to apply it</CardDescription>
            </div>
          </div>
          <Badge className={getActionTypeColor(recommendation.actionType)}>
            {getActionTypeLabel(recommendation.actionType)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <p className="text-gray-900 dark:text-gray-100 leading-relaxed">{recommendation.message}</p>
          {recommendation.targetColumn && (
            <div className="mt-3">
              <Badge variant="outline">Column: {recommendation.targetColumn}</Badge>
            </div>
          )}
        </div>

        <div className="flex space-x-3">
          <Button
            onClick={() => handleDecision("accept")}
            disabled={processing}
            className="flex-1 bg-green-600 hover:bg-green-700"
          >
            {processing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Accept & Apply
          </Button>

          <Button onClick={() => handleDecision("skip")} disabled={processing} variant="outline" className="flex-1">
            <X className="h-4 w-4 mr-2" />
            Skip This Step
          </Button>
        </div>

        <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
          You can always review and undo changes in the final summary
        </div>
      </CardContent>
    </Card>
  )
}
