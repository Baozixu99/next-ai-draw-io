import { type NextRequest, NextResponse } from "next/server"
import sharp from "sharp"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * API endpoint to extract/crop regions from an uploaded image
 *
 * POST /api/extract-regions
 * Body: {
 *   imageUrl: string,  // Base64 data URL or HTTP URL
 *   regions: Array<{
 *     name: string,    // e.g., "hand", "heatmap", "circuit"
 *     x: number,       // X coordinate (pixels)
 *     y: number,       // Y coordinate (pixels)
 *     width: number,   // Width (pixels)
 *     height: number   // Height (pixels)
 *   }>
 * }
 *
 * Response: {
 *   success: boolean,
 *   regions: Array<{
 *     name: string,
 *     dataUrl: string  // Base64 data URL of cropped region
 *   }>
 * }
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const { imageUrl, regions } = body

        console.log("[Extract Regions] Received request:", {
            imageUrlLength: imageUrl?.length,
            regionsCount: regions?.length,
            imageUrlPrefix: imageUrl?.substring(0, 100),
            imageUrlType: imageUrl?.startsWith("data:")
                ? "base64"
                : imageUrl?.startsWith("http")
                  ? "http"
                  : "unknown",
        })

        if (!imageUrl || !regions || !Array.isArray(regions)) {
            console.error("[Extract Regions] Invalid request:", {
                imageUrl: !!imageUrl,
                regions: Array.isArray(regions),
            })
            return NextResponse.json(
                { error: "Missing imageUrl or regions array" },
                { status: 400 },
            )
        }

        // Convert image URL to buffer
        let imageBuffer: Buffer

        if (imageUrl.startsWith("data:")) {
            // Handle base64 data URL
            console.log("[Extract Regions] Processing base64 data URL")
            const base64Data = imageUrl.split(",")[1]
            if (!base64Data) {
                console.error(
                    "[Extract Regions] Invalid base64 format - no comma separator found",
                )
                throw new Error("Invalid base64 data URL format")
            }
            console.log(
                "[Extract Regions] Base64 data length:",
                base64Data.length,
            )
            imageBuffer = Buffer.from(base64Data, "base64")
            console.log(
                "[Extract Regions] Image buffer size:",
                imageBuffer.length,
                "bytes",
            )
        } else if (imageUrl.startsWith("http")) {
            // Handle HTTP URL
            console.log(
                "[Extract Regions] Downloading from HTTP URL:",
                imageUrl.substring(0, 80),
            )
            try {
                const response = await fetch(imageUrl)
                if (!response.ok) {
                    const errorMsg = `Failed to fetch image: ${response.status} ${response.statusText}`
                    console.error(
                        "[Extract Regions]",
                        errorMsg,
                        "URL:",
                        imageUrl,
                    )

                    // Provide helpful error message
                    if (response.status === 404) {
                        return NextResponse.json(
                            {
                                error: "Image not found (404). Please ensure you're using the uploaded image URL from the current conversation, not an external web link.",
                                details:
                                    "The image URL might be expired or invalid. Try uploading the image again via the paperclip icon.",
                            },
                            { status: 400 },
                        )
                    }

                    throw new Error(errorMsg)
                }
                const arrayBuffer = await response.arrayBuffer()
                imageBuffer = Buffer.from(arrayBuffer)
                console.log(
                    "[Extract Regions] Downloaded image:",
                    imageBuffer.length,
                    "bytes",
                )
            } catch (fetchError) {
                console.error(
                    "[Extract Regions] Failed to download image:",
                    fetchError,
                )
                return NextResponse.json(
                    {
                        error: `Failed to download image: ${fetchError}`,
                        suggestion:
                            "Please use the image URL from your uploaded file (via paperclip icon), not external web URLs.",
                    },
                    { status: 500 },
                )
            }
        } else {
            console.error(
                "[Extract Regions] Invalid URL format:",
                imageUrl.substring(0, 50),
            )
            return NextResponse.json(
                {
                    error: "Invalid image URL format. Must start with 'data:' or 'http'",
                },
                { status: 400 },
            )
        }

        // Get image dimensions first
        const imageMetadata = await sharp(imageBuffer).metadata()
        const imageWidth = imageMetadata.width || 0
        const imageHeight = imageMetadata.height || 0
        console.log(
            "[Extract Regions] Image dimensions:",
            imageWidth,
            "x",
            imageHeight,
        )
        console.log("[Extract Regions] Image format:", imageMetadata.format)
        console.log("[Extract Regions] Image color space:", imageMetadata.space)
        console.log("[Extract Regions] Processing", regions.length, "regions")

        // Track which regions were adjusted for better feedback
        const adjustmentWarnings: string[] = []

        // Process each region with boundary checking
        const extractedRegions = await Promise.all(
            regions.map(async (region) => {
                try {
                    // Clamp coordinates to image boundaries
                    const x = Math.max(
                        0,
                        Math.min(Math.round(region.x), imageWidth - 1),
                    )
                    const y = Math.max(
                        0,
                        Math.min(Math.round(region.y), imageHeight - 1),
                    )
                    const width = Math.max(
                        1,
                        Math.min(Math.round(region.width), imageWidth - x),
                    )
                    const height = Math.max(
                        1,
                        Math.min(Math.round(region.height), imageHeight - y),
                    )

                    // Log if coordinates were adjusted
                    if (
                        x !== Math.round(region.x) ||
                        y !== Math.round(region.y) ||
                        width !== Math.round(region.width) ||
                        height !== Math.round(region.height)
                    ) {
                        const warning = `Region '${region.name}' adjusted: (${region.x},${region.y},${region.width}×${region.height}) → (${x},${y},${width}×${height})`
                        console.log(`[Extract Regions] ${warning}`)
                        adjustmentWarnings.push(warning)
                    }

                    // Crop the region using sharp
                    const croppedBuffer = await sharp(imageBuffer)
                        .extract({
                            left: x,
                            top: y,
                            width: width,
                            height: height,
                        })
                        .png() // Convert to PNG for consistent format
                        .toBuffer()

                    // Convert to base64 data URL
                    const base64 = croppedBuffer.toString("base64")
                    const dataUrl = `data:image/png;base64,${base64}`

                    return {
                        name: region.name,
                        dataUrl: dataUrl,
                        dimensions: {
                            width: width,
                            height: height,
                        },
                    }
                } catch (error) {
                    console.error(
                        `[Extract Regions] Error processing region ${region.name}:`,
                        error,
                    )
                    return {
                        name: region.name,
                        error: `Failed to extract region: ${error}`,
                    }
                }
            }),
        )

        return NextResponse.json({
            success: true,
            imageDimensions: {
                width: imageWidth,
                height: imageHeight,
            },
            adjustmentWarnings:
                adjustmentWarnings.length > 0 ? adjustmentWarnings : undefined,
            regions: extractedRegions,
        })
    } catch (error) {
        console.error("[Extract Regions] Error:", error)
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 },
        )
    }
}
