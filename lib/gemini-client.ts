import { GoogleGenerativeAI } from "@google/generative-ai"
import type { DataQualityIssue } from "./excel-processor"
import { SmartRecommendationEngine } from "./smart-recommendations"

export interface GeminiRecommendation {
  id: string
  step: number
  message: string
  actionType: string
  targetColumn?: string
  targetSheet?: string
  priority: "high" | "medium" | "low"
  transformation: any
  reasoning: string
}

export class GeminiClient {
  private genAI: GoogleGenerativeAI | null = null
  private model: any = null
  private smartEngine: SmartRecommendationEngine

  constructor() {
    this.smartEngine = new SmartRecommendationEngine()

    // Only initialize Gemini if API key is available
    if (process.env.GOOGLE_GEMINI_API_KEY) {
      try {
        this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" }) // Use flash model for lower quota usage
      } catch (error) {
        console.warn("Failed to initialize Gemini client:", error)
        this.genAI = null
        this.model = null
      }
    } else {
      console.warn("GOOGLE_GEMINI_API_KEY not found, using smart recommendations only")
    }
  }

  async generateRecommendations(
    issues: DataQualityIssue[],
    dataSample: any,
    filename: string,
    sessionId?: string,
  ): Promise<GeminiRecommendation[]> {
    // Always try smart recommendations first as they're more reliable
    console.log("Generating smart rule-based recommendations...")
    const smartRecommendations = this.smartEngine.generateRecommendations(issues, dataSample, filename, sessionId)

    // Convert smart recommendations to Gemini format
    const recommendations: GeminiRecommendation[] = smartRecommendations.map((rec) => ({
      id: rec.id,
      step: rec.step,
      message: rec.message,
      actionType: rec.actionType,
      targetColumn: rec.targetColumn,
      targetSheet: rec.targetSheet,
      priority: rec.priority,
      transformation: rec.transformation,
      reasoning: rec.reasoning,
    }))

    // Only try Gemini if we have fewer than 3 recommendations and API is available
    if (recommendations.length < 3 && this.model && issues.length > 0) {
      try {
        console.log("Attempting to enhance with Gemini recommendations...")
        const geminiRecs = await this.tryGeminiRecommendations(issues, dataSample, filename, sessionId)

        // Merge unique Gemini recommendations
        const existingColumns = new Set(recommendations.map((r) => r.targetColumn).filter(Boolean))
        const newGeminiRecs = geminiRecs.filter((rec) => !existingColumns.has(rec.targetColumn) && rec.targetColumn)

        recommendations.push(...newGeminiRecs.slice(0, 5 - recommendations.length))
      } catch (error) {
        console.warn("Gemini enhancement failed, using smart recommendations only:", error)
      }
    }

    console.log(`Generated ${recommendations.length} total recommendations`)
    return recommendations.slice(0, 8) // Limit to 8 recommendations
  }

  private async tryGeminiRecommendations(
    issues: DataQualityIssue[],
    dataSample: any,
    filename: string,
    sessionId?: string,
  ): Promise<GeminiRecommendation[]> {
    if (!this.model) {
      throw new Error("Gemini model not available")
    }

    // Use a much simpler prompt to reduce token usage
    const prompt = `Analyze this Excel file data and suggest 2-3 cleaning actions:

File: ${filename}
Issues: ${JSON.stringify(issues.slice(0, 3), null, 2)}

Return JSON array with format:
[{"id":"1","message":"Brief suggestion","actionType":"fill_missing|remove_duplicates|standardize_format","targetColumn":"column_name","priority":"high|medium|low"}]`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        throw new Error("No JSON found in response")
      }

      const geminiRecs = JSON.parse(jsonMatch[0])
      return geminiRecs.map((rec: any, index: number) => ({
        ...rec,
        id: sessionId ? `gemini_${sessionId}_${index + 1}` : `gemini_${index + 1}_${Date.now()}`,
        step: index + 1,
        transformation: this.createTransformation(rec),
        reasoning: "AI-generated recommendation",
      }))
    } catch (error) {
      console.warn("Gemini API call failed:", error)
      throw error
    }
  }

  private createTransformation(rec: any): any {
    switch (rec.actionType) {
      case "fill_missing":
        return {
          type: "fill_missing",
          sheet: "Sheet1", // Default sheet
          column: rec.targetColumn,
          method: "median",
        }
      case "remove_duplicates":
        return {
          type: "remove_duplicates",
          sheet: "Sheet1",
        }
      case "standardize_format":
        return {
          type: "standardize_format",
          sheet: "Sheet1",
          column: rec.targetColumn,
          format: "lowercase",
        }
      default:
        return {
          type: "fix_data_types",
          sheet: "Sheet1",
          column: rec.targetColumn,
        }
    }
  }
}
