import { GoogleGenerativeAI } from "@google/generative-ai"
import type { ExcelData } from "./excel-processor"

export interface UserRequestRecommendation {
  id: string
  userRequest: string
  aiResponse: string
  actionType: string
  targetColumn?: string
  targetSheet?: string
  reasoning: string
  transformation: any
  confidence: number
}

export class UserRequestProcessor {
  private genAI: GoogleGenerativeAI | null = null
  private model: any = null

  constructor() {
    if (process.env.GOOGLE_GEMINI_API_KEY) {
      try {
        this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)
        this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
      } catch (error) {
        console.warn("Failed to initialize Gemini client:", error)
        this.genAI = null
        this.model = null
      }
    } else {
      console.warn("GOOGLE_GEMINI_API_KEY not found")
    }
  }

  async processUserRequest(
    userRequest: string,
    excelData: ExcelData,
    sessionId: string,
  ): Promise<UserRequestRecommendation> {
    // Try AI processing first
    if (this.model) {
      try {
        return await this.processWithAI(userRequest, excelData, sessionId)
      } catch (error) {
        console.warn("AI processing failed, using rule-based fallback:", error)
      }
    }

    // Fallback to rule-based processing
    return this.processWithRules(userRequest, excelData, sessionId)
  }

  private async processWithAI(
    userRequest: string,
    excelData: ExcelData,
    sessionId: string,
  ): Promise<UserRequestRecommendation> {
    const sheets = Object.keys(excelData.sheets)
    const sampleData = this.getSampleData(excelData)

    const prompt = `
You are an Excel data cleaning expert. A user wants to clean their Excel file and has made this request:

USER REQUEST: "${userRequest}"

EXCEL FILE INFO:
- Sheets: ${sheets.join(", ")}
- Total rows: ${excelData.metadata.totalRows}
- Sample data from first sheet:
${JSON.stringify(sampleData, null, 2)}

Please provide a specific recommendation for how to fulfill the user's request. Respond with a JSON object in this exact format:

{
  "aiResponse": "Clear explanation of what you'll do and why",
  "actionType": "fill_missing|remove_duplicates|standardize_format|fix_data_types|trim_whitespace|remove_rows|custom",
  "targetColumn": "column_name_if_applicable",
  "targetSheet": "sheet_name",
  "reasoning": "Technical explanation of why this approach is best",
  "transformation": {
    "type": "action_type",
    "sheet": "sheet_name",
    "column": "column_name_if_applicable",
    "method": "specific_method",
    "criteria": "any_specific_criteria"
  },
  "confidence": 85
}

Focus on being specific and actionable. If the request is unclear, ask for clarification in the aiResponse.
`

    const result = await this.model.generateContent(prompt)
    const response = await result.response
    const text = response.text()

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No valid JSON found in AI response")
    }

    const aiRecommendation = JSON.parse(jsonMatch[0])

    return {
      id: `user_req_${sessionId}_${Date.now()}`,
      userRequest,
      aiResponse: aiRecommendation.aiResponse,
      actionType: aiRecommendation.actionType,
      targetColumn: aiRecommendation.targetColumn,
      targetSheet: aiRecommendation.targetSheet || sheets[0],
      reasoning: aiRecommendation.reasoning,
      transformation: aiRecommendation.transformation,
      confidence: aiRecommendation.confidence || 75,
    }
  }

  private processWithRules(userRequest: string, excelData: ExcelData, sessionId: string): UserRequestRecommendation {
    const request = userRequest.toLowerCase()
    const sheets = Object.keys(excelData.sheets)
    const firstSheet = sheets[0]

    // Rule-based processing for common requests
    if (request.includes("remove") && (request.includes("empty") || request.includes("blank"))) {
      return {
        id: `user_req_${sessionId}_${Date.now()}`,
        userRequest,
        aiResponse:
          "I'll remove all empty rows from your spreadsheet. This will clean up your data by eliminating rows that don't contain any meaningful information.",
        actionType: "remove_rows",
        targetSheet: firstSheet,
        reasoning: "Empty rows can interfere with data analysis and make spreadsheets harder to work with.",
        transformation: {
          type: "remove_rows",
          sheet: firstSheet,
          criteria: "empty",
        },
        confidence: 90,
      }
    }

    if (request.includes("duplicate")) {
      return {
        id: `user_req_${sessionId}_${Date.now()}`,
        userRequest,
        aiResponse:
          "I'll identify and remove duplicate rows from your data. This ensures each record appears only once, improving data quality and accuracy.",
        actionType: "remove_duplicates",
        targetSheet: firstSheet,
        reasoning: "Duplicate records can skew analysis results and waste storage space.",
        transformation: {
          type: "remove_duplicates",
          sheet: firstSheet,
        },
        confidence: 95,
      }
    }

    if (request.includes("phone") || request.includes("number")) {
      return {
        id: `user_req_${sessionId}_${Date.now()}`,
        userRequest,
        aiResponse:
          "I'll standardize phone number formats in your data. This typically involves formatting them consistently (e.g., (555) 123-4567) and removing invalid entries.",
        actionType: "standardize_format",
        targetColumn: this.findPhoneColumn(excelData),
        targetSheet: firstSheet,
        reasoning: "Consistent phone number formatting improves data quality and enables better matching.",
        transformation: {
          type: "standardize_format",
          sheet: firstSheet,
          column: this.findPhoneColumn(excelData),
          format: "phone",
        },
        confidence: 80,
      }
    }

    if (request.includes("email")) {
      return {
        id: `user_req_${sessionId}_${Date.now()}`,
        userRequest,
        aiResponse:
          "I'll clean and standardize email addresses in your data. This includes converting to lowercase, removing extra spaces, and validating email format.",
        actionType: "standardize_format",
        targetColumn: this.findEmailColumn(excelData),
        targetSheet: firstSheet,
        reasoning: "Standardized email formats improve deliverability and prevent duplicate contacts.",
        transformation: {
          type: "standardize_format",
          sheet: firstSheet,
          column: this.findEmailColumn(excelData),
          format: "email",
        },
        confidence: 85,
      }
    }

    if (request.includes("missing") || request.includes("fill") || request.includes("empty")) {
      return {
        id: `user_req_${sessionId}_${Date.now()}`,
        userRequest,
        aiResponse:
          "I'll identify missing values in your data and fill them using appropriate methods (like averages for numbers or most common values for text).",
        actionType: "fill_missing",
        targetSheet: firstSheet,
        reasoning: "Filling missing values improves data completeness and enables better analysis.",
        transformation: {
          type: "fill_missing",
          sheet: firstSheet,
          method: "smart",
        },
        confidence: 75,
      }
    }

    // Generic fallback
    return {
      id: `user_req_${sessionId}_${Date.now()}`,
      userRequest,
      aiResponse: `I understand you want to "${userRequest}". I'll analyze your data and apply the most appropriate cleaning method. This might involve standardizing formats, removing inconsistencies, or filling missing values.`,
      actionType: "custom",
      targetSheet: firstSheet,
      reasoning: "Custom data cleaning based on user requirements.",
      transformation: {
        type: "custom",
        sheet: firstSheet,
        userRequest: userRequest,
      },
      confidence: 60,
    }
  }

  private getSampleData(excelData: ExcelData): any {
    const firstSheet = Object.keys(excelData.sheets)[0]
    const sheetData = excelData.sheets[firstSheet]
    return sheetData.slice(0, 5) // First 5 rows including headers
  }

  private findPhoneColumn(excelData: ExcelData): string {
    const firstSheet = Object.keys(excelData.sheets)[0]
    const headers = excelData.sheets[firstSheet][0] as string[]

    const phoneKeywords = ["phone", "tel", "mobile", "cell", "number"]
    const phoneColumn = headers.find((header) =>
      phoneKeywords.some((keyword) => header.toLowerCase().includes(keyword)),
    )

    return phoneColumn || headers[0] || "Phone"
  }

  private findEmailColumn(excelData: ExcelData): string {
    const firstSheet = Object.keys(excelData.sheets)[0]
    const headers = excelData.sheets[firstSheet][0] as string[]

    const emailColumn = headers.find(
      (header) => header.toLowerCase().includes("email") || header.toLowerCase().includes("mail"),
    )

    return emailColumn || headers[0] || "Email"
  }
}
