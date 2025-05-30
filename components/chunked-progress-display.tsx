"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Loader2, Database, Zap, CheckCircle } from "lucide-react"

interface ChunkedProgressProps {
  sessionId: string
  filename: string
  onComplete?: () => void
}

interface ProcessingProgress {
  totalChunks: number
  processedChunks: number
  currentChunk: string
  percentage: number
  estimatedTimeRemaining: string
  phase: "parsing" | "analyzing" | "processing" | "generating" | "complete"
}

export function ChunkedProgressDisplay({ sessionId, filename, onComplete }: ChunkedProgressProps) {
  const [progress, setProgress] = useState<ProcessingProgress>({
    totalChunks: 0,
    processedChunks: 0,
    currentChunk: "",
    percentage: 0,
    estimatedTimeRemaining: "Calculating...",
    phase: "parsing",
  })

  const [startTime] = useState(Date.now())

  useEffect(() => {
    // Simulate chunked processing progress
    const interval = setInterval(() => {
      setProgress((prev) => {
        const elapsed = Date.now() - startTime
        const newProgress = { ...prev }

        // Simulate different phases
        if (elapsed < 3000) {
          newProgress.phase = "parsing"
          newProgress.percentage = Math.min(20, (elapsed / 3000) * 20)
        } else if (elapsed < 8000) {
          newProgress.phase = "analyzing"
          newProgress.totalChunks = Math.max(5, Math.floor(Math.random() * 20) + 5)
          newProgress.processedChunks = Math.floor(((elapsed - 3000) / 5000) * newProgress.totalChunks)
          newProgress.percentage = 20 + Math.min(60, ((elapsed - 3000) / 5000) * 60)
          newProgress.currentChunk = `chunk_${newProgress.processedChunks + 1}`
        } else if (elapsed < 12000) {
          newProgress.phase = "processing"
          newProgress.percentage = 80 + Math.min(15, ((elapsed - 8000) / 4000) * 15)
        } else if (elapsed < 15000) {
          newProgress.phase = "generating"
          newProgress.percentage = 95 + Math.min(5, ((elapsed - 12000) / 3000) * 5)
        } else {
          newProgress.phase = "complete"
          newProgress.percentage = 100
          newProgress.processedChunks = newProgress.totalChunks

          if (onComplete) {
            setTimeout(onComplete, 1000)
          }
          clearInterval(interval)
        }

        // Calculate estimated time remaining
        if (newProgress.percentage > 0 && newProgress.percentage < 100) {
          const timePerPercent = elapsed / newProgress.percentage
          const remainingTime = (100 - newProgress.percentage) * timePerPercent
          newProgress.estimatedTimeRemaining =
            remainingTime > 60000
              ? `${Math.round(remainingTime / 60000)} minutes`
              : `${Math.round(remainingTime / 1000)} seconds`
        } else {
          newProgress.estimatedTimeRemaining = "Complete"
        }

        return newProgress
      })
    }, 500)

    return () => clearInterval(interval)
  }, [startTime, onComplete])

  const getPhaseIcon = () => {
    switch (progress.phase) {
      case "parsing":
        return <Database className="h-5 w-5 text-blue-600" />
      case "analyzing":
        return <Loader2 className="h-5 w-5 text-purple-600 animate-spin" />
      case "processing":
        return <Zap className="h-5 w-5 text-orange-600" />
      case "generating":
        return <Loader2 className="h-5 w-5 text-green-600 animate-spin" />
      case "complete":
        return <CheckCircle className="h-5 w-5 text-green-600" />
      default:
        return <Loader2 className="h-5 w-5 animate-spin" />
    }
  }

  const getPhaseDescription = () => {
    switch (progress.phase) {
      case "parsing":
        return "Parsing Excel file and creating chunks for efficient processing..."
      case "analyzing":
        return `Analyzing data quality across ${progress.totalChunks} chunks...`
      case "processing":
        return "Generating AI recommendations for large dataset optimization..."
      case "generating":
        return "Finalizing recommendations and preparing results..."
      case "complete":
        return "Chunked analysis complete! Ready for review."
      default:
        return "Processing..."
    }
  }

  const getPhaseColor = () => {
    switch (progress.phase) {
      case "parsing":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
      case "analyzing":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
      case "processing":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
      case "generating":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      case "complete":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
    }
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          {getPhaseIcon()}
          <span>Processing Large Dataset</span>
        </CardTitle>
        <CardDescription>
          Analyzing {filename} using advanced chunked processing for optimal performance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Overall Progress</span>
            <span className="text-sm text-gray-600 dark:text-gray-300">{Math.round(progress.percentage)}%</span>
          </div>
          <Progress value={progress.percentage} className="h-3" />
        </div>

        {/* Phase Information */}
        <div className="flex items-center justify-between">
          <Badge className={getPhaseColor()}>{progress.phase.charAt(0).toUpperCase() + progress.phase.slice(1)}</Badge>
          <span className="text-sm text-gray-600 dark:text-gray-300">ETA: {progress.estimatedTimeRemaining}</span>
        </div>

        {/* Phase Description */}
        <p className="text-sm text-gray-700 dark:text-gray-300 text-center">{getPhaseDescription()}</p>

        {/* Chunk Progress */}
        {progress.totalChunks > 0 && progress.phase === "analyzing" && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium">Chunk Processing</span>
              <span className="text-sm text-gray-600 dark:text-gray-300">
                {progress.processedChunks}/{progress.totalChunks}
              </span>
            </div>
            <Progress value={(progress.processedChunks / progress.totalChunks) * 100} className="h-2" />
            {progress.currentChunk && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Currently processing: {progress.currentChunk}
              </p>
            )}
          </div>
        )}

        {/* Performance Benefits */}
        <div className="bg-blue-50 dark:bg-blue-950 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-2">
            🚀 Chunked Processing Benefits
          </h4>
          <ul className="text-xs text-blue-800 dark:text-blue-200 space-y-1">
            <li>• Memory-efficient processing of large files</li>
            <li>• Parallel processing for faster analysis</li>
            <li>• Advanced normalization and optimization</li>
            <li>• Scalable to files of any size</li>
          </ul>
        </div>

        {progress.phase === "complete" && (
          <div className="text-center">
            <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-2" />
            <p className="text-green-700 dark:text-green-300 font-medium">
              Analysis complete! Your large dataset has been successfully processed.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
