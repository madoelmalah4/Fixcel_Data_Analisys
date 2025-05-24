import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"

export async function middleware(request: NextRequest) {
  // Only protect API routes
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next()
  }

  // Skip auth for upload route (it handles auth internally)
  if (request.nextUrl.pathname === "/api/upload") {
    return NextResponse.next()
  }

  // Skip auth for download routes (they handle auth internally)
  if (request.nextUrl.pathname.startsWith("/api/download/")) {
    return NextResponse.next()
  }

  try {
    const supabase = createServerClient()

    // Get the session token from the request
    const authHeader = request.headers.get("authorization")
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const token = authHeader.replace("Bearer ", "")
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token)

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Add user info to request headers for API routes
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-user-id", user.id)
    requestHeaders.set("x-user-email", user.email || "")

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    })
  } catch (error) {
    console.error("Middleware error:", error)
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 })
  }
}

export const config = {
  matcher: [],
}
