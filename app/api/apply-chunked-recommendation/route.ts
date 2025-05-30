import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { chunkedProcessorCache, chunkedRecommendationCache } from "./analyze-chunked/route"

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { sessionId, recommendationId, decision } = await request.json()

    console.log(
      `Processing chunked recommendation: ${recommendationId} with decision: ${decision} for session: ${sessionId}`,
    )

    if (!sessionId || !recommendationId || !decision) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    if (!["accept", "skip"].includes(decision)) {
      return NextResponse.json({ error: "Invalid decision" }, { status: 400 })
    }

    // Get the recommendation details from cache
    let recommendations = chunkedRecommendationCache.get(sessionId) || []
    console.log(`Found ${recommendations.length} cached recommendations for session ${sessionId}`)

    // If cache is empty, try to retrieve from database
    if (recommendations.length === 0) {
      console.log("Cache empty, retrieving recommendations from database...")

      const { data: dbRecommendations, error: dbError } = await supabase
        .from("cleaning_actions")
        .select("*")
        .eq("session_id", sessionId)
        .order("step_number")

      if (dbError) {
        console.error("Failed to retrieve recommendations from database:", dbError)
        return NextResponse.json({ error: "Failed to retrieve recommendations" }, { status: 500 })
      }

      if (!dbRecommendations || dbRecommendations.length === 0) {
        return NextResponse.json({ error: "No recommendations found for this session" }, { status: 404 })
      }

      // Convert database recommendations to cache format
      recommendations = dbRecommendations.map((dbRec) => ({
        id: dbRec.recommendation_id,
        step: dbRec.step_number,
        message: dbRec.ai_recommendation,
        actionType: dbRec.action_type,
        targetColumn: dbRec.target_column,
        targetSheet: dbRec.target_sheet,
        priority: dbRec.priority,
        transformation: dbRec.transformation_data ? JSON.parse(dbRec.transformation_data) : null,
        reasoning: "Retrieved from database",
        affectedChunks: [],
        canProcessInParallel: true,
      }))

      // Update cache
      chunkedRecommendationCache.set(sessionId, recommendations)
      console.log(`Loaded ${recommendations.length} recommendations from database into cache`)
    }

    let recommendation = recommendations.find((r: any) => r.id === recommendationId)

    if (!recommendation) {
      // Try to find by step number as fallback
      const stepMatch = recommendationId.match(/(\d+)/)
      if (stepMatch) {
        const stepNumber = Number.parseInt(stepMatch[1])
        recommendation = recommendations.find((r: any) => r.step === stepNumber)
        console.log(`Fallback: Found recommendation by step ${stepNumber}:`, !!recommendation)
      }
    }

    if (!recommendation) {
      console.error(
        `Recommendation not found. Available IDs:`,
        recommendations.map((r) => r.id),
      )
      return NextResponse.json(
        {
          error: "Recommendation not found",
          debug: {
            requestedId: recommendationId,
            availableIds: recommendations.map((r) => r.id),
            sessionId: sessionId,
            cacheSize: recommendations.length,
          },
        },
        { status: 404 },
      )
    }

    console.log(`Found recommendation:`, recommendation.actionType, recommendation.targetColumn)

    // Apply transformation if accepted
    if (decision === "accept") {
      const processor = chunkedProcessorCache.get(sessionId)

      if (processor && recommendation.transformation) {
        try {
          console.log(`Applying chunked transformation: ${recommendation.actionType}`)

          // Get affected chunks
          const affectedChunks = recommendation.affectedChunks || []
          const allChunks = processor.getAllChunks()

          // If no specific chunks specified, apply to all chunks of the target sheet
          const chunksToProcess =
            affectedChunks.length > 0
              ? allChunks.filter((chunk) => affectedChunks.includes(chunk.chunkId))
              : allChunks.filter((chunk) => chunk.sheetName === recommendation.targetSheet)

          console.log(`Processing ${chunksToProcess.length} chunks for transformation`)

          // Process chunks in parallel if possible
          if (recommendation.canProcessInParallel && chunksToProcess.length > 1) {
            console.log("Processing chunks in parallel...")

            // Process in batches to avoid overwhelming the system
            const batchSize = 3
            for (let i = 0; i < chunksToProcess.length; i += batchSize) {
              const batch = chunksToProcess.slice(i, i + batchSize)

              const batchPromises = batch.map(async (chunk) => {
                try {
                  // Ensure chunk is loaded
                  await processor.processChunk(chunk.chunkId)
                  // Apply transformation
                  await processor.applyTransformationToChunk(chunk.chunkId, recommendation.transformation)
                  console.log(`Applied transformation to chunk ${chunk.chunkId}`)
                } catch (chunkError) {
                  console.error(`Failed to apply transformation to chunk ${chunk.chunkId}:`, chunkError)
                  throw chunkError
                }
              })

              await Promise.all(batchPromises)
              console.log(
                `Completed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunksToProcess.length / batchSize)} batches`,
              )
            }
          } else {
            console.log("Processing chunks sequentially...")

            // Process sequentially for operations that require coordination
            for (const chunk of chunksToProcess) {
              try {
                // Ensure chunk is loaded
                await processor.processChunk(chunk.chunkId)
                // Apply transformation
                await processor.applyTransformationToChunk(chunk.chunkId, recommendation.transformation)
                console.log(`Applied transformation to chunk ${chunk.chunkId}`)
              } catch (chunkError) {
                console.error(`Failed to apply transformation to chunk ${chunk.chunkId}:`, chunkError)
                throw chunkError
              }
            }
          }

          console.log(
            `Successfully applied chunked transformation: ${recommendation.actionType} to ${chunksToProcess.length} chunks`,
          )
        } catch (transformError) {
          console.error("Chunked transformation failed:", transformError)
          return NextResponse.json(
            {
              error: "Failed to apply chunked transformation",
              details: transformError instanceof Error ? transformError.message : "Unknown error",
            },
            { status: 500 },
          )
        }
      } else {
        console.warn("No chunked processor found or no transformation data")
      }
    }

    // Update the cleaning action in database using step number
    const { error: updateError } = await supabase
      .from("cleaning_actions")
      .update({
        user_decision: decision === "accept" ? "accepted" : "skipped",
        applied_at: decision === "accept" ? new Date().toISOString() : null,
      })
      .eq("session_id", sessionId)
      .eq("step_number", recommendation.step)

    if (updateError) {
      console.error("Failed to update recommendation:", updateError)
      return NextResponse.json({ error: "Failed to update recommendation" }, { status: 500 })
    }

    // Get current counts
    const { data: actions } = await supabase
      .from("cleaning_actions")
      .select("user_decision")
      .eq("session_id", sessionId)

    const acceptedCount = actions?.filter((a) => a.user_decision === "accepted").length || 0
    const skippedCount = actions?.filter((a) => a.user_decision === "skipped").length || 0
    const totalCount = actions?.length || 0

    // Update session counts
    const status = acceptedCount + skippedCount >= totalCount ? "completed" : "processing"
    const completedAt = status === "completed" ? new Date().toISOString() : null

    await supabase
      .from("cleaning_sessions")
      .update({
        accepted_recommendations: acceptedCount,
        skipped_recommendations: skippedCount,
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId)

    // Update file history
    await supabase
      .from("user_file_history")
      .update({
        total_recommendations: totalCount,
        accepted_recommendations: acceptedCount,
        skipped_recommendations: skippedCount,
        status,
        completed_at: completedAt,
      })
      .eq("session_id", sessionId)

    console.log(
      `Successfully processed chunked recommendation. Progress: ${acceptedCount + skippedCount}/${totalCount}`,
    )

    return NextResponse.json({
      success: true,
      message: decision === "accept" ? "Chunked recommendation applied successfully" : "Recommendation skipped",
      progress: {
        completed: acceptedCount + skippedCount,
        total: totalCount,
        accepted: acceptedCount,
        skipped: skippedCount,
      },
      chunksProcessed: recommendation.affectedChunks?.length || 0,
    })
  } catch (error) {
    console.error("Apply chunked recommendation error:", error)
    return NextResponse.json(
      {
        error: "Failed to apply chunked recommendation",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
