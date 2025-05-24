"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/contexts/auth-context"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { FileUpload } from "@/components/file-upload"
import { CleaningStep } from "@/components/cleaning-step"
import { UserInputStep } from "@/components/user-input-step"
import { ResultsDownload } from "@/components/results-download"
import { FileHistory } from "@/components/file-history"
import { ThemeToggle } from "@/components/theme-toggle"
import { FileSpreadsheet, LogOut, User, Loader2, Upload, History, Brain, Wand2 } from "lucide-react"
import { supabase } from "@/lib/supabase"

interface CleaningSession {
  id: string
  status: "uploading" | "analyzing" | "cleaning" | "user_input" | "completed"
  filename: string
  currentStep: number
  totalSteps: number
  recommendations: CleaningRecommendation[]
  acceptedCount: number
  skippedCount: number
  userInputMode: boolean
}

interface CleaningRecommendation {
  id: string
  step: number
  message: string
  actionType: string
  targetColumn?: string
  status: "pending" | "accepted" | "skipped"
}

interface UserInputRecommendation {
  id: string
  userRequest: string
  aiResponse: string
  actionType: string
  targetColumn?: string
  status: "pending" | "accepted" | "rejected"
  reasoning: string
}

export default function AppPage() {
  const { user, signOut, loading: authLoading } = useAuth()
  const router = useRouter()
  const { toast } = useToast()
  const [session, setSession] = useState<CleaningSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState("upload")
  const [cleaningMode, setCleaningMode] = useState<"auto" | "manual">("auto")
  const [currentUserRecommendation, setCurrentUserRecommendation] = useState<UserInputRecommendation | null>(null)
  const [userInputLoading, setUserInputLoading] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/auth/login")
    }
  }, [user, authLoading, router])

  const handleSignOut = async () => {
    try {
      await signOut()
      router.push("/")
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to sign out",
        variant: "destructive",
      })
    }
  }

  const getAuthHeaders = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session?.access_token) {
        return { Authorization: `Bearer ${session.access_token}` }
      }
      return {}
    } catch (error) {
      console.error("Failed to get auth headers:", error)
      return {}
    }
  }

  const makeApiRequest = async (url: string, options: RequestInit = {}) => {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(await getAuthHeaders()),
          ...options.headers,
        },
      })

      // Check if response is JSON
      const contentType = response.headers.get("content-type")
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text()
        console.error("Non-JSON response:", text)
        throw new Error(`Server returned non-JSON response: ${response.status}`)
      }

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `Request failed with status ${response.status}`)
      }

      return data
    } catch (error) {
      console.error("API request failed:", error)
      throw error
    }
  }

  const handleFileUpload = async (file: File) => {
    setLoading(true)
    setActiveTab("upload")
    try {
      const formData = new FormData()
      formData.append("file", file)

      const authHeaders = await getAuthHeaders()

      console.log("Uploading file:", file.name, "Size:", file.size)

      const response = await fetch("/api/upload", {
        method: "POST",
        headers: authHeaders,
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `Upload failed with status ${response.status}`)
      }

      const data = await response.json()

      setSession({
        id: data.sessionId,
        status: cleaningMode === "auto" ? "analyzing" : "user_input",
        filename: file.name,
        currentStep: 0,
        totalSteps: 0,
        recommendations: [],
        acceptedCount: 0,
        skippedCount: 0,
        userInputMode: cleaningMode === "manual",
      })

      if (cleaningMode === "auto") {
        await analyzeFile(data.sessionId)
      }
    } catch (error) {
      console.error("Upload error:", error)
      toast({
        title: "Upload Error",
        description: error instanceof Error ? error.message : "Failed to upload file. Please try again.",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  const analyzeFile = async (sessionId: string) => {
    try {
      const data = await makeApiRequest("/api/analyze", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      })

      setSession((prev) =>
        prev
          ? {
              ...prev,
              status: data.recommendations.length > 0 ? "cleaning" : "completed",
              totalSteps: data.recommendations.length,
              recommendations: data.recommendations,
            }
          : null,
      )

      if (data.recommendations.length === 0) {
        toast({
          title: "Analysis Complete",
          description: "Your Excel file is already clean! No issues were found.",
        })
      }
    } catch (error) {
      console.error("Analysis error:", error)
      toast({
        title: "Analysis Error",
        description: error instanceof Error ? error.message : "Failed to analyze file. Please try again.",
        variant: "destructive",
      })
    }
  }

  const handleUserRequest = async (userRequest: string): Promise<UserInputRecommendation> => {
    if (!session) throw new Error("No active session")

    setUserInputLoading(true)
    try {
      console.log("Submitting user request:", userRequest)

      const data = await makeApiRequest("/api/user-request", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          userRequest,
        }),
      })

      const recommendation = {
        ...data.recommendation,
        status: "pending" as const,
      }

      setCurrentUserRecommendation(recommendation)
      console.log("User request processed successfully:", recommendation.id)
      return recommendation
    } catch (error) {
      console.error("User request error:", error)
      toast({
        title: "Request Failed",
        description: error instanceof Error ? error.message : "Failed to process your request",
        variant: "destructive",
      })
      throw error
    } finally {
      setUserInputLoading(false)
    }
  }

  const handleUserRecommendationDecision = async (recommendationId: string, decision: "accept" | "reject") => {
    try {
      console.log("Processing user decision:", decision, "for recommendation:", recommendationId)

      const data = await makeApiRequest("/api/apply-user-recommendation", {
        method: "POST",
        body: JSON.stringify({
          recommendationId,
          decision,
        }),
      })

      if (decision === "accept") {
        toast({
          title: "Applied!",
          description: "Your request has been applied to the data.",
        })

        setSession((prev) =>
          prev
            ? {
                ...prev,
                acceptedCount: prev.acceptedCount + 1,
              }
            : null,
        )
      } else {
        toast({
          title: "Rejected",
          description: "Recommendation has been rejected.",
        })
      }

      // Clear current recommendation
      setCurrentUserRecommendation(null)
      console.log("User decision processed successfully")
    } catch (error) {
      console.error("Decision error:", error)
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to process decision",
        variant: "destructive",
      })
      throw error
    }
  }

  const handleRecommendationDecision = async (recommendationId: string, decision: "accept" | "skip") => {
    if (!session) return

    try {
      const data = await makeApiRequest("/api/apply-recommendation", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          recommendationId,
          decision,
        }),
      })

      setSession((prev) => {
        if (!prev) return null

        const updatedRecommendations = prev.recommendations.map((rec) =>
          rec.id === recommendationId ? { ...rec, status: decision === "accept" ? "accepted" : "skipped" } : rec,
        )

        const nextStep = prev.currentStep + 1
        const isCompleted = nextStep >= prev.totalSteps

        return {
          ...prev,
          currentStep: nextStep,
          status: isCompleted ? "completed" : "cleaning",
          recommendations: updatedRecommendations,
          acceptedCount: decision === "accept" ? prev.acceptedCount + 1 : prev.acceptedCount,
          skippedCount: decision === "skip" ? prev.skippedCount + 1 : prev.skippedCount,
        }
      })

      toast({
        title: decision === "accept" ? "Applied!" : "Skipped",
        description:
          decision === "accept" ? "Recommendation has been applied to your data." : "Recommendation has been skipped.",
      })
    } catch (error) {
      console.error("Network error:", error)
      toast({
        title: "Network Error",
        description: "Failed to connect to server. Please check your connection and try again.",
        variant: "destructive",
      })
    }
  }

  const handleStartOver = () => {
    setSession(null)
    setCurrentUserRecommendation(null)
    setActiveTab("upload")
  }

  const handleSelectFile = (sessionId: string) => {
    setActiveTab("upload")
    toast({
      title: "Feature Coming Soon",
      description: "Resume functionality will be available in the next update",
    })
  }

  const switchToManualMode = () => {
    if (session) {
      setSession((prev) => (prev ? { ...prev, status: "user_input", userInputMode: true } : null))
    }
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {/* Header */}
      <header className="border-b bg-white/80 dark:bg-gray-900/80 backdrop-blur">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <FileSpreadsheet className="h-8 w-8 text-blue-600" />
            <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Excel AI Assistant
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <ThemeToggle />
            <div className="flex items-center space-x-2">
              <User className="h-4 w-4" />
              <span className="text-sm text-gray-600 dark:text-gray-300">{user.email}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        {!session ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="max-w-4xl mx-auto">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload" className="flex items-center space-x-2">
                <Upload className="h-4 w-4" />
                <span>Upload New File</span>
              </TabsTrigger>
              <TabsTrigger value="history" className="flex items-center space-x-2">
                <History className="h-4 w-4" />
                <span>File History</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="mt-6">
              <div className="max-w-2xl mx-auto">
                <div className="text-center mb-8">
                  <h1 className="text-3xl font-bold mb-4">Upload Your Excel File</h1>
                  <p className="text-gray-600 dark:text-gray-300 mb-6">
                    Upload an Excel file (.xlsx) and choose how you'd like to clean your data.
                  </p>

                  {/* Cleaning Mode Selection */}
                  <div className="mb-8">
                    <h3 className="text-lg font-semibold mb-4">Choose Cleaning Mode:</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <Card
                        className={`cursor-pointer transition-all ${cleaningMode === "auto" ? "ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-950" : "hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                        onClick={() => setCleaningMode("auto")}
                      >
                        <CardHeader className="text-center">
                          <Brain className="h-8 w-8 text-blue-600 mx-auto mb-2" />
                          <CardTitle className="text-lg">Auto Mode</CardTitle>
                          <CardDescription>
                            AI analyzes your data and suggests cleaning actions automatically
                          </CardDescription>
                        </CardHeader>
                      </Card>

                      <Card
                        className={`cursor-pointer transition-all ${cleaningMode === "manual" ? "ring-2 ring-purple-500 bg-purple-50 dark:bg-purple-950" : "hover:bg-gray-50 dark:hover:bg-gray-800"}`}
                        onClick={() => setCleaningMode("manual")}
                      >
                        <CardHeader className="text-center">
                          <Wand2 className="h-8 w-8 text-purple-600 mx-auto mb-2" />
                          <CardTitle className="text-lg">Manual Mode</CardTitle>
                          <CardDescription>Tell the AI exactly what you want to do with your data</CardDescription>
                        </CardHeader>
                      </Card>
                    </div>
                  </div>
                </div>
                <FileUpload onFileUpload={handleFileUpload} loading={loading} />
              </div>
            </TabsContent>

            <TabsContent value="history" className="mt-6">
              <FileHistory onSelectFile={handleSelectFile} />
            </TabsContent>
          </Tabs>
        ) : (
          <>
            {session.status === "analyzing" && (
              <div className="max-w-2xl mx-auto text-center">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-center space-x-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span>Analyzing Your Data</span>
                    </CardTitle>
                    <CardDescription>
                      Our AI is examining {session.filename} to identify cleaning opportunities...
                    </CardDescription>
                  </CardHeader>
                </Card>
              </div>
            )}

            {session.status === "user_input" && (
              <div className="max-w-4xl mx-auto">
                <div className="mb-8 text-center">
                  <h1 className="text-2xl font-bold mb-2">Manual Cleaning Mode</h1>
                  <p className="text-gray-600 dark:text-gray-300 mb-4">
                    Tell the AI what you want to do with {session.filename}
                  </p>
                  {session.acceptedCount > 0 && (
                    <Badge variant="secondary">{session.acceptedCount} changes applied</Badge>
                  )}
                </div>

                <UserInputStep
                  onSubmitRequest={handleUserRequest}
                  onDecision={handleUserRecommendationDecision}
                  currentRecommendation={currentUserRecommendation}
                  loading={userInputLoading}
                />

                <div className="mt-8 text-center">
                  <Button onClick={handleStartOver} variant="outline">
                    Finish & Download Results
                  </Button>
                </div>
              </div>
            )}

            {session.status === "cleaning" && (
              <div className="max-w-4xl mx-auto">
                <div className="mb-8">
                  <div className="flex justify-between items-center mb-4">
                    <h1 className="text-2xl font-bold">Cleaning {session.filename}</h1>
                    <div className="flex items-center space-x-4">
                      <Badge variant="secondary">
                        Step {session.currentStep + 1} of {session.totalSteps}
                      </Badge>
                      <Button onClick={switchToManualMode} variant="outline" size="sm">
                        <Wand2 className="h-4 w-4 mr-2" />
                        Switch to Manual
                      </Button>
                    </div>
                  </div>
                  <Progress value={(session.currentStep / session.totalSteps) * 100} className="mb-4" />
                  <div className="flex space-x-4 text-sm text-gray-600 dark:text-gray-300">
                    <span>✅ Accepted: {session.acceptedCount}</span>
                    <span>⏭️ Skipped: {session.skippedCount}</span>
                  </div>
                </div>

                {session.currentStep < session.totalSteps && (
                  <CleaningStep
                    recommendation={session.recommendations[session.currentStep]}
                    onDecision={handleRecommendationDecision}
                  />
                )}
              </div>
            )}

            {session.status === "completed" && (
              <div className="max-w-2xl mx-auto">
                <ResultsDownload session={session} onStartOver={handleStartOver} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
