import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { chunkedProcessorCache } from "../analyze-chunked/route"

export async function POST(request: NextRequest, { params }: { params: { type: string } }) {
  try {
    const supabase = createServerClient()

    // Handle authentication
    let user = null
    const authHeader = request.headers.get("authorization")

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "")
      try {
        const {
          data: { user: authUser },
          error: authError,
        } = await supabase.auth.getUser(token)
        if (!authError && authUser) {
          user = authUser
        }
      } catch (authError) {
        console.warn("Auth token validation failed:", authError)
      }
    }

    if (!user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 })
    }

    const { sessionId } = await request.json()
    const { type } = params

    if (!sessionId) {
      return NextResponse.json({ error: "Session ID required" }, { status: 400 })
    }

    if (!["excel", "report"].includes(type)) {
      return NextResponse.json({ error: "Invalid download type" }, { status: 400 })
    }

    console.log(`Chunked download request: ${type} for session ${sessionId} by user ${user.id}`)

    // Get session and verify ownership
    const { data: session, error: sessionError } = await supabase
      .from("cleaning_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .single()

    if (sessionError || !session) {
      console.error("Session not found or access denied:", sessionError)
      return NextResponse.json({ error: "Session not found or access denied" }, { status: 404 })
    }

    const { data: actions } = await supabase
      .from("cleaning_actions")
      .select("*")
      .eq("session_id", sessionId)
      .order("step_number")

    if (!actions) {
      console.error("No actions found for session")
      return NextResponse.json({ error: "No cleaning actions found" }, { status: 404 })
    }

    if (type === "excel") {
      // Get chunked processor from cache
      let processor = chunkedProcessorCache.get(sessionId)

      if (!processor) {
        console.log("Chunked processor not in cache, recreating from storage...")

        try {
          const { ChunkedExcelProcessor } = await import("@/lib/chunked-excel-processor")
          processor = await ChunkedExcelProcessor.fromStorage(sessionId, session.original_filename)

          // Parse and process all chunks
          const { chunks } = await processor.parseExcelInChunks()
          console.log(`Recreated processor with ${chunks.length} chunks`)

          // Process all chunks that had accepted transformations
          const acceptedActions = actions.filter((a) => a.user_decision === "accepted")
          console.log(`Reapplying ${acceptedActions.length} accepted transformations...`)

          // Group actions by chunk requirements
          const chunkActions = new Map<string, any[]>()

          for (const action of acceptedActions) {
            if (action.transformation_data) {
              try {
                const transformation = JSON.parse(action.transformation_data)

                // Determine which chunks need this transformation
                const targetChunks = chunks.filter((chunk) => {
                  if (action.target_sheet && chunk.sheetName !== action.target_sheet) {
                    return false
                  }
                  if (action.target_column && !chunk.headers.includes(action.target_column)) {
                    return false
                  }
                  return true
                })

                // Add action to each relevant chunk
                targetChunks.forEach((chunk) => {
                  if (!chunkActions.has(chunk.chunkId)) {
                    chunkActions.set(chunk.chunkId, [])
                  }
                  chunkActions.get(chunk.chunkId)!.push({
                    action,
                    transformation,
                  })
                })
              } catch (parseError) {
                console.warn(`Failed to parse transformation for action ${action.id}:`, parseError)
              }
            }
          }

          // Process chunks with their transformations
          console.log(`Processing ${chunkActions.size} chunks with transformations...`)

          // Process in batches to manage memory
          const chunkIds = Array.from(chunkActions.keys())
          const batchSize = 5

          for (let i = 0; i < chunkIds.length; i += batchSize) {
            const batchChunkIds = chunkIds.slice(i, i + batchSize)

            console.log(
              `Processing chunk batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(chunkIds.length / batchSize)}`,
            )

            // Process batch in parallel
            const batchPromises = batchChunkIds.map(async (chunkId) => {
              try {
                // Load chunk data
                await processor!.processChunk(chunkId)

                // Apply all transformations for this chunk
                const chunkTransformations = chunkActions.get(chunkId) || []
                for (const { transformation } of chunkTransformations) {
                  await processor!.applyTransformationToChunk(chunkId, transformation)
                }

                console.log(`Processed chunk ${chunkId} with ${chunkTransformations.length} transformations`)
              } catch (chunkError) {
                console.error(`Failed to process chunk ${chunkId}:`, chunkError)
                throw chunkError
              }
            })

            await Promise.all(batchPromises)

            // Clear older chunks from memory to prevent memory issues
            if (i > batchSize) {
              const oldBatchIds = chunkIds.slice(Math.max(0, i - batchSize * 2), i - batchSize)
              oldBatchIds.forEach((oldChunkId) => {
                processor!.clearProcessedChunk(oldChunkId)
              })
            }
          }

          // Cache the processor
          chunkedProcessorCache.set(sessionId, processor)
          console.log("Chunked processor recreated and cached successfully")
        } catch (error) {
          console.error("Failed to recreate chunked processor:", error)
          return NextResponse.json(
            {
              error: "Failed to recreate processed data",
              details: error instanceof Error ? error.message : "Unknown processor error",
            },
            { status: 500 },
          )
        }
      }

      try {
        console.log("Generating cleaned Excel file from chunks...")
        const cleanedExcelBuffer = await processor.generateCleanedExcelFromChunks()

        console.log(`Generated cleaned Excel file: ${cleanedExcelBuffer.length} bytes`)

        return new NextResponse(cleanedExcelBuffer, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="cleaned_${session.original_filename}"`,
            "Content-Length": cleanedExcelBuffer.length.toString(),
          },
        })
      } catch (error) {
        console.error("Failed to generate chunked Excel file:", error)
        return NextResponse.json(
          {
            error: "Failed to generate Excel file",
            details: error instanceof Error ? error.message : "Unknown error",
          },
          { status: 500 },
        )
      }
    }

    if (type === "report") {
      // Generate enhanced report for chunked processing
      const acceptedActions = actions.filter((a) => a.user_decision === "accepted")
      const skippedActions = actions.filter((a) => a.user_decision === "skipped")

      // Get processing statistics
      const processor = chunkedProcessorCache.get(sessionId)
      const processingStats = processor ? processor.getProcessingProgress() : null
      const transformationLog = processor ? processor.getTransformationLog() : []

      const htmlReport = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Chunked Excel Data Cleaning Report</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
              line-height: 1.6; 
              color: #333; 
              background: #f8fafc;
              padding: 20px;
            }
            .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            .header { 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
              color: white; 
              padding: 40px; 
              text-align: center; 
            }
            .header h1 { font-size: 2.5rem; margin-bottom: 10px; font-weight: 700; }
            .header p { font-size: 1.1rem; opacity: 0.9; }
            .stats-grid { 
              display: grid; 
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
              gap: 20px; 
              padding: 40px; 
              background: #f8fafc; 
            }
            .stat-card { 
              background: white; 
              padding: 24px; 
              border-radius: 8px; 
              text-align: center; 
              box-shadow: 0 2px 4px rgba(0,0,0,0.1); 
            }
            .stat-number { font-size: 2.5rem; font-weight: bold; margin-bottom: 8px; }
            .stat-label { color: #6b7280; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.5px; }
            .stat-total { color: #3b82f6; }
            .stat-accepted { color: #10b981; }
            .stat-skipped { color: #6b7280; }
            .stat-chunks { color: #8b5cf6; }
            .section { padding: 40px; }
            .section h2 { 
              font-size: 1.8rem; 
              margin-bottom: 24px; 
              color: #1f2937; 
              border-bottom: 3px solid #e5e7eb; 
              padding-bottom: 12px; 
            }
            .processing-info {
              background: #ede9fe;
              border: 1px solid #c4b5fd;
              border-radius: 8px;
              padding: 20px;
              margin-bottom: 20px;
            }
            .processing-info h3 {
              color: #5b21b6;
              margin-bottom: 10px;
            }
            .action-grid { display: grid; gap: 16px; }
            .action-card { 
              background: white; 
              border: 1px solid #e5e7eb; 
              border-radius: 8px; 
              padding: 24px; 
              transition: transform 0.2s, box-shadow 0.2s; 
            }
            .action-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            .action-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
            .action-badge { 
              padding: 6px 12px; 
              border-radius: 20px; 
              font-size: 0.8rem; 
              font-weight: 600; 
              text-transform: uppercase; 
              letter-spacing: 0.5px; 
            }
            .badge-accepted { background: #d1fae5; color: #065f46; border-left: 4px solid #10b981; }
            .badge-skipped { background: #f3f4f6; color: #374151; border-left: 4px solid #6b7280; }
            .action-type { 
              background: #ede9fe; 
              color: #5b21b6; 
              padding: 4px 8px; 
              border-radius: 4px; 
              font-size: 0.75rem; 
              font-weight: 500; 
              margin-left: auto; 
            }
            .action-description { color: #4b5563; margin-bottom: 12px; }
            .action-details { font-size: 0.9rem; color: #6b7280; }
            .chunk-info { 
              background: #fef3c7; 
              border: 1px solid #fbbf24; 
              border-radius: 4px; 
              padding: 8px 12px; 
              margin-top: 8px; 
              font-size: 0.8rem; 
            }
            .footer { 
              background: #1f2937; 
              color: white; 
              padding: 24px 40px; 
              text-align: center; 
            }
            .timestamp { color: #9ca3af; font-size: 0.9rem; }
            @media print {
              body { background: white; padding: 0; }
              .container { box-shadow: none; }
              .action-card:hover { transform: none; box-shadow: none; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📊 Chunked Data Cleaning Report</h1>
              <p>Advanced large-file processing results for <strong>${session.original_filename}</strong></p>
            </div>
            
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-number stat-total">${actions.length}</div>
                <div class="stat-label">Total Recommendations</div>
              </div>
              <div class="stat-card">
                <div class="stat-number stat-accepted">${acceptedActions.length}</div>
                <div class="stat-label">Applied Changes</div>
              </div>
              <div class="stat-card">
                <div class="stat-number stat-skipped">${skippedActions.length}</div>
                <div class="stat-label">Skipped Suggestions</div>
              </div>
              <div class="stat-card">
                <div class="stat-number stat-chunks">${processingStats?.totalChunks || "N/A"}</div>
                <div class="stat-label">Chunks Processed</div>
              </div>
            </div>

            ${
              processingStats
                ? `
            <div class="section">
              <h2>🔧 Processing Information</h2>
              <div class="processing-info">
                <h3>Chunked Processing Statistics</h3>
                <p><strong>Total Chunks:</strong> ${processingStats.totalChunks}</p>
                <p><strong>Processed Chunks:</strong> ${processingStats.processedChunks}</p>
                <p><strong>Processing Completion:</strong> ${processingStats.percentage}%</p>
                <p><strong>Transformations Applied:</strong> ${transformationLog.length}</p>
                <p><strong>Memory Management:</strong> Chunked processing enabled efficient handling of large datasets</p>
              </div>
            </div>
            `
                : ""
            }
            
            ${
              acceptedActions.length > 0
                ? `
            <div class="section">
              <h2>✅ Applied Changes (${acceptedActions.length})</h2>
              <div class="action-grid">
                ${acceptedActions
                  .map(
                    (action, index) => `
                  <div class="action-card">
                    <div class="action-header">
                      <div class="action-badge badge-accepted">Applied</div>
                      <div class="action-type">${action.action_type.replace(/_/g, " ").toUpperCase()}</div>
                    </div>
                    <div class="action-description">${action.ai_recommendation}</div>
                    <div class="action-details">
                      <strong>Step ${action.step_number}</strong>
                      ${action.target_column ? ` • Column: <strong>${action.target_column}</strong>` : ""}
                      ${action.target_sheet ? ` • Sheet: <strong>${action.target_sheet}</strong>` : ""}
                      • Applied: ${action.applied_at ? new Date(action.applied_at).toLocaleString() : "N/A"}
                    </div>
                    <div class="chunk-info">
                      ⚡ Processed using chunked algorithm for optimal performance
                    </div>
                  </div>
                `,
                  )
                  .join("")}
              </div>
            </div>
            `
                : ""
            }
            
            ${
              skippedActions.length > 0
                ? `
            <div class="section">
              <h2>⏭️ Skipped Suggestions (${skippedActions.length})</h2>
              <div class="action-grid">
                ${skippedActions
                  .map(
                    (action) => `
                  <div class="action-card">
                    <div class="action-header">
                      <div class="action-badge badge-skipped">Skipped</div>
                      <div class="action-type">${action.action_type.replace(/_/g, " ").toUpperCase()}</div>
                    </div>
                    <div class="action-description">${action.ai_recommendation}</div>
                    <div class="action-details">
                      <strong>Step ${action.step_number}</strong>
                      ${action.target_column ? ` • Column: <strong>${action.target_column}</strong>` : ""}
                      ${action.target_sheet ? ` • Sheet: <strong>${action.target_sheet}</strong>` : ""}
                    </div>
                  </div>
                `,
                  )
                  .join("")}
              </div>
            </div>
            `
                : ""
            }
            
            <div class="footer">
              <p><strong>Excel AI Assistant</strong> - Advanced Chunked Processing Engine</p>
              <p class="timestamp">Report generated on ${new Date().toLocaleString()}</p>
              <p style="margin-top: 10px; font-size: 0.8rem;">
                This file was processed using our advanced chunked processing system,<br>
                enabling efficient handling of large datasets with optimal memory usage.
              </p>
            </div>
          </div>
        </body>
        </html>
      `

      return new NextResponse(htmlReport, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="chunked_report_${session.original_filename.replace(".xlsx", ".html")}"`,
        },
      })
    }

    return NextResponse.json({ error: "Invalid download type" }, { status: 400 })
  } catch (error) {
    console.error("Chunked download error:", error)
    return NextResponse.json(
      {
        error: "Chunked download failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
