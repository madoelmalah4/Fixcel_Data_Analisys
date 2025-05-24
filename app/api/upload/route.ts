import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { FileStorage } from "@/lib/file-storage"

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient()

    // Get the authorization header
    const authHeader = request.headers.get("authorization")

    // For file uploads, we might not have the auth header, so let's try to get the user differently
    let user = null

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

    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    // Validate file type and size
    if (!file.name.endsWith(".xlsx")) {
      return NextResponse.json({ error: "Only .xlsx files are allowed" }, { status: 400 })
    }

    if (file.size > 50 * 1024 * 1024) {
      // 50MB
      return NextResponse.json({ error: "File size must be less than 50MB" }, { status: 400 })
    }

    // Create cleaning session first
    const { data: session, error: sessionError } = await supabase
      .from("cleaning_sessions")
      .insert({
        user_id: user.id,
        original_filename: file.name,
        file_size: file.size,
        status: "processing",
      })
      .select()
      .single()

    if (sessionError) {
      console.error("Session creation error:", sessionError)
      return NextResponse.json({ error: "Failed to create session" }, { status: 500 })
    }

    try {
      // Convert file to buffer
      const fileBuffer = await file.arrayBuffer()
      const buffer = Buffer.from(fileBuffer)

      // Basic Excel file validation
      if (buffer.length < 100) {
        // Clean up session
        await supabase.from("cleaning_sessions").delete().eq("id", session.id)
        return NextResponse.json({ error: "File appears to be corrupted or empty" }, { status: 400 })
      }

      // Store file using our storage utility
      const filePath = await FileStorage.storeFile(session.id, file.name, buffer, file.type)

      // Update session with file path
      await supabase.from("cleaning_sessions").update({ original_file_path: filePath }).eq("id", session.id)

      // Create file history entry
      await supabase.from("user_file_history").insert({
        user_id: user.id,
        session_id: session.id,
        original_filename: file.name,
        file_size: file.size,
        status: "processing",
      })

      console.log(`File uploaded successfully: ${file.name} (${buffer.length} bytes) for session ${session.id}`)

      return NextResponse.json({
        sessionId: session.id,
        message: "File uploaded successfully",
        filePath: filePath,
      })
    } catch (error) {
      console.error("File processing error:", error)

      // Clean up session if file processing fails
      await supabase.from("cleaning_sessions").delete().eq("id", session.id)

      return NextResponse.json(
        {
          error: "Failed to process file",
          details: error instanceof Error ? error.message : "Unknown error",
        },
        { status: 500 },
      )
    }
  } catch (error) {
    console.error("Upload error:", error)
    return NextResponse.json(
      {
        error: "Upload failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
