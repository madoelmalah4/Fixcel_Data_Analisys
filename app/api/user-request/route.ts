import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { ExcelProcessor } from "@/lib/excel-processor"
import { UserRequestProcessor } from "@/lib/user-request-processor"

// Cache for processors
const processorCache = new Map<string, ExcelProcessor>()

// We need to import this differently to avoid circular dependency
let recommendationFallbackCache: Map<string, any>

// Initialize the cache
if (typeof recommendationFallbackCache === "undefined") {
  recommendationFallbackCache = new Map<string, any>()
}

export async function POST(request: NextRequest) {
  try {
    console.log("User request API called")

    // Parse request body safely
    let body
    try {
      body = await request.json()
    } catch (parseError) {
      console.error("Failed to parse request body:", parseError)
      return NextResponse.json(
        { error: "Invalid request body", details: "Request body must be valid JSON" },
        { status: 400 },
      )
    }

    const { sessionId, userRequest } = body

    if (!sessionId || !userRequest) {
      return NextResponse.json(
        { error: "Missing required fields", details: "sessionId and userRequest are required" },
        { status: 400 },
      )
    }

    console.log(`Processing user request: "${userRequest}" for session: ${sessionId}`)

    const supabase = createServerClient()

    // Get session
    let session
    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from("cleaning_sessions")
        .select("*")
        .eq("id", sessionId)
        .single()

      if (sessionError || !sessionData) {
        console.error("Session not found:", sessionError)
        return NextResponse.json(
          { error: "Session not found", details: sessionError?.message || "Session may have been deleted" },
          { status: 404 },
        )
      }
      session = sessionData
    } catch (sessionError) {
      console.error("Session lookup error:", sessionError)
      return NextResponse.json(
        { error: "Failed to lookup session", details: "Database error occurred" },
        { status: 500 },
      )
    }

    // Get or create processor
    let processor = processorCache.get(sessionId)
    if (!processor) {
      try {
        console.log("Loading processor from storage...")
        processor = await ExcelProcessor.fromStorage(sessionId, session.original_filename)
        await processor.parseExcel()
        processorCache.set(sessionId, processor)
        console.log("Processor loaded successfully")
      } catch (processorError) {
        console.error("Failed to load processor:", processorError)
        return NextResponse.json(
          {
            error: "Failed to load file data",
            details: processorError instanceof Error ? processorError.message : "Unknown processor error",
          },
          { status: 500 },
        )
      }
    }

    // Get Excel data for context
    let excelData
    try {
      excelData = await processor.parseExcel()
      console.log("Excel data parsed successfully")
    } catch (parseError) {
      console.error("Failed to parse Excel data:", parseError)
      return NextResponse.json(
        {
          error: "Failed to parse Excel data",
          details: parseError instanceof Error ? parseError.message : "Unknown parsing error",
        },
        { status: 500 },
      )
    }

    // Process user request
    let recommendation
    try {
      const requestProcessor = new UserRequestProcessor()
      recommendation = await requestProcessor.processUserRequest(userRequest, excelData, sessionId)
      console.log(`Generated recommendation: ${recommendation.actionType}`)
    } catch (processingError) {
      console.error("Failed to process user request:", processingError)
      return NextResponse.json(
        {
          error: "Failed to process user request",
          details: processingError instanceof Error ? processingError.message : "AI processing failed",
        },
        { status: 500 },
      )
    }

    // Store the recommendation in database for persistence
    try {
      const { data: storedRecommendation, error: storeError } = await supabase
        .from("user_recommendations")
        .insert({
          id: recommendation.id,
          session_id: sessionId,
          user_request: recommendation.userRequest,
          ai_response: recommendation.aiResponse,
          action_type: recommendation.actionType,
          target_column: recommendation.targetColumn,
          target_sheet: recommendation.targetSheet,
          reasoning: recommendation.reasoning,
          transformation_data: JSON.stringify(recommendation.transformation),
          confidence: recommendation.confidence,
          status: "pending",
        })
        .select()
        .single()

      if (storeError) {
        console.error("Failed to store recommendation:", storeError)
        console.log("Continuing without database storage...")
      } else {
        console.log("Successfully stored recommendation in database")
      }
    } catch (dbError) {
      console.error("Database error:", dbError)
      // Continue anyway, we can still return the recommendation
    }

    // Store in fallback cache as backup
    const cacheData = {
      recommendation: {
        id: recommendation.id,
        session_id: sessionId,
        user_request: recommendation.userRequest,
        ai_response: recommendation.aiResponse,
        action_type: recommendation.actionType,
        target_column: recommendation.targetColumn,
        target_sheet: recommendation.targetSheet,
        reasoning: recommendation.reasoning,
        transformation_data: JSON.stringify(recommendation.transformation),
        confidence: recommendation.confidence,
        status: "pending",
      },
      sessionId: sessionId,
    }

    recommendationFallbackCache.set(recommendation.id, cacheData)
    console.log("Stored recommendation in fallback cache")

    return NextResponse.json({
      recommendation: {
        id: recommendation.id,
        userRequest: recommendation.userRequest,
        aiResponse: recommendation.aiResponse,
        actionType: recommendation.actionType,
        targetColumn: recommendation.targetColumn,
        targetSheet: recommendation.targetSheet,
        reasoning: recommendation.reasoning,
        confidence: recommendation.confidence,
        status: "pending",
      },
    })
  } catch (error) {
    console.error("User request processing error:", error)
    return NextResponse.json(
      {
        error: "Failed to process user request",
        details: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    )
  }
}

// Export the cache
export { recommendationFallbackCache }
