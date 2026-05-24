import Foundation
import FoundationModels

struct SourceLink: Codable {
    let source_name: String
    let url: String
}

enum UniqueAnglesValue: Codable {
    case string(String)
    case array([String])
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let arr = try? container.decode([String].self) {
            self = .array(arr)
        } else if let str = try? container.decode(String.self) {
            self = .string(str)
        } else {
            throw DecodingError.typeMismatch(UniqueAnglesValue.self, DecodingError.Context(codingPath: decoder.codingPath, debugDescription: "Expected String or Array of Strings for uniqueAngles"))
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let str):
            try container.encode([str]) // Always encode as an array for backend/frontend compatibility
        case .array(let arr):
            try container.encode(arr)
        }
    }
}

struct MasterStory: Codable {
    let masterTitle: String
    let coreSummaryBullets: [String]
    let sourceOutlets: [SourceLink]
    let uniqueAngles: UniqueAnglesValue?
    let tags: [String]?
}

struct ArticleInput: Codable {
    let title: String
    let source_name: String
    let url: String
    let summary: String
}

struct InputData: Codable {
    let articles: [ArticleInput]
}

// Execution Entrypoint
do {
    let inputData = FileHandle.standardInput.readDataToEndOfFile()
    if inputData.isEmpty {
        fputs("Error: Stdin is empty\n", stderr)
        exit(1)
    }
    
    let decoder = JSONDecoder()
    let input = try decoder.decode(InputData.self, from: inputData)
    
    if input.articles.isEmpty {
        fputs("Error: No articles provided in input JSON\n", stderr)
        exit(1)
    }
    
    var prompt = """
    You are an expert news aggregator. Summarize and consolidate the following articles into a single cohesive story.
    You MUST respond with a raw JSON object matching the following structure exactly, with NO other text, markdown blocks, or commentary:
    
    {
      "masterTitle": "Unified story title",
      "coreSummaryBullets": [
        "Core summary point 1 [SourceName]",
        "Core summary point 2 [SourceName]"
      ],
      "sourceOutlets": [
        {"source_name": "SourceName", "url": "URL"}
      ],
      "uniqueAngles": [
        "Optional differing perspective text"
      ],
      "tags": [
        "CategoryTag1",
        "CategoryTag2"
      ]
    }
    
    Rules:
    1. 'masterTitle': A single unified title representing the news.
    2. 'coreSummaryBullets': 2-4 comprehensive bullet points. Each bullet point MUST track its facts back to their source, adding explicit inline markers like "[SourceName]" at the end of the sentence or fact.
    3. 'sourceOutlets': Compile the unique sources and URLs from the input.
    4. 'uniqueAngles': Call out any distinct takes, unique editorial angles, or conflicting information between different sites (e.g. "While Source A reports X, Source B reports Y"). If all sources report exactly the same facts with no differing perspectives or it is a single article, set this to null or leave empty.
    5. 'tags': Generate 1-3 appropriate category tags for the story (e.g., "Apple Intelligence", "iOS 18", "Rumor") and place them in the 'tags' array.
    
    """
    
    if input.articles.count == 1 {
        let article = input.articles[0]
        prompt += """
        
        There is only one article. Set 'uniqueAngles' to null.
        Article Title: \(article.title)
        Source: \(article.source_name)
        URL: \(article.url)
        Content/Summary: \(article.summary)
        """
    } else {
        prompt += "\nArticles to merge:\n"
        for (index, article) in input.articles.enumerated() {
            prompt += """
            
            --- Article \(index + 1) ---
            Title: \(article.title)
            Source: \(article.source_name)
            URL: \(article.url)
            Content/Summary: \(article.summary)
            """
        }
    }
    
    let session = LanguageModelSession()
    let response = try await session.respond(to: prompt)
    
    // Clean markdown code blocks if the model wrapped the JSON in ```json ... ```
    var jsonText = response.content.trimmingCharacters(in: .whitespacesAndNewlines)
    if jsonText.hasPrefix("```") {
        if let firstLineEnd = jsonText.firstIndex(of: "\n") {
            jsonText = String(jsonText[firstLineEnd...])
        }
        if jsonText.hasSuffix("```") {
            jsonText = String(jsonText.dropLast(3))
        }
        jsonText = jsonText.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    
    // Validate by decoding
    let storyData = jsonText.data(using: .utf8) ?? Data()
    do {
        let story = try decoder.decode(MasterStory.self, from: storyData)
        
        // Re-encode pretty printed to stdout
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        let outputData = try encoder.encode(story)
        if let outputString = String(data: outputData, encoding: .utf8) {
            print(outputString)
        } else {
            fputs("Error: Could not convert validated JSON to UTF-8 string\n", stderr)
            exit(1)
        }
    } catch {
        fputs("Error during JSON decoding: \(error.localizedDescription)\n", stderr)
        fputs("Raw LLM output was:\n\(response.content)\n", stderr)
        exit(1)
    }
} catch {
    fputs("Error: \(error.localizedDescription)\n", stderr)
    exit(1)
}
