import { NextResponse } from "next/server"

// Declare global cache (same as in chat route)
declare global {
    var extractedRegionsCache: Map<string, Record<string, string>> | undefined
}

export async function POST(req: Request) {
    try {
        const { cacheKey } = await req.json()

        console.log(`[get-cached-regions] Request for cache key: ${cacheKey}`)

        if (!cacheKey || typeof cacheKey !== "string") {
            return NextResponse.json(
                { error: "Invalid cache key" },
                { status: 400 },
            )
        }

        // Retrieve from global cache
        if (!global.extractedRegionsCache) {
            console.error(`[get-cached-regions] Cache not initialized`)
            return NextResponse.json(
                { error: "Cache not initialized" },
                { status: 404 },
            )
        }

        const regionMapping = global.extractedRegionsCache.get(cacheKey)

        if (!regionMapping) {
            console.error(
                `[get-cached-regions] Cache key not found: ${cacheKey}`,
            )
            console.log(
                `[get-cached-regions] Available keys:`,
                Array.from(global.extractedRegionsCache.keys()),
            )
            return NextResponse.json(
                { error: "Cache expired or not found" },
                { status: 404 },
            )
        }

        const regionNames = Object.keys(regionMapping)
        console.log(
            `[get-cached-regions] Found ${regionNames.length} regions:`,
            regionNames,
        )

        // Log first 50 chars of each data URL for verification
        for (const [name, dataUrl] of Object.entries(regionMapping)) {
            console.log(
                `[get-cached-regions]   ${name}: ${dataUrl.substring(0, 50)}... (${dataUrl.length} bytes)`,
            )
        }

        return NextResponse.json({
            success: true,
            regions: regionMapping,
        })
    } catch (error) {
        console.error("[get-cached-regions] Error:", error)
        return NextResponse.json(
            { error: "Failed to retrieve cached regions" },
            { status: 500 },
        )
    }
}
