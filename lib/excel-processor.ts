import * as XLSX from "xlsx"
import { FileStorage } from "./file-storage"

export interface ExcelData {
  sheets: { [sheetName: string]: any[][] }
  metadata: {
    totalRows: number
    totalColumns: number
    sheetNames: string[]
    fileSize: number
  }
}

export interface DataQualityIssue {
  type: "missing_values" | "duplicates" | "inconsistent_format" | "data_type_mismatch" | "outliers" | "whitespace"
  severity: "high" | "medium" | "low"
  column?: string
  sheet?: string
  count: number
  description: string
  examples?: string[]
}

export class ExcelProcessor {
  private workbook: XLSX.WorkBook | null = null
  private data: ExcelData | null = null
  private sessionId: string

  constructor(
    private fileBuffer: Buffer,
    sessionId: string,
  ) {
    this.sessionId = sessionId
  }

  static async fromStorage(sessionId: string, fileName: string): Promise<ExcelProcessor> {
    try {
      console.log(`Attempting to load file: ${fileName} for session: ${sessionId}`)

      // List available files for debugging
      const availableFiles = FileStorage.listStoredFiles()
      console.log("Available files in storage:", availableFiles)

      const buffer = await FileStorage.getFile(sessionId, fileName)
      console.log(`Successfully loaded file: ${fileName} (${buffer.length} bytes)`)

      return new ExcelProcessor(buffer, sessionId)
    } catch (error) {
      console.error(`Failed to load file from storage: ${error instanceof Error ? error.message : "Unknown error"}`)

      // Try to create a minimal Excel file as fallback
      console.log("Creating fallback Excel file...")
      const fallbackWorkbook = XLSX.utils.book_new()
      const fallbackSheet = XLSX.utils.aoa_to_sheet([
        ["Error", "Message"],
        ["File Not Found", `Original file ${fileName} could not be retrieved`],
        ["Session ID", sessionId],
        ["Note", "This is a fallback file. Original data may be lost."],
      ])
      XLSX.utils.book_append_sheet(fallbackWorkbook, fallbackSheet, "Error")

      const fallbackBuffer = Buffer.from(XLSX.write(fallbackWorkbook, { type: "buffer", bookType: "xlsx" }))
      return new ExcelProcessor(fallbackBuffer, sessionId)
    }
  }

  async parseExcel(): Promise<ExcelData> {
    try {
      this.workbook = XLSX.read(this.fileBuffer, { type: "buffer" })

      const sheets: { [sheetName: string]: any[][] } = {}
      let totalRows = 0
      let totalColumns = 0

      for (const sheetName of this.workbook.SheetNames) {
        const worksheet = this.workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null })

        sheets[sheetName] = jsonData
        totalRows += jsonData.length
        totalColumns = Math.max(totalColumns, Math.max(...jsonData.map((row) => row.length)))
      }

      this.data = {
        sheets,
        metadata: {
          totalRows,
          totalColumns,
          sheetNames: this.workbook.SheetNames,
          fileSize: this.fileBuffer.length,
        },
      }

      return this.data
    } catch (error) {
      throw new Error(`Failed to parse Excel file: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  analyzeDataQuality(): DataQualityIssue[] {
    if (!this.data) {
      throw new Error("Excel file must be parsed first")
    }

    const issues: DataQualityIssue[] = []

    for (const [sheetName, sheetData] of Object.entries(this.data.sheets)) {
      if (sheetData.length === 0) continue

      const headers = sheetData[0] as string[]
      const dataRows = sheetData.slice(1)

      // Analyze each column
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
            sheet: sheetName,
            count: missingCount,
            description: `${missingCount} missing values found in column '${columnName}'`,
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
              sheet: sheetName,
              count: nonEmptyData.length,
              description: `Mixed data types found in column '${columnName}': ${Array.from(types).join(", ")}`,
              examples: nonEmptyData.slice(0, 3).map(String),
            })
          }
        }

        // Check for whitespace issues
        const stringData = columnData.filter((cell) => typeof cell === "string" && cell.length > 0)
        const whitespaceIssues = stringData.filter(
          (cell) => cell !== cell.trim() || cell.includes("  "), // leading/trailing spaces or double spaces
        )

        if (whitespaceIssues.length > 0) {
          issues.push({
            type: "whitespace",
            severity: "low",
            column: columnName,
            sheet: sheetName,
            count: whitespaceIssues.length,
            description: `${whitespaceIssues.length} cells with whitespace issues in column '${columnName}'`,
            examples: whitespaceIssues.slice(0, 3),
          })
        }

        // Check for potential email format issues
        if (columnName.toLowerCase().includes("email")) {
          const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
          const invalidEmails = stringData.filter((cell) => cell && !emailPattern.test(cell))

          if (invalidEmails.length > 0) {
            issues.push({
              type: "inconsistent_format",
              severity: "medium",
              column: columnName,
              sheet: sheetName,
              count: invalidEmails.length,
              description: `${invalidEmails.length} invalid email formats in column '${columnName}'`,
              examples: invalidEmails.slice(0, 3),
            })
          }
        }
      }

      // Check for duplicate rows
      const rowStrings = dataRows.map((row) => JSON.stringify(row))
      const uniqueRows = new Set(rowStrings)
      const duplicateCount = rowStrings.length - uniqueRows.size

      if (duplicateCount > 0) {
        issues.push({
          type: "duplicates",
          severity: duplicateCount > dataRows.length * 0.1 ? "high" : "medium",
          sheet: sheetName,
          count: duplicateCount,
          description: `${duplicateCount} duplicate rows found in sheet '${sheetName}'`,
        })
      }
    }

    return issues.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 }
      return severityOrder[b.severity] - severityOrder[a.severity]
    })
  }

  applyTransformation(transformation: any): void {
    if (!this.data || !this.workbook) {
      throw new Error("Excel file must be parsed first")
    }

    // Apply the transformation based on type
    switch (transformation.type) {
      case "fill_missing":
        this.fillMissingValues(transformation)
        break
      case "remove_duplicates":
        this.removeDuplicates(transformation)
        break
      case "standardize_format":
        this.standardizeFormat(transformation)
        break
      case "fix_data_types":
        this.fixDataTypes(transformation)
        break
      case "trim_whitespace":
        this.trimWhitespace(transformation)
        break
    }
  }

  private fillMissingValues(transformation: any): void {
    const { sheet, column, method, value } = transformation
    const sheetData = this.data!.sheets[sheet]
    const headers = sheetData[0] as string[]
    const columnIndex = headers.indexOf(column)

    if (columnIndex === -1) return

    const dataRows = sheetData.slice(1)
    const columnData = dataRows
      .map((row) => row[columnIndex])
      .filter((cell) => cell !== null && cell !== undefined && cell !== "")

    let fillValue = value
    if (method === "median" && columnData.length > 0) {
      const numbers = columnData
        .filter((cell) => !isNaN(Number(cell)))
        .map(Number)
        .sort((a, b) => a - b)
      fillValue = numbers.length > 0 ? numbers[Math.floor(numbers.length / 2)] : 0
    } else if (method === "mean" && columnData.length > 0) {
      const numbers = columnData.filter((cell) => !isNaN(Number(cell))).map(Number)
      fillValue = numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0
    } else if (method === "mode" && columnData.length > 0) {
      const frequency: { [key: string]: number } = {}
      columnData.forEach((cell) => {
        const key = String(cell)
        frequency[key] = (frequency[key] || 0) + 1
      })
      fillValue = Object.keys(frequency).reduce((a, b) => (frequency[a] > frequency[b] ? a : b))
    }

    // Apply the fill
    for (let i = 1; i < sheetData.length; i++) {
      if (
        sheetData[i][columnIndex] === null ||
        sheetData[i][columnIndex] === undefined ||
        sheetData[i][columnIndex] === ""
      ) {
        sheetData[i][columnIndex] = fillValue
      }
    }
  }

  private removeDuplicates(transformation: any): void {
    const { sheet } = transformation
    const sheetData = this.data!.sheets[sheet]
    const headers = sheetData[0]
    const dataRows = sheetData.slice(1)

    const seen = new Set()
    const uniqueRows = dataRows.filter((row) => {
      const rowString = JSON.stringify(row)
      if (seen.has(rowString)) {
        return false
      }
      seen.add(rowString)
      return true
    })

    this.data!.sheets[sheet] = [headers, ...uniqueRows]
  }

  private standardizeFormat(transformation: any): void {
    const { sheet, column, format } = transformation
    const sheetData = this.data!.sheets[sheet]
    const headers = sheetData[0] as string[]
    const columnIndex = headers.indexOf(column)

    if (columnIndex === -1) return

    for (let i = 1; i < sheetData.length; i++) {
      const cell = sheetData[i][columnIndex]
      if (typeof cell === "string") {
        switch (format) {
          case "lowercase":
            sheetData[i][columnIndex] = cell.toLowerCase()
            break
          case "uppercase":
            sheetData[i][columnIndex] = cell.toUpperCase()
            break
          case "title_case":
            sheetData[i][columnIndex] = cell.replace(
              /\w\S*/g,
              (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(),
            )
            break
        }
      }
    }
  }

  private fixDataTypes(transformation: any): void {
    const { sheet, column, targetType } = transformation
    const sheetData = this.data!.sheets[sheet]
    const headers = sheetData[0] as string[]
    const columnIndex = headers.indexOf(column)

    if (columnIndex === -1) return

    for (let i = 1; i < sheetData.length; i++) {
      const cell = sheetData[i][columnIndex]
      if (cell !== null && cell !== undefined && cell !== "") {
        switch (targetType) {
          case "number":
            const num = Number(cell)
            if (!isNaN(num)) {
              sheetData[i][columnIndex] = num
            }
            break
          case "date":
            const date = new Date(cell)
            if (!isNaN(date.getTime())) {
              sheetData[i][columnIndex] = date.toISOString().split("T")[0]
            }
            break
          case "string":
            sheetData[i][columnIndex] = String(cell)
            break
        }
      }
    }
  }

  private trimWhitespace(transformation: any): void {
    const { sheet, column } = transformation
    const sheetData = this.data!.sheets[sheet]
    const headers = sheetData[0] as string[]
    const columnIndex = headers.indexOf(column)

    if (columnIndex === -1) return

    for (let i = 1; i < sheetData.length; i++) {
      const cell = sheetData[i][columnIndex]
      if (typeof cell === "string") {
        sheetData[i][columnIndex] = cell.trim().replace(/\s+/g, " ")
      }
    }
  }

  async generateCleanedExcel(): Promise<Buffer> {
    if (!this.data || !this.workbook) {
      throw new Error("No data to generate Excel from")
    }

    const newWorkbook = XLSX.utils.book_new()

    for (const [sheetName, sheetData] of Object.entries(this.data.sheets)) {
      const worksheet = XLSX.utils.aoa_to_sheet(sheetData)
      XLSX.utils.book_append_sheet(newWorkbook, worksheet, sheetName)
    }

    const buffer = Buffer.from(XLSX.write(newWorkbook, { type: "buffer", bookType: "xlsx" }))

    // Store the cleaned file
    try {
      await FileStorage.storeCleanedFile(this.sessionId, buffer)
    } catch (error) {
      console.warn("Failed to store cleaned file:", error)
      // Continue anyway, we can still return the buffer
    }

    return buffer
  }

  getDataSample(maxRows = 100): any {
    if (!this.data) return null

    const sample: any = { sheets: {} }

    for (const [sheetName, sheetData] of Object.entries(this.data.sheets)) {
      sample.sheets[sheetName] = sheetData.slice(0, Math.min(maxRows, sheetData.length))
    }

    return sample
  }
}
