import * as XLSX from "xlsx"
import { FileStorage } from "./file-storage"
import type { ExcelData, DataQualityIssue } from "./excel-processor"

export class EnhancedExcelProcessor {
  private workbook: XLSX.WorkBook | null = null
  private data: ExcelData | null = null
  private sessionId: string
  private transformationLog: any[] = []

  constructor(
    private fileBuffer: Buffer,
    sessionId: string,
  ) {
    this.sessionId = sessionId
  }

  static async fromStorage(sessionId: string, fileName: string): Promise<EnhancedExcelProcessor> {
    try {
      const buffer = await FileStorage.getFile(sessionId, fileName)
      return new EnhancedExcelProcessor(buffer, sessionId)
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
      return new EnhancedExcelProcessor(fallbackBuffer, sessionId)
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

  applyAdvancedTransformation(transformation: any): void {
    if (!this.data || !this.workbook) {
      throw new Error("Excel file must be parsed first")
    }

    console.log("Applying advanced transformation:", transformation.type)

    switch (transformation.type) {
      case "normalize_data":
        this.normalizeData(transformation)
        break
      case "create_lookup_table":
        this.createLookupTable(transformation)
        break
      case "split_repeating_groups":
        this.splitRepeatingGroups(transformation)
        break
      case "remove_transitive_dependencies":
        this.removeTransitiveDependencies(transformation)
        break
      case "split_multi_value":
        this.splitMultiValueAttributes(transformation)
        break
      case "validate_constraints":
        this.validateConstraints(transformation)
        break
      case "optimize_structure":
        this.optimizeStructure(transformation)
        break
      // Standard transformations
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
      default:
        console.warn("Unknown transformation type:", transformation.type)
    }

    // Log the transformation
    this.transformationLog.push({
      timestamp: new Date().toISOString(),
      transformation: transformation,
      status: "completed",
    })
  }

  private normalizeData(transformation: any): void {
    const { sheet, columns, newTableName } = transformation
    const sheetData = this.data!.sheets[sheet]

    if (!sheetData || sheetData.length < 2) return

    const headers = sheetData[0] as string[]
    const dataRows = sheetData.slice(1)

    // Create normalized table
    const normalizedData = []
    const mainTableData = []

    // Extract unique values for normalization
    const uniqueValues = new Set()
    const columnIndices = columns.map((col: string) => headers.indexOf(col))

    dataRows.forEach((row, rowIndex) => {
      const values = columnIndices.map((idx: number) => row[idx])
      const valueKey = values.join("|")

      if (!uniqueValues.has(valueKey)) {
        uniqueValues.add(valueKey)
        normalizedData.push([rowIndex + 1, ...values])
      }

      // Create main table row with reference
      const mainRow = [...row]
      columnIndices.forEach((idx: number) => {
        mainRow[idx] = rowIndex + 1 // Reference ID
      })
      mainTableData.push(mainRow)
    })

    // Update main sheet
    this.data!.sheets[sheet] = [headers, ...mainTableData]

    // Create new normalized sheet
    const normalizedHeaders = ["ID", ...columns]
    this.data!.sheets[newTableName] = [normalizedHeaders, ...normalizedData]

    console.log(`Created normalized table: ${newTableName}`)
  }

  private createLookupTable(transformation: any): void {
    const { sheet, columns, lookupTableName } = transformation
    const sheetData = this.data!.sheets[sheet]

    if (!sheetData || sheetData.length < 2) return

    const headers = sheetData[0] as string[]
    const dataRows = sheetData.slice(1)
    const columnIndices = columns.map((col: string) => headers.indexOf(col))

    // Extract unique combinations
    const uniqueCombinations = new Map()
    let idCounter = 1

    dataRows.forEach((row) => {
      const values = columnIndices.map((idx: number) => row[idx])
      const key = values.join("|")

      if (!uniqueCombinations.has(key)) {
        uniqueCombinations.set(key, {
          id: idCounter++,
          values: values,
        })
      }
    })

    // Create lookup table
    const lookupHeaders = ["ID", ...columns]
    const lookupData = Array.from(uniqueCombinations.values()).map((item) => [item.id, ...item.values])

    // Update main table with references
    const updatedDataRows = dataRows.map((row) => {
      const values = columnIndices.map((idx: number) => row[idx])
      const key = values.join("|")
      const lookupId = uniqueCombinations.get(key).id

      const newRow = [...row]
      // Replace first column with lookup ID, remove others
      newRow[columnIndices[0]] = lookupId
      columnIndices
        .slice(1)
        .reverse()
        .forEach((idx: number) => {
          newRow.splice(idx, 1)
        })

      return newRow
    })

    // Update headers
    const updatedHeaders = [...headers]
    updatedHeaders[columnIndices[0]] = `${columns[0]}_ID`
    columnIndices
      .slice(1)
      .reverse()
      .forEach((idx: number) => {
        updatedHeaders.splice(idx, 1)
      })

    this.data!.sheets[sheet] = [updatedHeaders, ...updatedDataRows]
    this.data!.sheets[lookupTableName] = [lookupHeaders, ...lookupData]

    console.log(`Created lookup table: ${lookupTableName}`)
  }

  private splitRepeatingGroups(transformation: any): void {
    const { sheet, columns, newTableName } = transformation
    const sheetData = this.data!.sheets[sheet]

    if (!sheetData || sheetData.length < 2) return

    const headers = sheetData[0] as string[]
    const dataRows = sheetData.slice(1)
    const columnIndices = columns.map((col: string) => headers.indexOf(col))

    // Create detail table
    const detailData = []
    const detailHeaders = ["ParentID", "Sequence", "Value"]

    dataRows.forEach((row, rowIndex) => {
      columnIndices.forEach((colIndex, sequence) => {
        const value = row[colIndex]
        if (value != null && value !== "") {
          detailData.push([rowIndex + 1, sequence + 1, value])
        }
      })
    })

    // Remove repeating columns from main table
    const updatedHeaders = headers.filter((_, index) => !columnIndices.includes(index))
    const updatedDataRows = dataRows.map((row) => row.filter((_, index) => !columnIndices.includes(index)))

    this.data!.sheets[sheet] = [updatedHeaders, ...updatedDataRows]
    this.data!.sheets[newTableName] = [detailHeaders, ...detailData]

    console.log(`Split repeating groups into: ${newTableName}`)
  }

  private removeTransitiveDependencies(transformation: any): void {
    const { sheet, columns, referenceTable } = transformation
    const sheetData = this.data!.sheets[sheet]

    if (!sheetData || sheetData.length < 2) return

    const headers = sheetData[0] as string[]
    const dataRows = sheetData.slice(1)
    const columnIndices = columns.map((col: string) => headers.indexOf(col))

    // Extract reference data
    const referenceData = new Map()
    let refIdCounter = 1

    dataRows.forEach((row) => {
      const values = columnIndices.map((idx: number) => row[idx])
      const key = values.join("|")

      if (!referenceData.has(key)) {
        referenceData.set(key, refIdCounter++)
      }
    })

    // Create reference table
    const refHeaders = ["ID", ...columns]
    const refTableData = Array.from(referenceData.entries()).map(([key, id]) => [id, ...key.split("|")])

    // Update main table
    const updatedDataRows = dataRows.map((row) => {
      const values = columnIndices.map((idx: number) => row[idx])
      const key = values.join("|")
      const refId = referenceData.get(key)

      const newRow = [...row]
      newRow[columnIndices[0]] = refId
      columnIndices
        .slice(1)
        .reverse()
        .forEach((idx: number) => {
          newRow.splice(idx, 1)
        })

      return newRow
    })

    const updatedHeaders = [...headers]
    updatedHeaders[columnIndices[0]] = `${columns[0]}_ID`
    columnIndices
      .slice(1)
      .reverse()
      .forEach((idx: number) => {
        updatedHeaders.splice(idx, 1)
      })

    this.data!.sheets[sheet] = [updatedHeaders, ...updatedDataRows]
    this.data!.sheets[referenceTable] = [refHeaders, ...refTableData]

    console.log(`Removed transitive dependencies, created: ${referenceTable}`)
  }

  private splitMultiValueAttributes(transformation: any): void {
    const { sheet, columns, delimiter } = transformation
    const sheetData = this.data!.sheets[sheet]

    if (!sheetData || sheetData.length < 2) return

    const headers = sheetData[0] as string[]
    const dataRows = sheetData.slice(1)
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

      this.data!.sheets[sheet] = [headers, ...expandedRows]
    })

    console.log(`Split multi-value attributes in columns: ${columns.join(", ")}`)
  }

  private validateConstraints(transformation: any): void {
    const { sheet, constraints } = transformation
    const sheetData = this.data!.sheets[sheet]

    if (!sheetData || sheetData.length < 2) return

    const headers = sheetData[0] as string[]
    const dataRows = sheetData.slice(1)

    constraints.forEach((constraint: any) => {
      switch (constraint.type) {
        case "not_null":
          this.validateNotNull(headers, dataRows, constraint.columns)
          break
        case "unique":
          this.validateUnique(headers, dataRows, constraint.columns)
          break
        case "range":
          this.validateRange(headers, dataRows, constraint.column, constraint.min, constraint.max)
          break
      }
    })
  }

  private validateNotNull(headers: string[], dataRows: any[][], columns: string[]): void {
    columns.forEach((column) => {
      const columnIndex = headers.indexOf(column)
      if (columnIndex === -1) return

      dataRows.forEach((row, rowIndex) => {
        if (row[columnIndex] == null || row[columnIndex] === "") {
          console.warn(`NOT NULL constraint violation in ${column} at row ${rowIndex + 2}`)
        }
      })
    })
  }

  private validateUnique(headers: string[], dataRows: any[][], columns: string[]): void {
    const columnIndices = columns.map((col) => headers.indexOf(col)).filter((idx) => idx !== -1)
    const seen = new Set()

    dataRows.forEach((row, rowIndex) => {
      const values = columnIndices.map((idx) => row[idx])
      const key = values.join("|")

      if (seen.has(key)) {
        console.warn(`UNIQUE constraint violation in ${columns.join(", ")} at row ${rowIndex + 2}`)
      } else {
        seen.add(key)
      }
    })
  }

  private validateRange(headers: string[], dataRows: any[][], column: string, min: number, max: number): void {
    const columnIndex = headers.indexOf(column)
    if (columnIndex === -1) return

    dataRows.forEach((row, rowIndex) => {
      const value = Number(row[columnIndex])
      if (!isNaN(value) && (value < min || value > max)) {
        console.warn(`RANGE constraint violation in ${column} at row ${rowIndex + 2}: ${value} not in [${min}, ${max}]`)
      }
    })
  }

  private optimizeStructure(transformation: any): void {
    const { sheet, optimizations } = transformation

    optimizations.forEach((opt: any) => {
      switch (opt.type) {
        case "remove_empty_columns":
          this.removeEmptyColumns(sheet)
          break
        case "reorder_columns":
          this.reorderColumns(sheet, opt.order)
          break
        case "add_indexes":
          this.addIndexes(sheet, opt.columns)
          break
      }
    })
  }

  private removeEmptyColumns(sheet: string): void {
    const sheetData = this.data!.sheets[sheet]
    if (!sheetData || sheetData.length < 2) return

    const headers = sheetData[0] as string[]
    const dataRows = sheetData.slice(1)

    const nonEmptyColumns: number[] = []

    headers.forEach((header, index) => {
      const hasData = dataRows.some((row) => row[index] != null && row[index] !== "")
      if (hasData) {
        nonEmptyColumns.push(index)
      }
    })

    const newHeaders = nonEmptyColumns.map((idx) => headers[idx])
    const newDataRows = dataRows.map((row) => nonEmptyColumns.map((idx) => row[idx]))

    this.data!.sheets[sheet] = [newHeaders, ...newDataRows]
    console.log(`Removed ${headers.length - nonEmptyColumns.length} empty columns from ${sheet}`)
  }

  private reorderColumns(sheet: string, order: string[]): void {
    const sheetData = this.data!.sheets[sheet]
    if (!sheetData || sheetData.length < 2) return

    const headers = sheetData[0] as string[]
    const dataRows = sheetData.slice(1)

    const newOrder = order.map((col) => headers.indexOf(col)).filter((idx) => idx !== -1)
    const remainingColumns = headers.map((_, idx) => idx).filter((idx) => !newOrder.includes(idx))
    const finalOrder = [...newOrder, ...remainingColumns]

    const newHeaders = finalOrder.map((idx) => headers[idx])
    const newDataRows = dataRows.map((row) => finalOrder.map((idx) => row[idx]))

    this.data!.sheets[sheet] = [newHeaders, ...newDataRows]
    console.log(`Reordered columns in ${sheet}`)
  }

  private addIndexes(sheet: string, columns: string[]): void {
    // This would be metadata for database creation
    console.log(`Added indexes for columns: ${columns.join(", ")} in ${sheet}`)
  }

  // Standard transformation methods (keeping existing ones)
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
          case "email":
            sheetData[i][columnIndex] = cell.toLowerCase().trim()
            break
          case "phone":
            const cleaned = cell.replace(/\D/g, "")
            if (cleaned.length === 10) {
              sheetData[i][columnIndex] = `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
            }
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

    try {
      await FileStorage.storeCleanedFile(this.sessionId, buffer)
    } catch (error) {
      console.warn("Failed to store cleaned file:", error)
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

  getTransformationLog(): any[] {
    return this.transformationLog
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

      // Enhanced analysis for normalization opportunities
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

        // Check for multi-value attributes
        const multiValueCount = columnData.filter(
          (cell) => typeof cell === "string" && /[,;|]/.test(cell) && cell.split(/[,;|]/).length > 1,
        ).length

        if (multiValueCount > 0) {
          issues.push({
            type: "inconsistent_format",
            severity: "medium",
            column: columnName,
            sheet: sheetName,
            count: multiValueCount,
            description: `${multiValueCount} cells contain multiple values in '${columnName}' - should be normalized`,
            examples: columnData
              .filter((cell) => typeof cell === "string" && /[,;|]/.test(cell))
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
        const whitespaceIssues = stringData.filter((cell) => cell !== cell.trim() || cell.includes("  "))

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
}
