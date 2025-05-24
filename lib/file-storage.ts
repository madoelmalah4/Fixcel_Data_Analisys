import { createServerClient } from "@/lib/supabase"

// Simple in-memory storage for development/demo purposes
const fileStorage = new Map<string, Buffer>()
const fileMetadata = new Map<string, { filename: string; mimetype: string; uploadedAt: string }>()

export class FileStorage {
  static async storeFile(sessionId: string, filename: string, buffer: Buffer, mimetype: string): Promise<string> {
    try {
      // Try Supabase Storage first
      const supabase = createServerClient()
      const filePath = `${sessionId}/${filename}`

      const { data, error } = await supabase.storage.from("excel-files").upload(filePath, buffer, {
        contentType: mimetype,
        upsert: true,
      })

      if (!error && data) {
        console.log("File stored in Supabase Storage:", data.path)
        return data.path
      }

      console.warn("Supabase Storage failed, using fallback:", error?.message)
    } catch (error) {
      console.warn("Supabase Storage error, using fallback:", error)
    }

    // Fallback to in-memory storage
    const key = `${sessionId}/${filename}`
    fileStorage.set(key, buffer)
    fileMetadata.set(key, {
      filename,
      mimetype,
      uploadedAt: new Date().toISOString(),
    })

    console.log("File stored in memory storage:", key)
    return key
  }

  static async getFile(sessionId: string, filename: string): Promise<Buffer> {
    try {
      // Try Supabase Storage first
      const supabase = createServerClient()
      const filePath = `${sessionId}/${filename}`

      const { data, error } = await supabase.storage.from("excel-files").download(filePath)

      if (!error && data) {
        console.log("File retrieved from Supabase Storage")
        return Buffer.from(await data.arrayBuffer())
      }

      console.warn("Supabase Storage retrieval failed, trying fallback:", error?.message)
    } catch (error) {
      console.warn("Supabase Storage retrieval error, trying fallback:", error)
    }

    // Fallback to in-memory storage
    const key = `${sessionId}/${filename}`
    const buffer = fileStorage.get(key)

    if (!buffer) {
      // Try alternative key formats
      const alternativeKeys = [filename, `${sessionId}_${filename}`, `files/${sessionId}/${filename}`]

      for (const altKey of alternativeKeys) {
        const altBuffer = fileStorage.get(altKey)
        if (altBuffer) {
          console.log("File retrieved from memory storage with alternative key:", altKey)
          return altBuffer
        }
      }

      throw new Error(`File not found: ${key}. Available keys: ${Array.from(fileStorage.keys()).join(", ")}`)
    }

    console.log("File retrieved from memory storage:", key)
    return buffer
  }

  static async storeCleanedFile(sessionId: string, buffer: Buffer): Promise<string> {
    return this.storeFile(
      sessionId,
      "cleaned_file.xlsx",
      buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
  }

  static async getCleanedFile(sessionId: string): Promise<Buffer> {
    return this.getFile(sessionId, "cleaned_file.xlsx")
  }

  static getFileMetadata(sessionId: string, filename: string) {
    const key = `${sessionId}/${filename}`
    return fileMetadata.get(key)
  }

  static deleteFile(sessionId: string, filename: string): void {
    const key = `${sessionId}/${filename}`
    fileStorage.delete(key)
    fileMetadata.delete(key)
  }

  static deleteSession(sessionId: string): void {
    // Clean up all files for a session
    for (const [key] of fileStorage.entries()) {
      if (key.startsWith(`${sessionId}/`)) {
        fileStorage.delete(key)
        fileMetadata.delete(key)
      }
    }
  }

  static listStoredFiles(): string[] {
    return Array.from(fileStorage.keys())
  }
}
