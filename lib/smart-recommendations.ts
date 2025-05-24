import type { DataQualityIssue } from "./excel-processor"

export interface SmartRecommendation {
  id: string
  step: number
  message: string
  actionType: string
  targetColumn?: string
  targetSheet?: string
  priority: "high" | "medium" | "low"
  transformation: any
  reasoning: string
  impact: string
  confidence: number
}

export class SmartRecommendationEngine {
  generateRecommendations(
    issues: DataQualityIssue[],
    dataSample: any,
    filename: string,
    sessionId?: string,
  ): SmartRecommendation[] {
    const recommendations: SmartRecommendation[] = []
    let stepCounter = 1

    // Sort issues by priority and impact
    const sortedIssues = this.prioritizeIssues(issues, dataSample)

    for (const issue of sortedIssues.slice(0, 8)) {
      // Limit to 8 recommendations
      const recommendation = this.createRecommendation(issue, stepCounter, dataSample, filename, sessionId)
      if (recommendation) {
        recommendations.push(recommendation)
        stepCounter++
      }
    }

    return recommendations
  }

  private prioritizeIssues(issues: DataQualityIssue[], dataSample: any): DataQualityIssue[] {
    return issues.sort((a, b) => {
      // Priority scoring
      const severityScore = { high: 100, medium: 50, low: 25 }
      const typeScore = {
        duplicates: 90,
        missing_values: 80,
        data_type_mismatch: 70,
        inconsistent_format: 60,
        whitespace: 40,
        outliers: 30,
      }

      const scoreA = severityScore[a.severity] + typeScore[a.type] + (a.count || 0) * 0.1
      const scoreB = severityScore[b.severity] + typeScore[b.type] + (b.count || 0) * 0.1

      return scoreB - scoreA
    })
  }

  private createRecommendation(
    issue: DataQualityIssue,
    step: number,
    dataSample: any,
    filename: string,
    sessionId?: string,
  ): SmartRecommendation | null {
    // Use session-specific ID format for better tracking
    const baseId = sessionId ? `smart_${sessionId}_${step}` : `smart_${step}_${Date.now()}`

    switch (issue.type) {
      case "missing_values":
        return this.createMissingValuesRecommendation(issue, step, baseId, dataSample)

      case "duplicates":
        return this.createDuplicatesRecommendation(issue, step, baseId, dataSample)

      case "whitespace":
        return this.createWhitespaceRecommendation(issue, step, baseId)

      case "inconsistent_format":
        return this.createFormatRecommendation(issue, step, baseId, dataSample)

      case "data_type_mismatch":
        return this.createDataTypeRecommendation(issue, step, baseId, dataSample)

      default:
        return null
    }
  }

  private createMissingValuesRecommendation(
    issue: DataQualityIssue,
    step: number,
    id: string,
    dataSample: any,
  ): SmartRecommendation {
    const percentage = this.calculateMissingPercentage(issue, dataSample)
    const suggestedMethod = this.suggestFillMethod(issue, dataSample)

    let message = `I found ${issue.count} missing values in column '${issue.column}' (${percentage}% of data). `

    if (percentage > 50) {
      message += `Since more than half the data is missing, consider if this column is necessary for your analysis. `
    }

    message += `I recommend filling these with ${this.getMethodDescription(suggestedMethod)} to maintain data integrity.`

    return {
      id,
      step,
      message,
      actionType: "fill_missing",
      targetColumn: issue.column,
      targetSheet: issue.sheet,
      priority: percentage > 30 ? "high" : percentage > 10 ? "medium" : "low",
      transformation: {
        type: "fill_missing",
        sheet: issue.sheet,
        column: issue.column,
        method: suggestedMethod,
      },
      reasoning: `Missing data can skew analysis results. ${this.getMethodReasoning(suggestedMethod)}`,
      impact: `Filling missing values will improve data completeness by ${percentage}%`,
      confidence: this.calculateConfidence(issue, dataSample),
    }
  }

  private createDuplicatesRecommendation(
    issue: DataQualityIssue,
    step: number,
    id: string,
    dataSample: any,
  ): SmartRecommendation {
    const totalRows = this.estimateTotalRows(issue, dataSample)
    const percentage = totalRows > 0 ? Math.round((issue.count / totalRows) * 100) : 0

    const message = `I detected ${issue.count} duplicate rows in sheet '${issue.sheet}' (${percentage}% of your data). Removing these duplicates will ensure accurate analysis and prevent double-counting in reports and calculations.`

    return {
      id,
      step,
      message,
      actionType: "remove_duplicates",
      targetSheet: issue.sheet,
      priority: percentage > 10 ? "high" : "medium",
      transformation: {
        type: "remove_duplicates",
        sheet: issue.sheet,
      },
      reasoning: "Duplicate rows can lead to inflated statistics and incorrect analysis results.",
      impact: `Removing duplicates will reduce dataset size by ${percentage}% and improve data accuracy`,
      confidence: 95,
    }
  }

  private createWhitespaceRecommendation(issue: DataQualityIssue, step: number, id: string): SmartRecommendation {
    const message = `Column '${issue.column}' has ${issue.count} cells with whitespace issues (extra spaces, leading/trailing spaces). Cleaning these will improve data consistency and enable better text matching and analysis.`

    return {
      id,
      step,
      message,
      actionType: "trim_whitespace",
      targetColumn: issue.column,
      targetSheet: issue.sheet,
      priority: "low",
      transformation: {
        type: "trim_whitespace",
        sheet: issue.sheet,
        column: issue.column,
      },
      reasoning: "Whitespace issues can cause problems with data matching, sorting, and analysis.",
      impact: "Improved text consistency and better data matching capabilities",
      confidence: 90,
    }
  }

  private createFormatRecommendation(
    issue: DataQualityIssue,
    step: number,
    id: string,
    dataSample: any,
  ): SmartRecommendation {
    const suggestedFormat = this.suggestFormat(issue, dataSample)
    const formatDescription = this.getFormatDescription(suggestedFormat)

    let message = `Column '${issue.column}' has ${issue.count} formatting inconsistencies. `

    if (issue.column?.toLowerCase().includes("email")) {
      message += `I recommend standardizing email addresses to lowercase format for better consistency and matching.`
    } else if (issue.column?.toLowerCase().includes("name")) {
      message += `I recommend using title case format for names to improve readability and consistency.`
    } else {
      message += `I recommend standardizing to ${formatDescription} for better consistency.`
    }

    return {
      id,
      step,
      message,
      actionType: "standardize_format",
      targetColumn: issue.column,
      targetSheet: issue.sheet,
      priority: "medium",
      transformation: {
        type: "standardize_format",
        sheet: issue.sheet,
        column: issue.column,
        format: suggestedFormat,
      },
      reasoning: "Consistent formatting improves data quality and enables better analysis and reporting.",
      impact: "Standardized formatting across all values in the column",
      confidence: 85,
    }
  }

  private createDataTypeRecommendation(
    issue: DataQualityIssue,
    step: number,
    id: string,
    dataSample: any,
  ): SmartRecommendation {
    const suggestedType = this.suggestDataType(issue, dataSample)
    const typeDescription = this.getTypeDescription(suggestedType)

    const message = `Column '${issue.column}' contains mixed data types. I recommend converting all values to ${typeDescription} for consistent analysis and to prevent calculation errors.`

    return {
      id,
      step,
      message,
      actionType: "fix_data_types",
      targetColumn: issue.column,
      targetSheet: issue.sheet,
      priority: "medium",
      transformation: {
        type: "fix_data_types",
        sheet: issue.sheet,
        column: issue.column,
        targetType: suggestedType,
      },
      reasoning: "Mixed data types can cause errors in calculations and prevent proper sorting and filtering.",
      impact: "Consistent data types enable proper mathematical operations and analysis",
      confidence: 80,
    }
  }

  // Helper methods (keeping all the existing helper methods)
  private calculateMissingPercentage(issue: DataQualityIssue, dataSample: any): number {
    const totalRows = this.estimateTotalRows(issue, dataSample)
    return totalRows > 0 ? Math.round((issue.count / totalRows) * 100) : 0
  }

  private estimateTotalRows(issue: DataQualityIssue, dataSample: any): number {
    if (!dataSample?.sheets?.[issue.sheet!]) return 0
    return Math.max(dataSample.sheets[issue.sheet!].length - 1, 0) // Subtract header row
  }

  private suggestFillMethod(issue: DataQualityIssue, dataSample: any): string {
    if (!issue.examples || issue.examples.length === 0) return "mode"

    // Check if numeric
    const numericValues = issue.examples.filter((val) => !isNaN(Number(val)))
    if (numericValues.length > issue.examples.length * 0.7) {
      return "median" // Median is more robust for numeric data
    }

    // Check if dates
    const dateValues = issue.examples.filter((val) => !isNaN(Date.parse(val)))
    if (dateValues.length > issue.examples.length * 0.7) {
      return "mode" // Most common date
    }

    // Default to mode for categorical data
    return "mode"
  }

  private getMethodDescription(method: string): string {
    switch (method) {
      case "median":
        return "the median value (middle value when sorted)"
      case "mean":
        return "the average value"
      case "mode":
        return "the most frequently occurring value"
      default:
        return "appropriate default values"
    }
  }

  private getMethodReasoning(method: string): string {
    switch (method) {
      case "median":
        return "Median is robust against outliers and provides a representative central value."
      case "mean":
        return "Mean provides the mathematical average of all values."
      case "mode":
        return "Mode preserves the most common pattern in your data."
      default:
        return "This method maintains data consistency."
    }
  }

  private suggestFormat(issue: DataQualityIssue, dataSample: any): string {
    const columnName = issue.column?.toLowerCase() || ""

    if (columnName.includes("email")) return "lowercase"
    if (columnName.includes("name") || columnName.includes("title")) return "title_case"
    if (columnName.includes("code") || columnName.includes("id")) return "uppercase"

    return "lowercase" // Default
  }

  private getFormatDescription(format: string): string {
    switch (format) {
      case "lowercase":
        return "lowercase format"
      case "uppercase":
        return "uppercase format"
      case "title_case":
        return "title case format (First Letter Capitalized)"
      default:
        return "standardized format"
    }
  }

  private suggestDataType(issue: DataQualityIssue, dataSample: any): string {
    if (!issue.examples || issue.examples.length === 0) return "string"

    // Check if mostly numeric
    const numericCount = issue.examples.filter((val) => !isNaN(Number(val))).length
    if (numericCount > issue.examples.length * 0.7) return "number"

    // Check if mostly dates
    const dateCount = issue.examples.filter((val) => !isNaN(Date.parse(val))).length
    if (dateCount > issue.examples.length * 0.7) return "date"

    return "string" // Default to string
  }

  private getTypeDescription(type: string): string {
    switch (type) {
      case "number":
        return "numeric format for calculations"
      case "date":
        return "date format for time-based analysis"
      case "string":
        return "text format for consistency"
      default:
        return "appropriate data type"
    }
  }

  private calculateConfidence(issue: DataQualityIssue, dataSample: any): number {
    // Base confidence on data quality and sample size
    let confidence = 70

    if (issue.examples && issue.examples.length > 3) confidence += 10
    if (issue.severity === "high") confidence += 15
    if (issue.severity === "medium") confidence += 10
    if (issue.count > 10) confidence += 5

    return Math.min(confidence, 95)
  }
}
