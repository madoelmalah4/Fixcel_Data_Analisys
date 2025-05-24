import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { ExcelProcessor } from "@/lib/excel-processor"

// Cache for processors and recommendations (fallback)
const processorCache = new Map<string, ExcelProcessor>()
const recommendationFallbackCache = new Map<string, any>()

export async function POST(request: NextRequest) {
  try {
    console.log("Apply user recommendation API called")

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

    const { recommendationId, decision } = body

    if (!recommendationId || !decision) {
      return NextResponse.json(
        { error: "Missing required fields", details: "recommendationId and decision are required" },
        { status: 400 },
      )
    }

    if (!["accept", "reject"].includes(decision)) {
      return NextResponse.json(
        { error: "Invalid decision", details: "Decision must be 'accept' or 'reject'" },
        { status: 400 },
      )
    }

    console.log(`Processing user decision: ${decision} for recommendation: ${recommendationId}`)

    const supabase = createServerClient()
    let recommendation = null
    let sessionId = null

    // Try to get recommendation from database first
    try {
      const { data: dbRecommendation, error: recError } = await supabase
        .from("user_recommendations")
        .select("*")
        .eq("id", recommendationId)
        .eq("status", "pending")
        .single()

      if (!recError && dbRecommendation) {
        recommendation = dbRecommendation
        sessionId = dbRecommendation.session_id
        console.log("Found recommendation in database")
      } else {
        console.log("Database lookup failed or no result:", recError?.message)
      }
    } catch (dbError) {
      console.warn("Database lookup error:", dbError)
    }

    // Fallback to cache if database lookup failed
    if (!recommendation) {
      console.log("Trying fallback cache...")
      const cachedData = recommendationFallbackCache.get(recommendationId)
      if (cachedData) {
        recommendation = cachedData.recommendation
        sessionId = cachedData.sessionId
        console.log("Found recommendation in fallback cache")
      } else {
        console.log("Not found in fallback cache either")
      }
    }

    if (!recommendation || !sessionId) {
      console.error("Recommendation not found anywhere")
      return NextResponse.json(
        {
          error: "Recommendation not found",
          details: "The recommendation may have expired or been processed already",
          debug: {
            recommendationId,
            foundInDb: false,
            foundInCache: false,
            cacheKeys: Array.from(recommendationFallbackCache.keys()),
          },
        },
        { status: 404 },
      )
    }

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
    } catch (sessionLookupError) {
      console.error("Session lookup error:", sessionLookupError)
      return NextResponse.json(
        { error: "Failed to lookup session", details: "Database error occurred" },
        { status: 500 },
      )
    }

    if (decision === "accept") {
      try {
        // Get or recreate processor
        let processor = processorCache.get(sessionId)
        if (!processor) {
          console.log("Recreating processor from storage...")
          try {
            processor = await ExcelProcessor.fromStorage(sessionId, session.original_filename)
            await processor.parseExcel()
            processorCache.set(sessionId, processor)
            console.log("Processor recreated successfully")
          } catch (processorError) {
            console.error("Failed to recreate processor:", processorError)
            return NextResponse.json(
              {
                error: "Failed to load file data",
                details: processorError instanceof Error ? processorError.message : "Unknown processor error",
              },
              { status: 500 },
            )
          }
        }

        // Parse transformation data safely
        let transformation
        try {
          const transformationData = recommendation.transformation_data || recommendation.transformation
          transformation = typeof transformationData === "string" ? JSON.parse(transformationData) : transformationData

          if (!transformation) {
            throw new Error("No transformation data found")
          }
        } catch (parseError) {
          console.error("Failed to parse transformation data:", parseError)
          return NextResponse.json(
            {
              error: "Invalid transformation data",
              details: "The recommendation contains invalid transformation instructions",
            },
            { status: 400 },
          )
        }

        // Apply the transformation
        try {
          processor.applyTransformation(transformation)
          console.log(
            `Applied user-requested transformation: ${recommendation.action_type || recommendation.actionType}`,
          )
        } catch (transformError) {
          console.error("Failed to apply transformation:", transformError)
          return NextResponse.json(
            {
              error: "Failed to apply transformation",
              details: transformError instanceof Error ? transformError.message : "Unknown transformation error",
            },
            { status: 500 },
          )
        }

        // Update recommendation status in database if it exists there
        try {
          await supabase
            .from("user_recommendations")
            .update({
              status: "accepted",
              applied_at: new Date().toISOString(),
            })
            .eq("id", recommendationId)
        } catch (updateError) {
          console.warn("Failed to update recommendation status:", updateError)
          // Continue anyway, the transformation was applied
        }

        // Store the action in cleaning_actions table for consistency
        try {
          await supabase.from("cleaning_actions").insert({
            session_id: sessionId,
            step_number: Date.now(), // Use timestamp as step number for user requests
            recommendation_id: recommendationId,
            ai_recommendation: recommendation.ai_response || recommendation.aiResponse,
            action_type: recommendation.action_type || recommendation.actionType,
            target_column: recommendation.target_column || recommendation.targetColumn,
            target_sheet: recommendation.target_sheet || recommendation.targetSheet,
            priority: "user_requested",
            transformation_data: JSON.stringify(transformation),
            user_decision: "accepted",
            applied_at: new Date().toISOString(),
          })
        } catch (insertError) {
          console.warn("Failed to insert cleaning action:", insertError)
          // Continue anyway, the transformation was applied
        }

        // Update session
        try {
          await supabase
            .from("cleaning_sessions")
            .update({
              status: "processing",
              updated_at: new Date().toISOString(),
            })
            .eq("id", sessionId)
        } catch (sessionUpdateError) {
          console.warn("Failed to update session:", sessionUpdateError)
          // Continue anyway
        }

        // Clean up cache
        recommendationFallbackCache.delete(recommendationId)

        return NextResponse.json({
          success: true,
          message: "User recommendation applied successfully",
          appliedAction: {
            type: recommendation.action_type || recommendation.actionType,
            target:
              recommendation.target_column ||
              recommendation.target_sheet ||
              recommendation.targetColumn ||
              recommendation.targetSheet,
            description: recommendation.ai_response || recommendation.aiResponse,
          },
        })
      } catch (unexpectedError) {
        console.error("Unexpected error during acceptance:", unexpectedError)
        return NextResponse.json(
          {
            error: "Unexpected error occurred",
            details: unexpectedError instanceof Error ? unexpectedError.message : "Unknown error",
          },
          { status: 500 },
        )
      }
    } else {
      // User rejected the recommendation
      console.log(`User rejected recommendation: ${recommendationId}`)

      // Update recommendation status if in database
      try {
        await supabase
          .from("user_recommendations")
          .update({
            status: "rejected",
            applied_at: new Date().toISOString(),
          })
          .eq("id", recommendationId)
      } catch (updateError) {
        console.warn("Failed to update rejection status:", updateError)
        // Continue anyway
      }

      // Clean up cache
      recommendationFallbackCache.delete(recommendationId)

      return NextResponse.json({
        success: true,
        message: "Recommendation rejected",
      })
    }
  } catch (error) {
    console.error("Apply user recommendation error:", error)
    return NextResponse.json(
      {
        error: "Failed to process user recommendation",
        details: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    )
  }
}

// Export the cache for use by other modules
export { recommendationFallbackCache }
