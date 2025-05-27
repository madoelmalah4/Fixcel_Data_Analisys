import { GoogleGenerativeAI } from "@google/generative-ai"
import type { DataQualityIssue } from "./excel-processor"

export interface AdvancedRecommendation {
  id: string
  step: number
  message: string
  actionType: string
  targetColumn?: string
  targetSheet?: string
  priority: "critical" | "high" | "medium" | "low"
  transformation: any
  reasoning: string
  impact: string
  confidence: number
  category: "normalization" | "cleaning" | "optimization" | "validation"
  estimatedTime: string
  dataIntegrityRisk: "none" | "low" | "medium" | "high"
}

export class AdvancedGeminiClient {
  private genAI: GoogleGenerativeAI | null = null
  private model: any = null

  constructor() {
    if (process.env.GOOGLE_GEMINI_API_KEY) {
      try {
        this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)
        this.model = this.genAI.getGenerativeModel({
          model: "gemini-1.5-pro",
          generationConfig: {
            temperature: 0.3,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 8192,
          },
        })
      } catch (error) {
        console.warn("Failed to initialize Gemini client:", error)
      }
    }
  }

  async generateAdvancedRecommendations(
    issues: DataQualityIssue[],
    dataSample: any,
    filename: string,
    sessionId?: string,
  ): Promise<AdvancedRecommendation[]> {
    if (!this.model) {
      return this.generateFallbackRecommendations(issues, dataSample, sessionId)
    }

    try {
      const analysisPrompt = this.buildAnalysisPrompt(issues, dataSample, filename)
      const result = await this.model.generateContent(analysisPrompt)
      const response = await result.response
      const text = response.text()

      const recommendations = this.parseAIRecommendations(text, sessionId)

      // Add normalization recommendations
      const normalizationRecs = await this.analyzeForNormalization(dataSample, sessionId)

      // Combine and prioritize all recommendations
      const allRecommendations = [...recommendations, ...normalizationRecs]
      return this.prioritizeRecommendations(allRecommendations)
    } catch (error) {
      console.warn("AI analysis failed, using enhanced fallback:", error)
      return this.generateFallbackRecommendations(issues, dataSample, sessionId)
    }
  }

  private buildAnalysisPrompt(issues: DataQualityIssue[], dataSample: any, filename: string): string {
    const sheets = Object.keys(dataSample.sheets || {})
    const sampleData = this.formatSampleData(dataSample)

    return `You are an expert data analyst and database designer. Analyze this Excel file for comprehensive data cleaning and optimization.

EXCEL FILE: ${filename}
SHEETS: ${sheets.join(", ")}
IDENTIFIED ISSUES: ${JSON.stringify(issues.slice(0, 5), null, 2)}

SAMPLE DATA:
${sampleData}

Provide comprehensive recommendations in this JSON format:
{
  "recommendations": [
    {
      "message": "Clear, actionable description",
      "actionType": "normalize_data|fill_missing|remove_duplicates|standardize_format|fix_data_types|create_lookup_table|split_columns|merge_columns|validate_constraints",
      "targetColumn": "column_name",
      "targetSheet": "sheet_name",
      "priority": "critical|high|medium|low",
      "category": "normalization|cleaning|optimization|validation",
      "transformation": {
        "type": "action_type",
        "details": "specific_implementation"
      },
      "reasoning": "Why this is important",
      "impact": "Expected outcome",
      "confidence": 85,
      "estimatedTime": "2 minutes",
      "dataIntegrityRisk": "low"
    }
  ]
}

FOCUS ON:
1. Database normalization opportunities (1NF, 2NF, 3NF)
2. Identifying entities that should be separate tables
3. Data integrity and consistency
4. Performance optimization
5. Data validation rules
6. Efficient data structures

Be specific and actionable. Prioritize high-impact, low-risk changes first.`
  }

  private async analyzeForNormalization(dataSample: any, sessionId?: string): Promise<AdvancedRecommendation[]> {
    const recommendations: AdvancedRecommendation[] = []

    if (!dataSample.sheets) return recommendations

    for (const [sheetName, sheetData] of Object.entries(dataSample.sheets)) {
      const data = sheetData as any[][]
      if (data.length < 2) continue

      const headers = data[0] as string[]
      const rows = data.slice(1)

      // Analyze for normalization opportunities
      const normalizationOpps = this.findNormalizationOpportunities(headers, rows, sheetName)
      recommendations.push(
        ...normalizationOpps.map((opp, index) => ({
          id: `norm_${sessionId}_${sheetName}_${index}`,
          step: index + 1,
          message: opp.message,
          actionType: opp.actionType,
          targetColumn: opp.targetColumn,
          targetSheet: sheetName,
          priority: opp.priority,
          transformation: opp.transformation,
          reasoning: opp.reasoning,
          impact: opp.impact,
          confidence: opp.confidence,
          category: "normalization" as const,
          estimatedTime: opp.estimatedTime,
          dataIntegrityRisk: opp.dataIntegrityRisk,
        })),
      )
    }

    return recommendations
  }

  private findNormalizationOpportunities(headers: string[], rows: any[][], sheetName: string) {
    const opportunities = []

    // Look for repeating groups (violates 1NF)
    const repeatingGroups = this.findRepeatingGroups(headers, rows)
    if (repeatingGroups.length > 0) {
      opportunities.push({
        message: `Found repeating groups in columns: ${repeatingGroups.join(", ")}. These should be normalized into separate tables to follow First Normal Form (1NF).`,
        actionType: "normalize_data",
        targetColumn: repeatingGroups[0],
        priority: "high" as const,
        transformation: {
          type: "split_repeating_groups",
          columns: repeatingGroups,
          newTableName: `${sheetName}_details`,
        },
        reasoning: "Repeating groups violate 1NF and make data maintenance difficult",
        impact: "Improved data structure, easier maintenance, reduced redundancy",
        confidence: 90,
        estimatedTime: "5 minutes",
        dataIntegrityRisk: "low" as const,
      })
    }

    // Look for partial dependencies (violates 2NF)
    const partialDeps = this.findPartialDependencies(headers, rows)
    if (partialDeps.length > 0) {
      opportunities.push({
        message: `Detected partial dependencies. Columns ${partialDeps.join(", ")} should be moved to separate lookup tables.`,
        actionType: "create_lookup_table",
        targetColumn: partialDeps[0],
        priority: "medium" as const,
        transformation: {
          type: "create_lookup_table",
          columns: partialDeps,
          lookupTableName: `${sheetName}_lookup`,
        },
        reasoning: "Partial dependencies violate 2NF and cause data redundancy",
        impact: "Reduced data redundancy, improved consistency",
        confidence: 80,
        estimatedTime: "3 minutes",
        dataIntegrityRisk: "medium" as const,
      })
    }

    // Look for transitive dependencies (violates 3NF)
    const transitiveDeps = this.findTransitiveDependencies(headers, rows)
    if (transitiveDeps.length > 0) {
      opportunities.push({
        message: `Found transitive dependencies in ${transitiveDeps.join(", ")}. These should be normalized to separate tables.`,
        actionType: "normalize_data",
        targetColumn: transitiveDeps[0],
        priority: "medium" as const,
        transformation: {
          type: "remove_transitive_dependencies",
          columns: transitiveDeps,
          referenceTable: `${sheetName}_reference`,
        },
        reasoning: "Transitive dependencies violate 3NF and can cause update anomalies",
        impact: "Eliminated update anomalies, improved data integrity",
        confidence: 75,
        estimatedTime: "4 minutes",
        dataIntegrityRisk: "low" as const,
      })
    }

    // Look for multi-value attributes
    const multiValueAttrs = this.findMultiValueAttributes(headers, rows)
    if (multiValueAttrs.length > 0) {
      opportunities.push({
        message: `Columns ${multiValueAttrs.join(", ")} contain multiple values. These should be split into separate rows or tables.`,
        actionType: "split_columns",
        targetColumn: multiValueAttrs[0],
        priority: "high" as const,
        transformation: {
          type: "split_multi_value",
          columns: multiValueAttrs,
          delimiter: ",|;|\\|",
        },
        reasoning: "Multi-value attributes violate 1NF and complicate queries",
        impact: "Proper atomic values, easier querying and analysis",
        confidence: 85,
        estimatedTime: "3 minutes",
        dataIntegrityRisk: "low" as const,
      })
    }

    return opportunities
  }

  private findRepeatingGroups(headers: string[], rows: any[][]): string[] {
    const repeatingGroups = []

    // Look for numbered columns (e.g., Phone1, Phone2, Phone3)
    const numberedPattern = /^(.+?)(\d+)$/
    const groupedHeaders = new Map<string, string[]>()

    headers.forEach((header) => {
      const match = header.match(numberedPattern)
      if (match) {
        const baseHeader = match[1]
        if (!groupedHeaders.has(baseHeader)) {
          groupedHeaders.set(baseHeader, [])
        }
        groupedHeaders.get(baseHeader)!.push(header)
      }
    })

    // If we find groups with 2+ columns, they're likely repeating groups
    groupedHeaders.forEach((group, baseHeader) => {
      if (group.length >= 2) {
        repeatingGroups.push(...group)
      }
    })

    return repeatingGroups
  }

  private findPartialDependencies(headers: string[], rows: any[][]): string[] {
    // Look for columns that seem to depend on part of a composite key
    const partialDeps = []

    // Simple heuristic: look for descriptive columns that might be lookup values
    const descriptivePatterns = [
      /name$/i,
      /description$/i,
      /title$/i,
      /category$/i,
      /type$/i,
      /status$/i,
      /department$/i,
      /location$/i,
    ]

    headers.forEach((header) => {
      if (descriptivePatterns.some((pattern) => pattern.test(header))) {
        // Check if this column has repeated values (indicating it might be a lookup)
        const columnIndex = headers.indexOf(header)
        const values = rows.map((row) => row[columnIndex]).filter((v) => v != null)
        const uniqueValues = new Set(values)

        if (values.length > 0 && uniqueValues.size < values.length * 0.7) {
          partialDeps.push(header)
        }
      }
    })

    return partialDeps
  }

  private findTransitiveDependencies(headers: string[], rows: any[][]): string[] {
    // Look for columns that might depend on other non-key columns
    const transitiveDeps = []

    // Simple heuristic: look for calculated or derived fields
    const derivedPatterns = [
      /total$/i,
      /sum$/i,
      /calculated$/i,
      /derived$/i,
      /full_?name$/i,
      /display_?name$/i,
      /computed$/i,
    ]

    headers.forEach((header) => {
      if (derivedPatterns.some((pattern) => pattern.test(header))) {
        transitiveDeps.push(header)
      }
    })

    return transitiveDeps
  }

  private findMultiValueAttributes(headers: string[], rows: any[][]): string[] {
    const multiValueAttrs = []

    headers.forEach((header, index) => {
      // Check if column contains multiple values separated by common delimiters
      const sampleValues = rows
        .slice(0, 10)
        .map((row) => row[index])
        .filter((v) => v != null && v !== "")

      const hasMultipleValues = sampleValues.some((value) => {
        if (typeof value === "string") {
          return /[,;|]/.test(value) && value.split(/[,;|]/).length > 1
        }
        return false
      })

      if (hasMultipleValues) {
        multiValueAttrs.push(header)
      }
    })

    return multiValueAttrs
  }

  private parseAIRecommendations(text: string, sessionId?: string): AdvancedRecommendation[] {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return []

      const parsed = JSON.parse(jsonMatch[0])
      const recommendations = parsed.recommendations || []

      return recommendations.map((rec: any, index: number) => ({
        id: `ai_${sessionId}_${index + 1}`,
        step: index + 1,
        message: rec.message,
        actionType: rec.actionType,
        targetColumn: rec.targetColumn,
        targetSheet: rec.targetSheet,
        priority: rec.priority || "medium",
        transformation: rec.transformation,
        reasoning: rec.reasoning,
        impact: rec.impact,
        confidence: rec.confidence || 75,
        category: rec.category || "cleaning",
        estimatedTime: rec.estimatedTime || "2 minutes",
        dataIntegrityRisk: rec.dataIntegrityRisk || "low",
      }))
    } catch (error) {
      console.warn("Failed to parse AI recommendations:", error)
      return []
    }
  }

  private generateFallbackRecommendations(
    issues: DataQualityIssue[],
    dataSample: any,
    sessionId?: string,
  ): AdvancedRecommendation[] {
    return issues.slice(0, 5).map((issue, index) => ({
      id: `fallback_${sessionId}_${index + 1}`,
      step: index + 1,
      message: this.generateFallbackMessage(issue),
      actionType: this.mapIssueToActionType(issue.type),
      targetColumn: issue.column,
      targetSheet: issue.sheet,
      priority: this.mapSeverityToPriority(issue.severity),
      transformation: this.generateFallbackTransformation(issue),
      reasoning: `Addressing ${issue.type} to improve data quality`,
      impact: `Resolves ${issue.count} data quality issues`,
      confidence: 70,
      category: "cleaning" as const,
      estimatedTime: "2 minutes",
      dataIntegrityRisk: "low" as const,
    }))
  }

  private formatSampleData(dataSample: any): string {
    if (!dataSample.sheets) return "No data available"

    let formatted = ""
    Object.entries(dataSample.sheets).forEach(([sheetName, data]) => {
      const sheetData = data as any[][]
      formatted += `\n${sheetName}:\n`
      formatted += sheetData
        .slice(0, 3)
        .map((row) => row.join(" | "))
        .join("\n")
    })

    return formatted
  }

  private prioritizeRecommendations(recommendations: AdvancedRecommendation[]): AdvancedRecommendation[] {
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 }
    const categoryOrder = { normalization: 4, validation: 3, cleaning: 2, optimization: 1 }

    return recommendations
      .sort((a, b) => {
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority]
        if (priorityDiff !== 0) return priorityDiff

        const categoryDiff = categoryOrder[b.category] - categoryOrder[a.category]
        if (categoryDiff !== 0) return categoryDiff

        return b.confidence - a.confidence
      })
      .slice(0, 8) // Limit to 8 recommendations
  }

  private generateFallbackMessage(issue: DataQualityIssue): string {
    switch (issue.type) {
      case "missing_values":
        return `Found ${issue.count} missing values in '${issue.column}'. Fill these to complete your dataset.`
      case "duplicates":
        return `Detected ${issue.count} duplicate rows. Remove these to ensure data uniqueness.`
      default:
        return `Found ${issue.count} ${issue.type} issues that need attention.`
    }
  }

  private mapIssueToActionType(issueType: string): string {
    const mapping: { [key: string]: string } = {
      missing_values: "fill_missing",
      duplicates: "remove_duplicates",
      whitespace: "trim_whitespace",
      inconsistent_format: "standardize_format",
      data_type_mismatch: "fix_data_types",
    }
    return mapping[issueType] || "fix_data_types"
  }

  private mapSeverityToPriority(severity: string): "critical" | "high" | "medium" | "low" {
    const mapping: { [key: string]: "critical" | "high" | "medium" | "low" } = {
      high: "high",
      medium: "medium",
      low: "low",
    }
    return mapping[severity] || "medium"
  }

  private generateFallbackTransformation(issue: DataQualityIssue): any {
    switch (issue.type) {
      case "missing_values":
        return {
          type: "fill_missing",
          sheet: issue.sheet,
          column: issue.column,
          method: "smart",
        }
      case "duplicates":
        return {
          type: "remove_duplicates",
          sheet: issue.sheet,
        }
      default:
        return {
          type: "fix_data_types",
          sheet: issue.sheet,
          column: issue.column,
        }
    }
  }
}
