import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { ExcelProcessor } from "@/lib/excel-processor"

// In-memory cache for processors (same as in other routes)
const processorCache = new Map<string, any>()

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

    // If no user from header, try to get from session
    if (!user) {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()
        if (!sessionError && session?.user) {
          user = session.user
        }
      } catch (sessionError) {
        console.warn("Session validation failed:", sessionError)
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

    console.log(`Download request: ${type} for session ${sessionId} by user ${user.id}`)

    // Get session and verify ownership
    const { data: session, error: sessionError } = await supabase
      .from("cleaning_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id) // Ensure user owns this session
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
      // Try to get from cache first
      let processor = processorCache.get(sessionId)

      // If not in cache, recreate the processor and apply transformations
      if (!processor) {
        console.log("Processor not in cache, recreating from storage...")

        try {
          // Load the original file and recreate processor
          processor = await ExcelProcessor.fromStorage(sessionId, session.original_filename)
          await processor.parseExcel()

          // Apply all accepted transformations in order
          const acceptedActions = actions.filter((a) => a.user_decision === "accepted")
          console.log(`Applying ${acceptedActions.length} accepted transformations...`)

          for (const action of acceptedActions) {
            if (action.transformation_data) {
              try {
                const transformation = JSON.parse(action.transformation_data)
                processor.applyTransformation(transformation)
                console.log(`Applied transformation: ${action.action_type} for ${action.target_column}`)
              } catch (transformError) {
                console.warn(`Failed to apply transformation for action ${action.id}:`, transformError)
              }
            }
          }

          // Cache the processor for future use
          processorCache.set(sessionId, processor)
        } catch (error) {
          console.error("Failed to recreate processor:", error)
          return NextResponse.json(
            {
              error: "Failed to recreate processed data",
              details: error instanceof Error ? error.message : "Unknown error",
            },
            { status: 500 },
          )
        }
      }

      try {
        const cleanedExcelBuffer = await processor.generateCleanedExcel()

        return new NextResponse(cleanedExcelBuffer, {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="cleaned_${session.original_filename}"`,
            "Content-Length": cleanedExcelBuffer.length.toString(),
          },
        })
      } catch (error) {
        console.error("Failed to generate Excel file:", error)
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
      // Generate comprehensive HTML report
      const acceptedActions = actions.filter((a) => a.user_decision === "accepted")
      const skippedActions = actions.filter((a) => a.user_decision === "skipped")

      const htmlReport = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Excel Data Cleaning Report</title>
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
            .summary { 
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
            .section { padding: 40px; }
            .section h2 { 
              font-size: 1.8rem; 
              margin-bottom: 24px; 
              color: #1f2937; 
              border-bottom: 3px solid #e5e7eb; 
              padding-bottom: 12px; 
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
              <h1>📊 Data Cleaning Report</h1>
              <p>Comprehensive analysis and cleaning results for <strong>${session.original_filename}</strong></p>
            </div>
            
            <div class="summary">
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
                <div class="stat-number stat-accepted">${actions.length > 0 ? Math.round((acceptedActions.length / actions.length) * 100) : 0}%</div>
                <div class="stat-label">Completion Rate</div>
              </div>
            </div>
            
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
                      • Applied: ${action.applied_at ? new Date(action.applied_at).toLocaleString() : "N/A"}
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
              <p><strong>Excel AI Assistant</strong> - Powered by Google Gemini</p>
              <p class="timestamp">Report generated on ${new Date().toLocaleString()}</p>
            </div>
          </div>
        </body>
        </html>
      `

      return new NextResponse(htmlReport, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `attachment; filename="cleaning_report_${session.original_filename.replace(".xlsx", ".html")}"`,
        },
      })
    }

    return NextResponse.json({ error: "Invalid download type" }, { status: 400 })
  } catch (error) {
    console.error("Download error:", error)
    return NextResponse.json(
      {
        error: "Download failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
