"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState } from "react"
import type { User, Session } from "@supabase/supabase-js"
import { enhancedAuth } from "@/lib/enhanced-auth"

interface EnhancedAuthContextType {
  user: User | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resendConfirmation: (email: string) => Promise<void>
  resetPassword: (email: string) => Promise<void>
  isEmailConfirmed: boolean
  getAuthHeaders: () => Promise<{ [key: string]: string }>
}

const EnhancedAuthContext = createContext<EnhancedAuthContextType | undefined>(undefined)

export function EnhancedAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [isEmailConfirmed, setIsEmailConfirmed] = useState(false)

  useEffect(() => {
    // Get initial session
    enhancedAuth
      .getSession()
      .then((session) => {
        setSession(session)
        setUser(session?.user ?? null)
        setIsEmailConfirmed(session?.user?.email_confirmed_at != null)
        setLoading(false)
      })
      .catch((error) => {
        console.error("Failed to get initial session:", error)
        setLoading(false)
      })

    // Listen for auth changes
    const {
      data: { subscription },
    } = enhancedAuth.onAuthStateChange((event, session) => {
      console.log("Auth state changed:", event, session?.user?.email)

      setSession(session)
      setUser(session?.user ?? null)
      setIsEmailConfirmed(session?.user?.email_confirmed_at != null)
      setLoading(false)

      // Handle specific events
      if (event === "SIGNED_IN") {
        console.log("User signed in successfully")
      } else if (event === "SIGNED_OUT") {
        console.log("User signed out")
        // Clear any cached data
        localStorage.removeItem("excel-ai-cache")
      } else if (event === "TOKEN_REFRESHED") {
        console.log("Token refreshed")
      }
    })

    // Set up automatic token refresh
    const refreshInterval = setInterval(async () => {
      try {
        const currentSession = await enhancedAuth.getSession()
        if (currentSession && currentSession.expires_at) {
          const expiresAt = new Date(currentSession.expires_at * 1000)
          const now = new Date()
          const timeUntilExpiry = expiresAt.getTime() - now.getTime()

          // Refresh if token expires in less than 5 minutes
          if (timeUntilExpiry < 5 * 60 * 1000) {
            console.log("Refreshing session token...")
            await enhancedAuth.refreshSession()
          }
        }
      } catch (error) {
        console.error("Failed to refresh session:", error)
      }
    }, 60000) // Check every minute

    return () => {
      subscription.unsubscribe()
      clearInterval(refreshInterval)
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    try {
      const { user, session } = await enhancedAuth.signIn(email, password)

      if (!user?.email_confirmed_at) {
        throw new Error("Please check your email and click the confirmation link before signing in.")
      }

      setUser(user)
      setSession(session)
      setIsEmailConfirmed(true)
    } catch (error) {
      console.error("Sign in error:", error)
      throw error
    }
  }

  const signUp = async (email: string, password: string) => {
    try {
      const { user } = await enhancedAuth.signUp(email, password)

      // Don't set user state yet - wait for email confirmation
      if (user && !user.email_confirmed_at) {
        throw new Error("Please check your email and click the confirmation link to complete registration.")
      }
    } catch (error) {
      console.error("Sign up error:", error)
      throw error
    }
  }

  const signOut = async () => {
    try {
      await enhancedAuth.signOut()
      setUser(null)
      setSession(null)
      setIsEmailConfirmed(false)
    } catch (error) {
      console.error("Sign out error:", error)
      throw error
    }
  }

  const resendConfirmation = async (email: string) => {
    try {
      await enhancedAuth.resendConfirmation(email)
    } catch (error) {
      console.error("Resend confirmation error:", error)
      throw error
    }
  }

  const resetPassword = async (email: string) => {
    try {
      await enhancedAuth.resetPassword(email)
    } catch (error) {
      console.error("Reset password error:", error)
      throw error
    }
  }

  async function getAuthHeaders() {
    try {
      const session = await enhancedAuth.getSession()
      if (session?.access_token) {
        return { Authorization: `Bearer ${session.access_token}` }
      }
      return {}
    } catch (error) {
      console.error("Failed to get auth headers:", error)
      return {}
    }
  }

  return (
    <EnhancedAuthContext.Provider
      value={{
        user,
        session,
        loading,
        signIn,
        signUp,
        signOut,
        resendConfirmation,
        resetPassword,
        isEmailConfirmed,
        getAuthHeaders,
      }}
    >
      {children}
    </EnhancedAuthContext.Provider>
  )
}

export const useEnhancedAuth = () => {
  const context = useContext(EnhancedAuthContext)
  if (context === undefined) {
    throw new Error("useEnhancedAuth must be used within an EnhancedAuthProvider")
  }
  return context
}
