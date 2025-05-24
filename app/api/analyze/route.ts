import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { ExcelProcessor } from "@/lib/excel-processor"
import { GeminiClient } from "@/lib/gemini-client"

// In-memory cache for processors
const processorCache = new Map<string, ExcelProcessor>()
const recommendationCache = new Map<string, any[]>()

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()
    const { sessionId } = await request.json()

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

    console.log(`Starting analysis for file: ${session.original_filename} (${session.file_size} bytes)`)

    try {
      // Initialize Excel processor from storage
      console.log("Loading file from storage...")
      const processor = await ExcelProcessor.fromStorage(sessionId, session.original_filename)

      // Parse Excel file
      console.log("Parsing Excel file...")
      const excelData = await processor.parseExcel()

      console.log(
        `Parsed Excel: ${excelData.metadata.sheetNames.length} sheets, ${excelData.metadata.totalRows} total rows`,
      )

      // Analyze data quality
      console.log("Analyzing data quality...")
      const qualityIssues = processor.analyzeDataQuality()

      console.log(`Found ${qualityIssues.length} data quality issues`)

      if (qualityIssues.length === 0) {
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
        })
      }

      // Get data sample for analysis
      const dataSample = processor.getDataSample(50) // Reduced sample size

      // Generate recommendations using the enhanced system
      console.log("Generating intelligent recommendations...")
      const geminiClient = new GeminiClient()

      let recommendations
      try {
        recommendations = await geminiClient.generateRecommendations(
          qualityIssues,
          dataSample,
          session.original_filename,
          sessionId,
        )
        console.log(`Generated ${recommendations.length} recommendations successfully`)
      } catch (error) {
        console.error("Recommendation generation failed:", error)

        // Ultimate fallback - simple rule-based recommendations
        recommendations = qualityIssues.slice(0, 5).map((issue, index) => ({
          id: `simple_${sessionId}_${index + 1}`,
          step: index + 1,
          message: generateSimpleMessage(issue),
          actionType: mapIssueToActionType(issue.type),
          targetColumn: issue.column,
          targetSheet: issue.sheet,
          priority: issue.severity,
          transformation: generateSimpleTransformation(issue),
          reasoning: `Basic recommendation for ${issue.type}`,
        }))
      }

      // Store recommendations in database with correct column names
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
      processorCache.set(sessionId, processor)

      // Store recommendations for transformation application
      recommendationCache.set(sessionId, recommendations)
      console.log(`Cached ${recommendations.length} recommendations for session ${sessionId}`)

      console.log(`Analysis complete for session ${sessionId}`)

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
        })),
        metadata: {
          totalIssues: qualityIssues.length,
          sheetsAnalyzed: excelData.metadata.sheetNames,
          fileSize: excelData.metadata.fileSize,
        },
      })
    } catch (processingError) {
      console.error("File processing error:", processingError)
      return NextResponse.json(
        {
          error: "Failed to process Excel file",
          details: processingError instanceof Error ? processingError.message : "Unknown error",
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("Analysis error:", error)

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
        error: "Analysis failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

// Helper methods for ultimate fallback
function generateSimpleMessage(issue: any): string {
  switch (issue.type) {
    case "missing_values":
      return `Found ${issue.count} missing values in '${issue.column}'. Fill these to complete your data.`
    case "duplicates":
      return `Found ${issue.count} duplicate rows. Remove these to avoid double-counting.`
    case "whitespace":
      return `Found whitespace issues in '${issue.column}'. Clean these for better consistency.`
    case "inconsistent_format":
      return `Found formatting issues in '${issue.column}'. Standardize for better analysis.`
    case "data_type_mismatch":
      return `Found mixed data types in '${issue.column}'. Convert to consistent type.`
    default:
      return `Found ${issue.count} issues in '${issue.column}' that need attention.`
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
