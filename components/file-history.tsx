"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FileSpreadsheet, Download, Calendar, CheckCircle, Clock, Trash2 } from "lucide-react"
import { supabase } from "@/lib/enhanced-auth"
import { useToast } from "@/hooks/use-toast"
import { enhancedAuth } from "@/lib/enhanced-auth"

interface FileHistoryItem {
  id: string
  sessionId: string
  originalFilename: string
  cleanedFilename?: string
  fileSize: number
  totalRecommendations: number
  acceptedRecommendations: number
  skippedRecommendations: number
  status: string
  createdAt: string
  completedAt?: string
}

interface FileHistoryProps {
  onSelectFile?: (sessionId: string) => void
}

export function FileHistory({ onSelectFile }: FileHistoryProps) {
  const [history, setHistory] = useState<FileHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    loadFileHistory()
  }, [])

  const loadFileHistory = async () => {
    try {
      const {
        data: { session },
      } = await enhancedAuth.getSession()

      if (!session?.user) {
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from("user_file_history")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(20)

      if (error) {
        console.error("Failed to load file history:", error)
        toast({
          title: "Error",
          description: "Failed to load file history",
          variant: "destructive",
        })
        return
      }

      const historyItems: FileHistoryItem[] = data.map((item) => ({
        id: item.id,
        sessionId: item.session_id,
        originalFilename: item.original_filename,
        cleanedFilename: item.cleaned_filename,
        fileSize: item.file_size,
        totalRecommendations: item.total_recommendations || 0,
        acceptedRecommendations: item.accepted_recommendations || 0,
        skippedRecommendations: item.skipped_recommendations || 0,
        status: item.status,
        createdAt: item.created_at,
        completedAt: item.completed_at,
      }))

      setHistory(historyItems)
    } catch (error) {
      console.error("Error loading file history:", error)
      toast({
        title: "Error",
        description: "Failed to load file history",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async (sessionId: string, type: "excel" | "report", filename: string) => {
    setDownloading(`${sessionId}-${type}`)

    try {
      console.log(`Starting download: ${type} for session ${sessionId}`)

      const {
        data: { session },
      } = await enhancedAuth.getSession()

      if (!session) {
        throw new Error("Not authenticated")
      }

      console.log("Making download request...")

      const response = await fetch(`/api/download/${type}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ sessionId }),
      })

      console.log("Download response status:", response.status)

      if (!response.ok) {
        const contentType = response.headers.get("content-type")
        let errorMessage = "Download failed"

        if (contentType && contentType.includes("application/json")) {
          try {
            const errorData = await response.json()
            errorMessage = errorData.error || errorMessage
            console.error("Download error response:", errorData)
          } catch (parseError) {
            console.error("Failed to parse error response:", parseError)
          }
        } else {
          const textResponse = await response.text()
          console.error("Non-JSON error response:", textResponse)
          errorMessage = `Server error: ${response.status}`
        }

        throw new Error(errorMessage)
      }

      const blob = await response.blob()
      console.log("Download blob size:", blob.size)

      if (blob.size === 0) {
        throw new Error("Downloaded file is empty")
      }

      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = type === "excel" ? `cleaned_${filename}` : `report_${filename.replace(".xlsx", ".html")}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: "Download Complete",
        description: `${type === "excel" ? "Excel file" : "Report"} downloaded successfully`,
      })
    } catch (error) {
      console.error("Download failed:", error)
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Failed to download file",
        variant: "destructive",
      })
    } finally {
      setDownloading(null)
    }
  }

  const handleDeleteSession = async (historyId: string, sessionId: string) => {
    try {
      const {
        data: { session },
      } = await enhancedAuth.getSession()

      if (!session) {
        throw new Error("Not authenticated")
      }

      // Delete from history table
      const { error } = await supabase.from("user_file_history").delete().eq("id", historyId)

      if (error) {
        throw new Error("Failed to delete session")
      }

      // Update local state
      setHistory((prev) => prev.filter((item) => item.id !== historyId))

      toast({
        title: "Session Deleted",
        description: "File session has been removed from your history",
      })
    } catch (error) {
      console.error("Delete failed:", error)
      toast({
        title: "Delete Failed",
        description: error instanceof Error ? error.message : "Failed to delete session",
        variant: "destructive",
      })
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Completed</Badge>
      case "processing":
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">Processing</Badge>
      case "failed":
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Failed</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>File History</CardTitle>
          <CardDescription>Loading your past cleaning sessions...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (history.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>File History</CardTitle>
          <CardDescription>Your past cleaning sessions will appear here</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <FileSpreadsheet className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No files cleaned yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">Upload your first Excel file to get started</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <FileSpreadsheet className="h-5 w-5" />
          <span>File History ({history.length})</span>
        </CardTitle>
        <CardDescription>Your past Excel cleaning sessions</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {history.map((item) => (
            <div
              key={item.id}
              className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <h3 className="font-medium text-sm">{item.originalFilename}</h3>
                    {getStatusBadge(item.status)}
                  </div>

                  <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400 mb-3">
                    <span className="flex items-center space-x-1">
                      <Calendar className="h-3 w-3" />
                      <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                    </span>
                    <span>{formatFileSize(item.fileSize)}</span>
                    {item.status === "completed" && (
                      <span className="flex items-center space-x-1">
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        <span>{item.acceptedRecommendations} applied</span>
                      </span>
                    )}
                  </div>

                  {item.status === "completed" && item.totalRecommendations > 0 && (
                    <div className="flex space-x-4 text-xs">
                      <span className="text-green-600">✓ {item.acceptedRecommendations} applied</span>
                      <span className="text-gray-500">⏭ {item.skippedRecommendations} skipped</span>
                      <span className="text-blue-600">📊 {item.totalRecommendations} total</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center space-x-2 ml-4">
                  {item.status === "completed" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownload(item.sessionId, "excel", item.originalFilename)}
                        disabled={downloading === `${item.sessionId}-excel`}
                      >
                        <Download className="h-3 w-3 mr-1" />
                        {downloading === `${item.sessionId}-excel` ? "..." : "Excel"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownload(item.sessionId, "report", item.originalFilename)}
                        disabled={downloading === `${item.sessionId}-report`}
                      >
                        <Download className="h-3 w-3 mr-1" />
                        {downloading === `${item.sessionId}-report` ? "..." : "Report"}
                      </Button>
                    </>
                  )}
                  {item.status === "processing" && onSelectFile && (
                    <Button size="sm" variant="outline" onClick={() => onSelectFile(item.sessionId)}>
                      <Clock className="h-3 w-3 mr-1" />
                      Continue
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDeleteSession(item.id, item.sessionId)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
