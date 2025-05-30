import * as XLSX from "xlsx"
import { FileStorage } from "./file-storage"
import type { ExcelData, DataQualityIssue } from "./excel-processor"

export interface ChunkMetadata {
  chunkId: string
  startRow: number
  endRow: number
  totalRows: number
  sheetName: string
  headers: string[]
  processed: boolean
}

export interface ProcessingProgress {
  totalChunks: number
  processedChunks: number
  currentChunk: string
  percentage: number
  estimatedTimeRemaining: string
}

export class ChunkedExcelProcessor {
  private workbook: XLSX.WorkBook | null = null
  private sessionId: string
  private chunkSize: number
  private chunks: Map<string, ChunkMetadata> = new Map()
  private processedData: Map<string, any[][]> = new Map()
  private transformationLog: any[] = []

  constructor(
    private fileBuffer: Buffer,
    sessionId: string,
    chunkSize = 1000, // Process 1000 rows at a time
  ) {
    this.sessionId = sessionId
    this.chunkSize = chunkSize
  }

  static async fromStorage(sessionId: string, fileName: string, chunkSize = 1000): Promise<ChunkedExcelProcessor> {
    try {
      const buffer = await FileStorage.getFile(sessionId, fileName)
      return new ChunkedExcelProcessor(buffer, sessionId, chunkSize)
    } catch (error) {
      console.error("Failed to load file from storage:", error)
      // Create fallback
      const fallbackWorkbook = XLSX.utils.book_new()
      const fallbackSheet = XLSX.utils.aoa_to_sheet([
        ["Error", "Message"],
        ["File Not Found", `Original file ${fileName} could not be retrieved`],
      ])
      XLSX.utils.book_append_sheet(fallbackWorkbook, fallbackSheet, "Error")
      const fallbackBuffer = Buffer.from(XLSX.write(fallbackWorkbook, { type: "buffer", bookType: "xlsx" }))
      return new ChunkedExcelProcessor(fallbackBuffer, sessionId, chunkSize)
    }
  }

  async parseExcelInChunks(): Promise<{ metadata: ExcelData["metadata"]; chunks: ChunkMetadata[] }> {
    try {
      this.workbook = XLSX.read(this.fileBuffer, { type: "buffer" })

      const chunks: ChunkMetadata[] = []
      let totalRows = 0
      let totalColumns = 0

      for (const sheetName of this.workbook.SheetNames) {
        const worksheet = this.workbook.Sheets[sheetName]
        const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1")
        const sheetRows = range.e.r + 1
        const sheetCols = range.e.c + 1

        totalRows += sheetRows
        totalColumns = Math.max(totalColumns, sheetCols)

        // Get headers (first row)
        const headers: string[] = []
        for (let col = 0; col <= range.e.c; col++) {
          const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col })
          const cell = worksheet[cellAddress]
          headers.push(cell ? String(cell.v) : `Column_${col + 1}`)
        }

        // Create chunks for this sheet
        const dataRows = sheetRows - 1 // Exclude header
        const numChunks = Math.ceil(dataRows / this.chunkSize)

        for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
          const startRow = 1 + chunkIndex * this.chunkSize // Skip header
          const endRow = Math.min(startRow + this.chunkSize - 1, sheetRows - 1)

          const chunkId = `${this.sessionId}_${sheetName}_chunk_${chunkIndex}`

          const chunkMetadata: ChunkMetadata = {
            chunkId,
            startRow,
            endRow,
            totalRows: dataRows,
            sheetName,
            headers,
            processed: false,
          }

          chunks.push(chunkMetadata)
          this.chunks.set(chunkId, chunkMetadata)
        }
      }

      const metadata = {
        totalRows,
        totalColumns,
        sheetNames: this.workbook.SheetNames,
        fileSize: this.fileBuffer.length,
      }

      console.log(`Created ${chunks.length} chunks for processing`)
      return { metadata, chunks }
    } catch (error) {
      throw new Error(`Failed to parse Excel file: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  async processChunk(chunkId: string): Promise<any[][]> {
    const chunkMetadata = this.chunks.get(chunkId)
    if (!chunkMetadata || !this.workbook) {
      throw new Error(`Chunk ${chunkId} not found or workbook not loaded`)
    }

    const worksheet = this.workbook.Sheets[chunkMetadata.sheetName]
    const chunkData: any[][] = []

    // Add headers as first row
    chunkData.push(chunkMetadata.headers)

    // Extract chunk data
    for (let row = chunkMetadata.startRow; row <= chunkMetadata.endRow; row++) {
      const rowData: any[] = []
      for (let col = 0; col < chunkMetadata.headers.length; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col })
        const cell = worksheet[cellAddress]
        rowData.push(cell ? cell.v : null)
      }
      chunkData.push(rowData)
    }

    // Store processed chunk
    this.processedData.set(chunkId, chunkData)
    chunkMetadata.processed = true

    console.log(`Processed chunk ${chunkId}: rows ${chunkMetadata.startRow}-${chunkMetadata.endRow}`)
    return chunkData
  }

  async analyzeChunkQuality(chunkId: string): Promise<DataQualityIssue[]> {
    const chunkData = this.processedData.get(chunkId)
    if (!chunkData || chunkData.length < 2) {
      return []
    }

    const chunkMetadata = this.chunks.get(chunkId)!
    const headers = chunkData[0] as string[]
    const dataRows = chunkData.slice(1)
    const issues: DataQualityIssue[] = []

    // Analyze each column in the chunk
    for (let colIndex = 0; colIndex < headers.length; colIndex++) {
      const columnName = headers[colIndex] || `Column_${colIndex + 1}`
      const columnData = dataRows.map((row) => row[colIndex])

      // Check for missing values
      const missingCount = columnData.filter(
        (cell) =>
          cell === null || cell === undefined || cell === "" || (typeof cell === "string" && cell.trim() === ""),
      ).length

      if (missingCount > 0) {
        issues.push({
          type: "missing_values",
          severity:
            missingCount > dataRows.length * 0.3 ? "high" : missingCount > dataRows.length * 0.1 ? "medium" : "low",
          column: columnName,
          sheet: chunkMetadata.sheetName,
          count: missingCount,
          description: `${missingCount} missing values found in column '${columnName}' (chunk ${chunkId})`,
          examples: columnData
            .filter((cell) => cell !== null && cell !== undefined && cell !== "")
            .slice(0, 3)
            .map(String),
        })
      }

      // Check for data type inconsistencies
      const nonEmptyData = columnData.filter((cell) => cell !== null && cell !== undefined && cell !== "")
      if (nonEmptyData.length > 0) {
        const types = new Set(nonEmptyData.map((cell) => typeof cell))
        if (types.size > 1) {
          issues.push({
            type: "data_type_mismatch",
            severity: "medium",
            column: columnName,
            sheet: chunkMetadata.sheetName,
            count: nonEmptyData.length,
            description: `Mixed data types found in column '${columnName}' (chunk ${chunkId}): ${Array.from(types).join(", ")}`,
            examples: nonEmptyData.slice(0, 3).map(String),
          })
        }
      }

      // Check for whitespace issues
      const stringData = columnData.filter((cell) => typeof cell === "string" && cell.length > 0)
      const whitespaceIssues = stringData.filter((cell) => cell !== cell.trim() || cell.includes("  "))

      if (whitespaceIssues.length > 0) {
        issues.push({
          type: "whitespace",
          severity: "low",
          column: columnName,
          sheet: chunkMetadata.sheetName,
          count: whitespaceIssues.length,
          description: `${whitespaceIssues.length} cells with whitespace issues in column '${columnName}' (chunk ${chunkId})`,
          examples: whitespaceIssues.slice(0, 3),
        })
      }

      // Check for multi-value attributes
      const multiValueCount = columnData.filter(
        (cell) => typeof cell === "string" && /[,;|]/.test(cell) && cell.split(/[,;|]/).length > 1,
      ).length

      if (multiValueCount > 0) {
        issues.push({
          type: "inconsistent_format",
          severity: "medium",
          column: columnName,
          sheet: chunkMetadata.sheetName,
          count: multiValueCount,
          description: `${multiValueCount} cells contain multiple values in '${columnName}' (chunk ${chunkId}) - should be normalized`,
          examples: columnData
            .filter((cell) => typeof cell === "string" && /[,;|]/.test(cell))
            .slice(0, 3)
            .map(String),
        })
      }
    }

    // Check for duplicate rows within chunk
    const rowStrings = dataRows.map((row) => JSON.stringify(row))
    const uniqueRows = new Set(rowStrings)
    const duplicateCount = rowStrings.length - uniqueRows.size

    if (duplicateCount > 0) {
      issues.push({
        type: "duplicates",
        severity: duplicateCount > dataRows.length * 0.1 ? "high" : "medium",
        sheet: chunkMetadata.sheetName,
        count: duplicateCount,
        description: `${duplicateCount} duplicate rows found in chunk ${chunkId}`,
      })
    }

    return issues
  }

  async applyTransformationToChunk(chunkId: string, transformation: any): Promise<void> {
    const chunkData = this.processedData.get(chunkId)
    if (!chunkData || chunkData.length < 2) {
      return
    }

    const chunkMetadata = this.chunks.get(chunkId)!
    console.log(`Applying transformation ${transformation.type} to chunk ${chunkId}`)

    switch (transformation.type) {
      case "fill_missing":
        await this.fillMissingValuesInChunk(chunkId, transformation)
        break
      case "remove_duplicates":
        await this.removeDuplicatesInChunk(chunkId, transformation)
        break
      case "standardize_format":
        await this.standardizeFormatInChunk(chunkId, transformation)
        break
      case "fix_data_types":
        await this.fixDataTypesInChunk(chunkId, transformation)
        break
      case "trim_whitespace":
        await this.trimWhitespaceInChunk(chunkId, transformation)
        break
      case "normalize_data":
        await this.normalizeDataInChunk(chunkId, transformation)
        break
      case "split_multi_value":
        await this.splitMultiValueInChunk(chunkId, transformation)
        break
    }

    // Log the transformation
    this.transformationLog.push({
      timestamp: new Date().toISOString(),
      chunkId,
      transformation,
      status: "completed",
    })
  }

  private async fillMissingValuesInChunk(chunkId: string, transformation: any): Promise<void> {
    const chunkData = this.processedData.get(chunkId)!
    const headers = chunkData[0] as string[]
    const columnIndex = headers.indexOf(transformation.column)

    if (columnIndex === -1) return

    const dataRows = chunkData.slice(1)
    const columnData = dataRows
      .map((row) => row[columnIndex])
      .filter((cell) => cell !== null && cell !== undefined && cell !== "")

    let fillValue = transformation.value
    if (transformation.method === "median" && columnData.length > 0) {
      const numbers = columnData
        .filter((cell) => !isNaN(Number(cell)))
        .map(Number)
        .sort((a, b) => a - b)
      fillValue = numbers.length > 0 ? numbers[Math.floor(numbers.length / 2)] : 0
    } else if (transformation.method === "mean" && columnData.length > 0) {
      const numbers = columnData.filter((cell) => !isNaN(Number(cell))).map(Number)
      fillValue = numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0
    } else if (transformation.method === "mode" && columnData.length > 0) {
      const frequency: { [key: string]: number } = {}
      columnData.forEach((cell) => {
        const key = String(cell)
        frequency[key] = (frequency[key] || 0) + 1
      })
      fillValue = Object.keys(frequency).reduce((a, b) => (frequency[a] > frequency[b] ? a : b))
    }

    // Apply the fill
    for (let i = 1; i < chunkData.length; i++) {
      if (
        chunkData[i][columnIndex] === null ||
        chunkData[i][columnIndex] === undefined ||
        chunkData[i][columnIndex] === ""
      ) {
        chunkData[i][columnIndex] = fillValue
      }
    }
  }

  private async removeDuplicatesInChunk(chunkId: string, transformation: any): Promise<void> {
    const chunkData = this.processedData.get(chunkId)!
    const headers = chunkData[0]
    const dataRows = chunkData.slice(1)

    const seen = new Set()
    const uniqueRows = dataRows.filter((row) => {
      const rowString = JSON.stringify(row)
      if (seen.has(rowString)) {
        return false
      }
      seen.add(rowString)
      return true
    })

    this.processedData.set(chunkId, [headers, ...uniqueRows])
  }

  private async standardizeFormatInChunk(chunkId: string, transformation: any): Promise<void> {
    const chunkData = this.processedData.get(chunkId)!
    const headers = chunkData[0] as string[]
    const columnIndex = headers.indexOf(transformation.column)

    if (columnIndex === -1) return

    for (let i = 1; i < chunkData.length; i++) {
      const cell = chunkData[i][columnIndex]
      if (typeof cell === "string") {
        switch (transformation.format) {
          case "lowercase":
            chunkData[i][columnIndex] = cell.toLowerCase()
            break
          case "uppercase":
            chunkData[i][columnIndex] = cell.toUpperCase()
            break
          case "title_case":
            chunkData[i][columnIndex] = cell.replace(
              /\w\S*/g,
              (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(),
            )
            break
          case "email":
            chunkData[i][columnIndex] = cell.toLowerCase().trim()
            break
          case "phone":
            const cleaned = cell.replace(/\D/g, "")
            if (cleaned.length === 10) {
              chunkData[i][columnIndex] = `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
            }
            break
        }
      }
    }
  }

  private async fixDataTypesInChunk(chunkId: string, transformation: any): Promise<void> {
    const chunkData = this.processedData.get(chunkId)!
    const headers = chunkData[0] as string[]
    const columnIndex = headers.indexOf(transformation.column)

    if (columnIndex === -1) return

    for (let i = 1; i < chunkData.length; i++) {
      const cell = chunkData[i][columnIndex]
      if (cell !== null && cell !== undefined && cell !== "") {
        switch (transformation.targetType) {
          case "number":
            const num = Number(cell)
            if (!isNaN(num)) {
              chunkData[i][columnIndex] = num
            }
            break
          case "date":
            const date = new Date(cell)
            if (!isNaN(date.getTime())) {
              chunkData[i][columnIndex] = date.toISOString().split("T")[0]
            }
            break
          case "string":
            chunkData[i][columnIndex] = String(cell)
            break
        }
      }
    }
  }

  private async trimWhitespaceInChunk(chunkId: string, transformation: any): Promise<void> {
    const chunkData = this.processedData.get(chunkId)!
    const headers = chunkData[0] as string[]
    const columnIndex = headers.indexOf(transformation.column)

    if (columnIndex === -1) return

    for (let i = 1; i < chunkData.length; i++) {
      const cell = chunkData[i][columnIndex]
      if (typeof cell === "string") {
        chunkData[i][columnIndex] = cell.trim().replace(/\s+/g, " ")
      }
    }
  }

  private async normalizeDataInChunk(chunkId: string, transformation: any): Promise<void> {
    const chunkData = this.processedData.get(chunkId)!
    const headers = chunkData[0] as string[]
    const dataRows = chunkData.slice(1)

    // For normalization, we need to track unique values across chunks
    // This is a simplified version - in production, you'd need cross-chunk coordination
    const { columns, newTableName } = transformation
    const columnIndices = columns.map((col: string) => headers.indexOf(col))

    // Create normalized data for this chunk
    const normalizedData = []
    const mainTableData = []

    dataRows.forEach((row, rowIndex) => {
      const values = columnIndices.map((idx: number) => row[idx])
      const valueKey = values.join("|")

      // For this chunk, create a simple ID
      const chunkRowId = `${chunkId}_${rowIndex + 1}`
      normalizedData.push([chunkRowId, ...values])

      // Create main table row with reference
      const mainRow = [...row]
      columnIndices.forEach((idx: number, i: number) => {
        if (i === 0) {
          mainRow[idx] = chunkRowId // Reference ID
        } else {
          mainRow.splice(idx, 1) // Remove other normalized columns
        }
      })
      mainTableData.push(mainRow)
    })

    // Update chunk data
    this.processedData.set(chunkId, [headers, ...mainTableData])

    // Store normalized data separately (in production, this would go to a separate table)
    const normalizedHeaders = ["ID", ...columns]
    this.processedData.set(`${chunkId}_normalized_${newTableName}`, [normalizedHeaders, ...normalizedData])
  }

  private async splitMultiValueInChunk(chunkId: string, transformation: any): Promise<void> {
    const chunkData = this.processedData.get(chunkId)!
    const headers = chunkData[0] as string[]
    const dataRows = chunkData.slice(1)
    const { columns, delimiter } = transformation
    const delimiterRegex = new RegExp(delimiter || "[,;|]")

    columns.forEach((column: string) => {
      const columnIndex = headers.indexOf(column)
      if (columnIndex === -1) return

      const expandedRows: any[][] = []

      dataRows.forEach((row) => {
        const cellValue = row[columnIndex]
        if (typeof cellValue === "string" && delimiterRegex.test(cellValue)) {
          const values = cellValue
            .split(delimiterRegex)
            .map((v) => v.trim())
            .filter((v) => v)

          values.forEach((value) => {
            const newRow = [...row]
            newRow[columnIndex] = value
            expandedRows.push(newRow)
          })
        } else {
          expandedRows.push(row)
        }
      })

      this.processedData.set(chunkId, [headers, ...expandedRows])
    })
  }

  async generateCleanedExcelFromChunks(): Promise<Buffer> {
    if (!this.workbook) {
      throw new Error("No workbook loaded")
    }

    const newWorkbook = XLSX.utils.book_new()
    const sheetData: { [sheetName: string]: any[][] } = {}

    // Combine all chunks back into sheets
    for (const [chunkId, chunkMetadata] of this.chunks.entries()) {
      if (!chunkMetadata.processed) continue

      const chunkData = this.processedData.get(chunkId)
      if (!chunkData) continue

      const sheetName = chunkMetadata.sheetName
      if (!sheetData[sheetName]) {
        sheetData[sheetName] = [chunkMetadata.headers] // Initialize with headers
      }

      // Add data rows (skip headers from chunk)
      const dataRows = chunkData.slice(1)
      sheetData[sheetName].push(...dataRows)
    }

    // Create worksheets
    for (const [sheetName, data] of Object.entries(sheetData)) {
      const worksheet = XLSX.utils.aoa_to_sheet(data)
      XLSX.utils.book_append_sheet(newWorkbook, worksheet, sheetName)
    }

    // Add any normalized tables
    for (const [dataKey, data] of this.processedData.entries()) {
      if (dataKey.includes("_normalized_")) {
        const tableName = dataKey.split("_normalized_")[1]
        const worksheet = XLSX.utils.aoa_to_sheet(data)
        XLSX.utils.book_append_sheet(newWorkbook, worksheet, tableName)
      }
    }

    const buffer = Buffer.from(XLSX.write(newWorkbook, { type: "buffer", bookType: "xlsx" }))

    try {
      await FileStorage.storeCleanedFile(this.sessionId, buffer)
    } catch (error) {
      console.warn("Failed to store cleaned file:", error)
    }

    return buffer
  }

  getProcessingProgress(): ProcessingProgress {
    const totalChunks = this.chunks.size
    const processedChunks = Array.from(this.chunks.values()).filter((chunk) => chunk.processed).length
    const percentage = totalChunks > 0 ? Math.round((processedChunks / totalChunks) * 100) : 0

    // Estimate remaining time (rough calculation)
    const avgTimePerChunk = 2 // seconds
    const remainingChunks = totalChunks - processedChunks
    const estimatedSeconds = remainingChunks * avgTimePerChunk
    const estimatedTimeRemaining =
      estimatedSeconds > 60 ? `${Math.round(estimatedSeconds / 60)} minutes` : `${estimatedSeconds} seconds`

    return {
      totalChunks,
      processedChunks,
      currentChunk: processedChunks < totalChunks ? Array.from(this.chunks.keys())[processedChunks] : "",
      percentage,
      estimatedTimeRemaining,
    }
  }

  getChunkSample(chunkId: string, maxRows = 10): any[][] | null {
    const chunkData = this.processedData.get(chunkId)
    if (!chunkData) return null

    return chunkData.slice(0, Math.min(maxRows + 1, chunkData.length)) // +1 for headers
  }

  getAllChunks(): ChunkMetadata[] {
    return Array.from(this.chunks.values())
  }

  getTransformationLog(): any[] {
    return this.transformationLog
  }

  // Memory management
  clearProcessedChunk(chunkId: string): void {
    this.processedData.delete(chunkId)
    console.log(`Cleared chunk ${chunkId} from memory`)
  }

  clearAllProcessedData(): void {
    this.processedData.clear()
    console.log("Cleared all processed data from memory")
  }
}
