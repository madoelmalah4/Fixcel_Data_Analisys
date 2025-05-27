import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
})

export const enhancedAuth = {
  async signUp(email: string, password: string) {
    const { data, error } = await supabaseAuth.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        data: {
          email_confirm: true,
        },
      },
    })

    if (error) throw error
    return data
  },

  async signIn(email: string, password: string) {
    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    })

    if (error) throw error
    return data
  },

  async signOut() {
    const { error } = await supabaseAuth.auth.signOut()
    if (error) throw error
  },

  async resendConfirmation(email: string) {
    const { error } = await supabaseAuth.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) throw error
  },

  async resetPassword(email: string) {
    const { error } = await supabaseAuth.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    })

    if (error) throw error
  },

  onAuthStateChange(callback: (event: string, session: any) => void) {
    return supabaseAuth.auth.onAuthStateChange(callback)
  },

  async getSession() {
    const {
      data: { session },
      error,
    } = await supabaseAuth.auth.getSession()
    if (error) throw error
    return session
  },

  async refreshSession() {
    const {
      data: { session },
      error,
    } = await supabaseAuth.auth.refreshSession()
    if (error) throw error
    return session
  },
}

export { supabaseAuth as supabase }

export const getAuthHeaders = async () => {
  try {
    const session = await supabaseAuth.auth.getSession()
    if (session.data.session?.access_token) {
      return { Authorization: `Bearer ${session.data.session.access_token}` }
    }
    return {}
  } catch (error) {
    console.error("Failed to get auth headers:", error)
    return {}
  }
}
