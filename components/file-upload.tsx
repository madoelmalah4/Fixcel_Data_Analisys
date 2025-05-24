"use client"

import { useCallback, useState } from "react"
import { useDropzone } from "react-dropzone"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Upload, FileSpreadsheet, AlertCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface FileUploadProps {
  onFileUpload: (file: File) => void
  loading?: boolean
}

export function FileUpload({ onFileUpload, loading = false }: FileUploadProps) {
  const [error, setError] = useState<string | null>(null)

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: any[]) => {
      setError(null)

      if (rejectedFiles.length > 0) {
        const rejection = rejectedFiles[0]
        if (rejection.errors.some((e: any) => e.code === "file-too-large")) {
          setError("File size must be less than 50MB")
        } else if (rejection.errors.some((e: any) => e.code === "file-invalid-type")) {
          setError("Only .xlsx files are allowed")
        } else {
          setError("Invalid file")
        }
        return
      }

      if (acceptedFiles.length > 0) {
        onFileUpload(acceptedFiles[0])
      }
    },
    [onFileUpload],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
    multiple: false,
    disabled: loading,
  })

  return (
    <Card className="w-full">
      <CardContent className="p-8">
        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
            isDragActive ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-gray-300 dark:border-gray-600",
            loading && "cursor-not-allowed opacity-50",
          )}
        >
          <input {...getInputProps()} />

          <div className="flex flex-col items-center space-y-4">
            {loading ? (
              <Loader2 className="h-12 w-12 text-blue-600 animate-spin" />
            ) : (
              <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-full">
                <Upload className="h-8 w-8 text-blue-600" />
              </div>
            )}

            <div>
              <h3 className="text-lg font-semibold mb-2">
                {loading ? "Uploading..." : isDragActive ? "Drop your Excel file here" : "Upload Excel File"}
              </h3>
              <p className="text-gray-600 dark:text-gray-300 mb-4">
                {loading
                  ? "Please wait while we process your file"
                  : "Drag and drop your .xlsx file here, or click to browse"}
              </p>

              {!loading && (
                <Button variant="outline" disabled={loading}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Choose File
                </Button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg flex items-center space-x-2">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <span className="text-red-600 text-sm">{error}</span>
          </div>
        )}

        <div className="mt-6 text-xs text-gray-500 dark:text-gray-400 space-y-1">
          <p>• Only .xlsx files are supported</p>
          <p>• Maximum file size: 50MB</p>
          <p>• Your data is processed securely and never stored permanently</p>
        </div>
      </CardContent>
    </Card>
  )
}
