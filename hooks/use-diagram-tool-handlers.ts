import type { MutableRefObject } from "react"
import { isMxCellXmlComplete, wrapWithMxFile } from "@/lib/utils"

const DEBUG = process.env.NODE_ENV === "development"

interface ToolCall {
    toolCallId: string
    toolName: string
    input: unknown
}

type AddToolOutputSuccess = {
    tool: string
    toolCallId: string
    state?: "output-available"
    output: string
    errorText?: undefined
}

type AddToolOutputError = {
    tool: string
    toolCallId: string
    state: "output-error"
    output?: undefined
    errorText: string
}

type AddToolOutputParams = AddToolOutputSuccess | AddToolOutputError

type AddToolOutputFn = (params: AddToolOutputParams) => void

interface DiagramOperation {
    operation: "update" | "add" | "delete"
    cell_id: string
    new_xml?: string
}

interface UseDiagramToolHandlersParams {
    partialXmlRef: MutableRefObject<string>
    editDiagramOriginalXmlRef: MutableRefObject<Map<string, string>>
    chartXMLRef: MutableRefObject<string>
    onDisplayChart: (xml: string, skipValidation?: boolean) => string | null
    onFetchChart: (saveToHistory?: boolean) => Promise<string>
    onExport: () => void
}

/**
 * Hook that creates the onToolCall handler for diagram-related tools.
 * Handles display_diagram, edit_diagram, and append_diagram tools.
 *
 * Note: addToolOutput is passed at call time (not hook init) because
 * it comes from useChat which creates a circular dependency.
 */
export function useDiagramToolHandlers({
    partialXmlRef,
    editDiagramOriginalXmlRef,
    chartXMLRef,
    onDisplayChart,
    onFetchChart,
    onExport,
}: UseDiagramToolHandlersParams) {
    const handleToolCall = async (
        { toolCall }: { toolCall: ToolCall },
        addToolOutput: AddToolOutputFn,
    ) => {
        if (DEBUG) {
            console.log(
                `[onToolCall] Tool: ${toolCall.toolName}, CallId: ${toolCall.toolCallId}`,
            )
        }

        if (toolCall.toolName === "display_diagram") {
            await handleDisplayDiagram(toolCall, addToolOutput)
        } else if (toolCall.toolName === "edit_diagram") {
            await handleEditDiagram(toolCall, addToolOutput)
        } else if (toolCall.toolName === "append_diagram") {
            handleAppendDiagram(toolCall, addToolOutput)
        }
    }

    const handleDisplayDiagram = async (
        toolCall: ToolCall,
        addToolOutput: AddToolOutputFn,
    ) => {
        let { xml } = toolCall.input as { xml: string }

        // OPTIMIZATION: Replace cache URLs with actual base64 data
        // Pattern: image=data:cache/CACHE_KEY/REGION_NAME
        const cachePattern = /image=data:cache\/([^/]+)\/([^;"\s]+)/g
        const cacheMatches = [...xml.matchAll(cachePattern)]

        if (cacheMatches.length > 0) {
            console.log(
                `[display_diagram] Found ${cacheMatches.length} cached image references:`,
                cacheMatches.map((m) => `${m[1]}/${m[2]}`),
            )

            // Group by cache key
            const cacheKeys = new Set(cacheMatches.map((m) => m[1]))

            for (const cacheKey of cacheKeys) {
                try {
                    console.log(`[display_diagram] Fetching cache: ${cacheKey}`)
                    const response = await fetch("/api/get-cached-regions", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ cacheKey }),
                    })

                    if (response.ok) {
                        const { regions } = await response.json()
                        console.log(
                            `[display_diagram] Retrieved ${Object.keys(regions).length} regions from cache:`,
                            Object.keys(regions),
                        )

                        // Replace all cache URLs with actual data URLs
                        let replacementCount = 0
                        for (const [
                            fullMatch,
                            key,
                            regionName,
                        ] of cacheMatches) {
                            if (key === cacheKey && regions[regionName]) {
                                let dataUrl = regions[regionName]
                                const beforeLength = xml.length

                                // CRITICAL FIX: draw.io style attribute parser treats semicolons as separators
                                // We need to URL-encode the semicolons in the data URL to prevent parsing issues
                                // Replace ; with %3B in the data URL
                                dataUrl = dataUrl.replace(/;/g, "%3B")

                                // Log the replacement for debugging
                                const searchStr = `image=data:cache/${cacheKey}/${regionName}`
                                console.log(
                                    `[display_diagram] Searching for: ${searchStr}`,
                                )
                                console.log(
                                    `[display_diagram] Found in XML: ${xml.includes(searchStr)}`,
                                )
                                console.log(
                                    `[display_diagram] Data URL has semicolons replaced with %3B`,
                                )

                                // Replace with URL-encoded data URL
                                xml = xml.replace(searchStr, `image=${dataUrl}`)

                                const afterLength = xml.length
                                console.log(
                                    `[display_diagram] Replaced ${regionName}: XML grew by ${afterLength - beforeLength} bytes`,
                                )

                                // Verify replacement worked
                                if (!xml.includes(searchStr)) {
                                    console.log(
                                        `[display_diagram] ✅ Cache URL removed, data URL injected`,
                                    )
                                } else {
                                    console.log(
                                        `[display_diagram] ⚠️ Cache URL still present!`,
                                    )
                                }

                                replacementCount++
                            }
                        }

                        console.log(
                            `[display_diagram] Successfully replaced ${replacementCount} cached images for key: ${cacheKey}`,
                        )
                    } else {
                        const errorText = await response.text()
                        console.error(
                            `[display_diagram] Failed to fetch cache: ${cacheKey}, Status: ${response.status}, Error: ${errorText}`,
                        )
                    }
                } catch (error) {
                    console.error(
                        `[display_diagram] Error fetching cached regions:`,
                        error,
                    )
                }
            }
        }

        // DEBUG: Log a sample of the final XML after cache replacement
        if (cacheMatches.length > 0) {
            const sampleLength = 1000
            const xmlSample = xml.substring(0, sampleLength)
            console.log(
                `[display_diagram] Final XML sample (first ${sampleLength} chars):`,
                xmlSample,
            )

            // Check if base64 data is properly embedded
            const hasCompleteDataUrl = xml.includes("data:image/png;base64,")
            const hasIncompleteDataUrl =
                xml.includes("image=data:image/png;") &&
                !xml.includes("image=data:image/png;base64,")
            console.log(
                `[display_diagram] Has complete data URLs: ${hasCompleteDataUrl}`,
            )
            console.log(
                `[display_diagram] Has incomplete data URLs (missing base64): ${hasIncompleteDataUrl}`,
            )
        }

        // DEBUG: Log raw input to diagnose false truncation detection
        if (DEBUG) {
            console.log(
                "[display_diagram] XML ending (last 100 chars):",
                xml.slice(-100),
            )
            console.log("[display_diagram] XML length:", xml.length)
        }

        // Check if XML is truncated (incomplete mxCell indicates truncated output)
        const isTruncated = !isMxCellXmlComplete(xml)
        if (DEBUG) {
            console.log("[display_diagram] isTruncated:", isTruncated)
        }

        if (isTruncated) {
            // Store the partial XML for continuation via append_diagram
            partialXmlRef.current = xml

            // Tell LLM to use append_diagram to continue
            const partialEnding = partialXmlRef.current.slice(-500)
            addToolOutput({
                tool: "display_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `Output was truncated due to length limits. Use the append_diagram tool to continue.

Your output ended with:
\`\`\`
${partialEnding}
\`\`\`

NEXT STEP: Call append_diagram with the continuation XML.
- Do NOT include wrapper tags or root cells (id="0", id="1")
- Start from EXACTLY where you stopped
- Complete all remaining mxCell elements`,
            })
            return
        }

        // Complete XML received - use it directly
        // (continuation is now handled via append_diagram tool)
        const finalXml = xml
        partialXmlRef.current = "" // Reset any partial from previous truncation

        // Wrap raw XML with full mxfile structure for draw.io
        const fullXml = wrapWithMxFile(finalXml)

        // loadDiagram validates and returns error if invalid
        const validationError = onDisplayChart(fullXml)

        if (validationError) {
            console.warn("[display_diagram] Validation error:", validationError)
            // Return error to model - sendAutomaticallyWhen will trigger retry
            if (DEBUG) {
                console.log(
                    "[display_diagram] Adding tool output with state: output-error",
                )
            }
            addToolOutput({
                tool: "display_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `${validationError}

Please fix the XML issues and call display_diagram again with corrected XML.

Your failed XML:
\`\`\`xml
${finalXml}
\`\`\``,
            })
        } else {
            // Success - diagram will be rendered by chat-message-display
            if (DEBUG) {
                console.log(
                    "[display_diagram] Success! Adding tool output with state: output-available",
                )
            }
            addToolOutput({
                tool: "display_diagram",
                toolCallId: toolCall.toolCallId,
                output: "Successfully displayed the diagram.",
            })
            if (DEBUG) {
                console.log(
                    "[display_diagram] Tool output added. Diagram should be visible now.",
                )
            }
        }
    }

    const handleEditDiagram = async (
        toolCall: ToolCall,
        addToolOutput: AddToolOutputFn,
    ) => {
        const { operations } = toolCall.input as {
            operations: DiagramOperation[]
        }

        let currentXml = ""
        try {
            // Use the original XML captured during streaming (shared with chat-message-display)
            // This ensures we apply operations to the same base XML that streaming used
            const originalXml = editDiagramOriginalXmlRef.current.get(
                toolCall.toolCallId,
            )
            if (originalXml) {
                currentXml = originalXml
            } else {
                // Fallback: use chartXML from ref if streaming didn't capture original
                const cachedXML = chartXMLRef.current
                if (cachedXML) {
                    currentXml = cachedXML
                } else {
                    // Last resort: export from iframe
                    currentXml = await onFetchChart(false)
                }
            }

            const { applyDiagramOperations } = await import("@/lib/utils")
            const { result: editedXml, errors } = applyDiagramOperations(
                currentXml,
                operations,
            )

            // Check for operation errors
            if (errors.length > 0) {
                const errorMessages = errors
                    .map(
                        (e) =>
                            `- ${e.type} on cell_id="${e.cellId}": ${e.message}`,
                    )
                    .join("\n")

                addToolOutput({
                    tool: "edit_diagram",
                    toolCallId: toolCall.toolCallId,
                    state: "output-error",
                    errorText: `Some operations failed:\n${errorMessages}

Current diagram XML:
\`\`\`xml
${currentXml}
\`\`\`

Please check the cell IDs and retry.`,
                })
                // Clean up the shared original XML ref
                editDiagramOriginalXmlRef.current.delete(toolCall.toolCallId)
                return
            }

            // loadDiagram validates and returns error if invalid
            const validationError = onDisplayChart(editedXml)
            if (validationError) {
                console.warn(
                    "[edit_diagram] Validation error:",
                    validationError,
                )
                addToolOutput({
                    tool: "edit_diagram",
                    toolCallId: toolCall.toolCallId,
                    state: "output-error",
                    errorText: `Edit produced invalid XML: ${validationError}

Current diagram XML:
\`\`\`xml
${currentXml}
\`\`\`

Please fix the operations to avoid structural issues.`,
                })
                // Clean up the shared original XML ref
                editDiagramOriginalXmlRef.current.delete(toolCall.toolCallId)
                return
            }
            onExport()
            addToolOutput({
                tool: "edit_diagram",
                toolCallId: toolCall.toolCallId,
                output: `Successfully applied ${operations.length} operation(s) to the diagram.`,
            })
            // Clean up the shared original XML ref
            editDiagramOriginalXmlRef.current.delete(toolCall.toolCallId)
        } catch (error) {
            console.error("[edit_diagram] Failed:", error)

            const errorMessage =
                error instanceof Error ? error.message : String(error)

            addToolOutput({
                tool: "edit_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `Edit failed: ${errorMessage}

Current diagram XML:
\`\`\`xml
${currentXml || "No XML available"}
\`\`\`

Please check cell IDs and retry, or use display_diagram to regenerate.`,
            })
            // Clean up the shared original XML ref even on error
            editDiagramOriginalXmlRef.current.delete(toolCall.toolCallId)
        }
    }

    const handleAppendDiagram = (
        toolCall: ToolCall,
        addToolOutput: AddToolOutputFn,
    ) => {
        const { xml } = toolCall.input as { xml: string }

        // Detect if LLM incorrectly started fresh instead of continuing
        // LLM should only output bare mxCells now, so wrapper tags indicate error
        const trimmed = xml.trim()
        const isFreshStart =
            trimmed.startsWith("<mxGraphModel") ||
            trimmed.startsWith("<root") ||
            trimmed.startsWith("<mxfile") ||
            trimmed.startsWith('<mxCell id="0"') ||
            trimmed.startsWith('<mxCell id="1"')

        if (isFreshStart) {
            addToolOutput({
                tool: "append_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `ERROR: You started fresh with wrapper tags. Do NOT include wrapper tags or root cells (id="0", id="1").

Continue from EXACTLY where the partial ended:
\`\`\`
${partialXmlRef.current.slice(-500)}
\`\`\`

Start your continuation with the NEXT character after where it stopped.`,
            })
            return
        }

        // Append to accumulated XML
        partialXmlRef.current += xml

        // Check if XML is now complete (last mxCell is complete)
        const isComplete = isMxCellXmlComplete(partialXmlRef.current)

        if (isComplete) {
            // Wrap and display the complete diagram
            const finalXml = partialXmlRef.current
            partialXmlRef.current = "" // Reset

            const fullXml = wrapWithMxFile(finalXml)
            const validationError = onDisplayChart(fullXml)

            if (validationError) {
                addToolOutput({
                    tool: "append_diagram",
                    toolCallId: toolCall.toolCallId,
                    state: "output-error",
                    errorText: `Validation error after assembly: ${validationError}

Assembled XML:
\`\`\`xml
${finalXml.substring(0, 2000)}...
\`\`\`

Please use display_diagram with corrected XML.`,
                })
            } else {
                addToolOutput({
                    tool: "append_diagram",
                    toolCallId: toolCall.toolCallId,
                    output: "Diagram assembly complete and displayed successfully.",
                })
            }
        } else {
            // Still incomplete - signal to continue
            addToolOutput({
                tool: "append_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `XML still incomplete (mxCell not closed). Call append_diagram again to continue.

Current ending:
\`\`\`
${partialXmlRef.current.slice(-500)}
\`\`\`

Continue from EXACTLY where you stopped.`,
            })
        }
    }

    return { handleToolCall }
}
