"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FileSpreadsheet, FileText, RotateCcw, CheckCircle, X } from "lucide-react"
import { enhancedAuth } from "@/lib/enhanced-auth"

interface CleaningSession {
  id: string
  filename: string
  acceptedCount: number
  skippedCount: number
  recommendations: Array<{
    id: string
    message: string
    actionType: string
    targetColumn?: string
    status: "accepted" | "skipped" | "pending"
  }>
}

interface ResultsDownloadProps {
  session: CleaningSession
  onStartOver: () => void
}

export function ResultsDownload({ session, onStartOver }: ResultsDownloadProps) {
  const [downloading, setDownloading] = useState<"excel" | "report" | null>(null)

  const handleDownload = async (type: "excel" | "report") => {
    setDownloading(type)

    try {
      // Get the session token
      // const {
      //   data: { session: authSession },
      // } = await supabase.auth.getSession()
      const authSession = await enhancedAuth.getSession()
      if (!authSession) {
        throw new Error("Not authenticated")
      }

      const response = await fetch(`/api/download/${type}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authSession.access_token}`,
        },
        body: JSON.stringify({ sessionId: session.id }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || "Download failed")
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download =
        type === "excel"
          ? `cleaned_${session.filename}`
          : `cleaning_report_${session.filename.replace(".xlsx", ".html")}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error("Download failed:", error)
      // Add toast notification for error
    } finally {
      setDownloading(null)
    }
  }

  const acceptedRecommendations = session.recommendations.filter((r) => r.status === "accepted")
  const skippedRecommendations = session.recommendations.filter((r) => r.status === "skipped")

  return (
    <div className="space-y-6">
      {/* Success Header */}
      <Card className="border-green-200 bg-green-50 dark:bg-green-950 dark:border-green-800">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
          </div>
          <CardTitle className="text-2xl text-green-800 dark:text-green-200">Data Cleaning Complete!</CardTitle>
          <CardDescription className="text-green-700 dark:text-green-300">
            Your Excel file has been successfully processed and cleaned
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Summary Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Cleaning Summary</CardTitle>
          <CardDescription>Overview of the cleaning process for {session.filename}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-blue-600">{session.recommendations.length}</div>
              <div className="text-sm text-gray-600 dark:text-gray-300">Total Suggestions</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{session.acceptedCount}</div>
              <div className="text-sm text-gray-600 dark:text-gray-300">Applied</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-600">{session.skippedCount}</div>
              <div className="text-sm text-gray-600 dark:text-gray-300">Skipped</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Download Options */}
      <Card>
        <CardHeader>
          <CardTitle>Download Your Results</CardTitle>
          <CardDescription>Get your cleaned data and detailed report</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Button
              onClick={() => handleDownload("excel")}
              disabled={downloading === "excel"}
              className="h-auto p-4 flex flex-col items-center space-y-2"
            >
              <FileSpreadsheet className="h-8 w-8" />
              <div>
                <div className="font-semibold">Cleaned Excel File</div>
                <div className="text-xs opacity-80">Download your processed .xlsx file</div>
              </div>
              {downloading === "excel" && <div className="text-xs">Preparing download...</div>}
            </Button>

            <Button
              onClick={() => handleDownload("report")}
              disabled={downloading === "report"}
              variant="outline"
              className="h-auto p-4 flex flex-col items-center space-y-2"
            >
              <FileText className="h-8 w-8" />
              <div>
                <div className="font-semibold">Summary Report</div>
                <div className="text-xs opacity-80">Detailed PDF of all changes</div>
              </div>
              {downloading === "report" && <div className="text-xs">Generating report...</div>}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Applied Changes */}
      {acceptedRecommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span>Applied Changes ({acceptedRecommendations.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {acceptedRecommendations.map((rec, index) => (
              <div key={rec.id} className="flex items-start space-x-3 p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">{index + 1}</Badge>
                <div className="flex-1">
                  <p className="text-sm">{rec.message}</p>
                  {rec.targetColumn && (
                    <Badge variant="outline" className="mt-1">
                      {rec.targetColumn}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Skipped Changes */}
      {skippedRecommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <X className="h-5 w-5 text-gray-600" />
              <span>Skipped Suggestions ({skippedRecommendations.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {skippedRecommendations.map((rec, index) => (
              <div key={rec.id} className="flex items-start space-x-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <Badge variant="outline">{index + 1}</Badge>
                <div className="flex-1">
                  <p className="text-sm text-gray-600 dark:text-gray-300">{rec.message}</p>
                  {rec.targetColumn && (
                    <Badge variant="outline" className="mt-1">
                      {rec.targetColumn}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Start Over */}
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <Button onClick={onStartOver} variant="outline" className="w-full">
              <RotateCcw className="h-4 w-4 mr-2" />
              Clean Another File
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
