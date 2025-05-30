import { GoogleGenerativeAI } from "@google/generative-ai"
import type { DataQualityIssue } from "./excel-processor"
import type { ChunkMetadata } from "./chunked-excel-processor"

export interface ChunkedRecommendation {
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
  affectedChunks: string[]
  canProcessInParallel: boolean
}

export class ChunkedGeminiClient {
  private genAI: GoogleGenerativeAI | null = null
  private model: any = null

  constructor() {
    if (process.env.GOOGLE_GEMINI_API_KEY) {
      try {
        this.genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY)
        this.model = this.genAI.getGenerativeModel({
          model: "gemini-1.5-flash", // Use flash for better performance with chunks
          generationConfig: {
            temperature: 0.2,
            topK: 20,
            topP: 0.8,
            maxOutputTokens: 4096,
          },
        })
      } catch (error) {
        console.warn("Failed to initialize Gemini client:", error)
      }
    }
  }

  async generateChunkedRecommendations(
    aggregatedIssues: DataQualityIssue[],
    chunkSamples: { [chunkId: string]: any[][] },
    chunks: ChunkMetadata[],
    filename: string,
    sessionId?: string,
  ): Promise<ChunkedRecommendation[]> {
    if (!this.model) {
      return this.generateFallbackRecommendations(aggregatedIssues, chunks, sessionId)
    }

    try {
      // Process in smaller batches to avoid token limits
      const batchSize = 3
      const issueBatches = this.createIssueBatches(aggregatedIssues, batchSize)
      const allRecommendations: ChunkedRecommendation[] = []

      for (let i = 0; i < issueBatches.length; i++) {
        const batch = issueBatches[i]
        console.log(`Processing issue batch ${i + 1}/${issueBatches.length}`)

        const batchRecommendations = await this.processBatch(batch, chunkSamples, chunks, filename, sessionId, i)
        allRecommendations.push(...batchRecommendations)

        // Add delay between batches to avoid rate limiting
        if (i < issueBatches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }

      // Add cross-chunk analysis recommendations
      const crossChunkRecs = await this.analyzeCrossChunkOpportunities(chunks, chunkSamples, sessionId)
      allRecommendations.push(...crossChunkRecs)

      return this.prioritizeAndOptimizeRecommendations(allRecommendations)
    } catch (error) {
      console.warn("Chunked AI analysis failed, using enhanced fallback:", error)
      return this.generateFallbackRecommendations(aggregatedIssues, chunks, sessionId)
    }
  }

  private async processBatch(
    issues: DataQualityIssue[],
    chunkSamples: { [chunkId: string]: any[][] },
    chunks: ChunkMetadata[],
    filename: string,
    sessionId?: string,
    batchIndex = 0,
  ): Promise<ChunkedRecommendation[]> {
    const sampleData = this.formatChunkSamples(chunkSamples, 3) // Limit to 3 chunks per sample

    const prompt = `You are analyzing a large Excel file "${filename}" that has been split into ${chunks.length} chunks for processing.

CHUNK INFORMATION:
- Total chunks: ${chunks.length}
- Average rows per chunk: ${Math.round(chunks.reduce((sum, c) => sum + (c.endRow - c.startRow + 1), 0) / chunks.length)}
- Sheets: ${Array.from(new Set(chunks.map((c) => c.sheetName))).join(", ")}

IDENTIFIED ISSUES (Batch ${batchIndex + 1}):
${JSON.stringify(issues, null, 2)}

SAMPLE DATA FROM CHUNKS:
${sampleData}

Generate recommendations that can be efficiently applied to large datasets. Focus on:
1. Operations that can be parallelized across chunks
2. Memory-efficient transformations
3. Database normalization for large datasets
4. Batch processing optimizations

Respond with JSON in this format:
{
  "recommendations": [
    {
      "message": "Clear description of the action",
      "actionType": "fill_missing|remove_duplicates|standardize_format|fix_data_types|normalize_data|split_multi_value|create_lookup_table|batch_process",
      "targetColumn": "column_name",
      "targetSheet": "sheet_name",
      "priority": "critical|high|medium|low",
      "category": "normalization|cleaning|optimization|validation",
      "transformation": {
        "type": "action_type",
        "batchSize": 1000,
        "parallelizable": true,
        "memoryEfficient": true
      },
      "reasoning": "Why this approach works for large data",
      "impact": "Expected outcome",
      "confidence": 85,
      "estimatedTime": "2 minutes per 10k rows",
      "dataIntegrityRisk": "low",
      "canProcessInParallel": true
    }
  ]
}

Limit to 3-5 recommendations per batch to avoid overwhelming the user.`

    try {
      const result = await this.model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error("No valid JSON found in AI response")
      }

      const parsed = JSON.parse(jsonMatch[0])
      const recommendations = parsed.recommendations || []

      return recommendations.map((rec: any, index: number) => ({
        id: `chunked_ai_${sessionId}_${batchIndex}_${index + 1}`,
        step: batchIndex * 5 + index + 1,
        message: rec.message,
        actionType: rec.actionType,
        targetColumn: rec.targetColumn,
        targetSheet: rec.targetSheet,
        priority: rec.priority || "medium",
        transformation: {
          ...rec.transformation,
          batchSize: rec.transformation?.batchSize || 1000,
          parallelizable: rec.transformation?.parallelizable !== false,
          memoryEfficient: rec.transformation?.memoryEfficient !== false,
        },
        reasoning: rec.reasoning,
        impact: rec.impact,
        confidence: rec.confidence || 75,
        category: rec.category || "cleaning",
        estimatedTime: rec.estimatedTime || "2 minutes",
        dataIntegrityRisk: rec.dataIntegrityRisk || "low",
        affectedChunks: this.determineAffectedChunks(rec, chunks),
        canProcessInParallel: rec.canProcessInParallel !== false,
      }))
    } catch (error) {
      console.warn("Batch processing failed:", error)
      return []
    }
  }

  private async analyzeCrossChunkOpportunities(
    chunks: ChunkMetadata[],
    chunkSamples: { [chunkId: string]: any[][] },
    sessionId?: string,
  ): Promise<ChunkedRecommendation[]> {
    const recommendations: ChunkedRecommendation[] = []

    // Analyze for global normalization opportunities
    const sheetGroups = this.groupChunksBySheet(chunks)

    for (const [sheetName, sheetChunks] of Object.entries(sheetGroups)) {
      if (sheetChunks.length > 1) {
        // Recommend global duplicate removal
        recommendations.push({
          id: `cross_chunk_dedup_${sessionId}_${sheetName}`,
          step: 100,
          message: `Remove duplicates across all ${sheetChunks.length} chunks in sheet '${sheetName}'. This requires cross-chunk coordination for accurate deduplication.`,
          actionType: "remove_duplicates_global",
          targetSheet: sheetName,
          priority: "high",
          transformation: {
            type: "remove_duplicates_global",
            sheet: sheetName,
            requiresCrossChunkCoordination: true,
            batchSize: 5000,
            parallelizable: false,
            memoryEfficient: true,
          },
          reasoning: "Global deduplication ensures no duplicates exist across the entire dataset",
          impact: "Eliminates all duplicate records across chunks",
          confidence: 90,
          category: "optimization",
          estimatedTime: "5 minutes",
          dataIntegrityRisk: "low",
          affectedChunks: sheetChunks.map((c) => c.chunkId),
          canProcessInParallel: false,
        })

        // Recommend global normalization
        const headers = sheetChunks[0]?.headers || []
        const potentialLookupColumns = headers.filter(
          (h) =>
            h.toLowerCase().includes("category") ||
            h.toLowerCase().includes("type") ||
            h.toLowerCase().includes("status"),
        )

        if (potentialLookupColumns.length > 0) {
          recommendations.push({
            id: `cross_chunk_normalize_${sessionId}_${sheetName}`,
            step: 101,
            message: `Create lookup tables for columns: ${potentialLookupColumns.join(", ")} across all chunks in '${sheetName}'. This will normalize the data structure for better database performance.`,
            actionType: "create_lookup_table_global",
            targetSheet: sheetName,
            targetColumn: potentialLookupColumns[0],
            priority: "medium",
            transformation: {
              type: "create_lookup_table_global",
              sheet: sheetName,
              columns: potentialLookupColumns,
              requiresCrossChunkCoordination: true,
              batchSize: 2000,
              parallelizable: true,
              memoryEfficient: true,
            },
            reasoning: "Global normalization creates consistent lookup tables across the entire dataset",
            impact: "Reduces data redundancy and improves query performance",
            confidence: 80,
            category: "normalization",
            estimatedTime: "8 minutes",
            dataIntegrityRisk: "medium",
            affectedChunks: sheetChunks.map((c) => c.chunkId),
            canProcessInParallel: true,
          })
        }
      }
    }

    return recommendations
  }

  private createIssueBatches(issues: DataQualityIssue[], batchSize: number): DataQualityIssue[][] {
    const batches: DataQualityIssue[][] = []
    for (let i = 0; i < issues.length; i += batchSize) {
      batches.push(issues.slice(i, i + batchSize))
    }
    return batches
  }

  private formatChunkSamples(chunkSamples: { [chunkId: string]: any[][] }, maxChunks: number): string {
    let formatted = ""
    let chunkCount = 0

    for (const [chunkId, data] of Object.entries(chunkSamples)) {
      if (chunkCount >= maxChunks) break

      formatted += `\nChunk ${chunkId}:\n`
      formatted += data
        .slice(0, 4) // Headers + 3 data rows
        .map((row) => row.slice(0, 8).join(" | ")) // First 8 columns
        .join("\n")

      chunkCount++
    }

    return formatted
  }

  private determineAffectedChunks(recommendation: any, chunks: ChunkMetadata[]): string[] {
    if (recommendation.targetSheet) {
      return chunks.filter((chunk) => chunk.sheetName === recommendation.targetSheet).map((chunk) => chunk.chunkId)
    }

    if (recommendation.targetColumn) {
      return chunks.filter((chunk) => chunk.headers.includes(recommendation.targetColumn)).map((chunk) => chunk.chunkId)
    }

    // Default to all chunks
    return chunks.map((chunk) => chunk.chunkId)
  }

  private groupChunksBySheet(chunks: ChunkMetadata[]): { [sheetName: string]: ChunkMetadata[] } {
    const groups: { [sheetName: string]: ChunkMetadata[] } = {}

    chunks.forEach((chunk) => {
      if (!groups[chunk.sheetName]) {
        groups[chunk.sheetName] = []
      }
      groups[chunk.sheetName].push(chunk)
    })

    return groups
  }

  private prioritizeAndOptimizeRecommendations(recommendations: ChunkedRecommendation[]): ChunkedRecommendation[] {
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 }
    const categoryOrder = { normalization: 4, validation: 3, cleaning: 2, optimization: 1 }

    return recommendations
      .sort((a, b) => {
        // Prioritize parallelizable operations
        if (a.canProcessInParallel && !b.canProcessInParallel) return -1
        if (!a.canProcessInParallel && b.canProcessInParallel) return 1

        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority]
        if (priorityDiff !== 0) return priorityDiff

        const categoryDiff = categoryOrder[b.category] - categoryOrder[a.category]
        if (categoryDiff !== 0) return categoryDiff

        return b.confidence - a.confidence
      })
      .slice(0, 12) // Limit to 12 recommendations for large files
  }

  private generateFallbackRecommendations(
    issues: DataQualityIssue[],
    chunks: ChunkMetadata[],
    sessionId?: string,
  ): ChunkedRecommendation[] {
    return issues.slice(0, 8).map((issue, index) => ({
      id: `chunked_fallback_${sessionId}_${index + 1}`,
      step: index + 1,
      message: this.generateFallbackMessage(issue, chunks.length),
      actionType: this.mapIssueToActionType(issue.type),
      targetColumn: issue.column,
      targetSheet: issue.sheet,
      priority: this.mapSeverityToPriority(issue.severity),
      transformation: {
        ...this.generateFallbackTransformation(issue),
        batchSize: 1000,
        parallelizable: true,
        memoryEfficient: true,
      },
      reasoning: `Addressing ${issue.type} across ${chunks.length} chunks to improve data quality`,
      impact: `Resolves ${issue.count} data quality issues across chunks`,
      confidence: 70,
      category: "cleaning" as const,
      estimatedTime: "3 minutes",
      dataIntegrityRisk: "low" as const,
      affectedChunks: chunks.filter((chunk) => chunk.sheetName === issue.sheet).map((chunk) => chunk.chunkId),
      canProcessInParallel: true,
    }))
  }

  private generateFallbackMessage(issue: DataQualityIssue, chunkCount: number): string {
    switch (issue.type) {
      case "missing_values":
        return `Found ${issue.count} missing values in '${issue.column}' across ${chunkCount} chunks. Fill these to complete your dataset.`
      case "duplicates":
        return `Found ${issue.count} duplicate rows across ${chunkCount} chunks. Remove these to ensure data uniqueness.`
      default:
        return `Found ${issue.count} ${issue.type} issues across ${chunkCount} chunks that need attention.`
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
