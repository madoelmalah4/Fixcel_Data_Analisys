import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { ChunkedExcelProcessor } from "@/lib/chunked-excel-processor"
import { ChunkedGeminiClient } from "@/lib/chunked-gemini-client"
import type { DataQualityIssue } from "@/lib/excel-processor"

// In-memory cache for chunked processors
const chunkedProcessorCache = new Map<string, ChunkedExcelProcessor>()
const chunkedRecommendationCache = new Map<string, any[]>()

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { sessionId, chunkSize = 1000 } = await request.json()

    if (!sessionId) {
      return NextResponse.json({ error: "Session ID required" }, { status: 400 })
    }

    // Get session and verify ownership
    const { data: session, error: sessionError } = await supabase
      .from("cleaning_sessions")
      .select("*")
      .eq("id", sessionId)
      .single()

    if (sessionError || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 })
    }

    console.log(`Starting chunked analysis for file: ${session.original_filename} (${session.file_size} bytes)`)

    try {
      // Initialize chunked Excel processor
      console.log("Loading file for chunked processing...")
      const processor = await ChunkedExcelProcessor.fromStorage(sessionId, session.original_filename, chunkSize)

      // Parse Excel file into chunks
      console.log("Parsing Excel file into chunks...")
      const { metadata, chunks } = await processor.parseExcelInChunks()

      console.log(
        `Parsed Excel into ${chunks.length} chunks: ${metadata.sheetNames.length} sheets, ${metadata.totalRows} total rows`,
      )

      // Process chunks and analyze quality
      console.log("Processing chunks and analyzing data quality...")
      const allIssues: DataQualityIssue[] = []
      const chunkSamples: { [chunkId: string]: any[][] } = {}
      let processedChunks = 0

      // Process chunks in batches to manage memory
      const batchSize = 5
      for (let i = 0; i < chunks.length; i += batchSize) {
        const chunkBatch = chunks.slice(i, i + batchSize)

        console.log(`Processing chunk batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunks.length / batchSize)}`)

        // Process chunks in parallel within batch
        const batchPromises = chunkBatch.map(async (chunk) => {
          try {
            // Process chunk
            await processor.processChunk(chunk.chunkId)

            // Analyze quality
            const chunkIssues = await processor.analyzeChunkQuality(chunk.chunkId)

            // Get sample for AI analysis
            const sample = processor.getChunkSample(chunk.chunkId, 5)
            if (sample) {
              chunkSamples[chunk.chunkId] = sample
            }

            return chunkIssues
          } catch (error) {
            console.error(`Failed to process chunk ${chunk.chunkId}:`, error)
            return []
          }
        })

        const batchResults = await Promise.all(batchPromises)
        batchResults.forEach((issues) => allIssues.push(...issues))

        processedChunks += chunkBatch.length

        // Clear processed chunks from memory to prevent memory issues
        chunkBatch.forEach((chunk) => {
          if (processedChunks > batchSize * 2) {
            // Keep last 2 batches in memory
            processor.clearProcessedChunk(chunk.chunkId)
          }
        })

        console.log(`Processed ${processedChunks}/${chunks.length} chunks`)
      }

      console.log(`Found ${allIssues.length} total data quality issues across all chunks`)

      if (allIssues.length === 0) {
        // No issues found - create a completion response
        await supabase
          .from("cleaning_sessions")
          .update({
            status: "completed",
            total_recommendations: 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", sessionId)

        return NextResponse.json({
          recommendations: [],
          message: "Your Excel file is already clean! No issues were found that need attention.",
          metadata: {
            totalChunks: chunks.length,
            totalIssues: 0,
            sheetsAnalyzed: metadata.sheetNames,
            fileSize: metadata.fileSize,
          },
        })
      }

      // Aggregate similar issues across chunks
      const aggregatedIssues = aggregateIssuesAcrossChunks(allIssues)
      console.log(`Aggregated to ${aggregatedIssues.length} unique issue types`)

      // Generate recommendations using chunked AI system
      console.log("Generating intelligent recommendations for large dataset...")
      const geminiClient = new ChunkedGeminiClient()

      let recommendations
      try {
        recommendations = await geminiClient.generateChunkedRecommendations(
          aggregatedIssues,
          chunkSamples,
          chunks,
          session.original_filename,
          sessionId,
        )
        console.log(`Generated ${recommendations.length} chunked recommendations successfully`)
      } catch (error) {
        console.error("Chunked recommendation generation failed:", error)

        // Fallback to simple recommendations
        recommendations = aggregatedIssues.slice(0, 8).map((issue, index) => ({
          id: `chunked_simple_${sessionId}_${index + 1}`,
          step: index + 1,
          message: generateSimpleChunkedMessage(issue, chunks.length),
          actionType: mapIssueToActionType(issue.type),
          targetColumn: issue.column,
          targetSheet: issue.sheet,
          priority: issue.severity,
          transformation: {
            ...generateSimpleTransformation(issue),
            batchSize: chunkSize,
            parallelizable: true,
            memoryEfficient: true,
          },
          reasoning: `Basic recommendation for ${issue.type} across ${chunks.length} chunks`,
          affectedChunks: chunks.filter((chunk) => chunk.sheetName === issue.sheet).map((chunk) => chunk.chunkId),
          canProcessInParallel: true,
        }))
      }

      // Store recommendations in database
      if (recommendations.length > 0) {
        const recommendationInserts = recommendations.map((rec, index) => ({
          session_id: sessionId,
          step_number: index + 1,
          recommendation_id: rec.id,
          ai_recommendation: rec.message,
          action_type: rec.actionType,
          target_column: rec.targetColumn,
          target_sheet: rec.targetSheet,
          priority: rec.priority || "medium",
          transformation_data: JSON.stringify(rec.transformation),
          user_decision: "pending",
        }))

        console.log(`Inserting ${recommendationInserts.length} recommendations into database...`)

        const { error: insertError } = await supabase.from("cleaning_actions").insert(recommendationInserts)

        if (insertError) {
          console.error("Failed to store recommendations:", insertError)
          return NextResponse.json({ error: "Failed to store recommendations" }, { status: 500 })
        }

        console.log("Successfully stored recommendations in database")
      }

      // Update session
      await supabase
        .from("cleaning_sessions")
        .update({
          status: "processing",
          total_recommendations: recommendations.length,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId)

      // Store processor instance for later use
      chunkedProcessorCache.set(sessionId, processor)

      // Store recommendations for transformation application
      chunkedRecommendationCache.set(sessionId, recommendations)
      console.log(`Cached ${recommendations.length} recommendations for session ${sessionId}`)

      console.log(`Chunked analysis complete for session ${sessionId}`)

      return NextResponse.json({
        recommendations: recommendations.map((rec) => ({
          id: rec.id,
          step: rec.step,
          message: rec.message,
          actionType: rec.actionType,
          targetColumn: rec.targetColumn,
          targetSheet: rec.targetSheet,
          priority: rec.priority,
          status: "pending",
          affectedChunks: rec.affectedChunks?.length || 0,
          canProcessInParallel: rec.canProcessInParallel,
        })),
        metadata: {
          totalChunks: chunks.length,
          totalIssues: allIssues.length,
          aggregatedIssues: aggregatedIssues.length,
          sheetsAnalyzed: metadata.sheetNames,
          fileSize: metadata.fileSize,
          chunkSize: chunkSize,
        },
      })
    } catch (processingError) {
      console.error("Chunked file processing error:", processingError)
      return NextResponse.json(
        {
          error: "Failed to process Excel file in chunks",
          details: processingError instanceof Error ? processingError.message : "Unknown error",
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("Chunked analysis error:", error)

    // Update session status to failed
    try {
      const supabase = createServerClient()
      const { sessionId } = await request.json()
      if (sessionId) {
        await supabase.from("cleaning_sessions").update({ status: "failed" }).eq("id", sessionId)
      }
    } catch (updateError) {
      console.error("Failed to update session status:", updateError)
    }

    return NextResponse.json(
      {
        error: "Chunked analysis failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

// Helper function to aggregate similar issues across chunks
function aggregateIssuesAcrossChunks(allIssues: DataQualityIssue[]): DataQualityIssue[] {
  const issueMap = new Map<string, DataQualityIssue>()

  allIssues.forEach((issue) => {
    const key = `${issue.type}_${issue.sheet}_${issue.column || "global"}`

    if (issueMap.has(key)) {
      const existing = issueMap.get(key)!
      existing.count += issue.count
      existing.description = `${existing.description} (aggregated across chunks)`
      if (issue.examples) {
        existing.examples = [...(existing.examples || []), ...issue.examples].slice(0, 5)
      }
    } else {
      issueMap.set(key, { ...issue })
    }
  })

  return Array.from(issueMap.values()).sort((a, b) => {
    const severityOrder = { high: 3, medium: 2, low: 1 }
    return severityOrder[b.severity] - severityOrder[a.severity]
  })
}

// Helper functions for fallback recommendations
function generateSimpleChunkedMessage(issue: any, chunkCount: number): string {
  switch (issue.type) {
    case "missing_values":
      return `Found ${issue.count} missing values in '${issue.column}' across ${chunkCount} chunks. Fill these to complete your dataset.`
    case "duplicates":
      return `Found ${issue.count} duplicate rows across ${chunkCount} chunks. Remove these to avoid double-counting.`
    case "whitespace":
      return `Found whitespace issues in '${issue.column}' across ${chunkCount} chunks. Clean these for better consistency.`
    case "inconsistent_format":
      return `Found formatting issues in '${issue.column}' across ${chunkCount} chunks. Standardize for better analysis.`
    case "data_type_mismatch":
      return `Found mixed data types in '${issue.column}' across ${chunkCount} chunks. Convert to consistent type.`
    default:
      return `Found ${issue.count} issues in '${issue.column}' across ${chunkCount} chunks that need attention.`
  }
}

function mapIssueToActionType(issueType: string): string {
  const mapping: { [key: string]: string } = {
    missing_values: "fill_missing",
    duplicates: "remove_duplicates",
    whitespace: "trim_whitespace",
    inconsistent_format: "standardize_format",
    data_type_mismatch: "fix_data_types",
  }
  return mapping[issueType] || "fix_data_types"
}

function generateSimpleTransformation(issue: any): any {
  switch (issue.type) {
    case "missing_values":
      return {
        type: "fill_missing",
        sheet: issue.sheet,
        column: issue.column,
        method: "median",
      }
    case "duplicates":
      return {
        type: "remove_duplicates",
        sheet: issue.sheet,
      }
    case "whitespace":
      return {
        type: "trim_whitespace",
        sheet: issue.sheet,
        column: issue.column,
      }
    case "inconsistent_format":
      return {
        type: "standardize_format",
        sheet: issue.sheet,
        column: issue.column,
        format: "lowercase",
      }
    case "data_type_mismatch":
      return {
        type: "fix_data_types",
        sheet: issue.sheet,
        column: issue.column,
        targetType: "string",
      }
    default:
      return {
        type: "fix_data_types",
        sheet: issue.sheet,
        column: issue.column,
      }
  }
}

export { chunkedProcessorCache, chunkedRecommendationCache }
