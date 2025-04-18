# Chat with your database

The AI that really knows your postgres DB

## How to use

1. Clone the repository

2. Create a `.env.local` file with the following environment variables:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
OPENAI_API_KEY=your-openai-api-key
```

3. Install dependencies

```bash
pnpm install
```

4. Run the development server

```bash
pnpm run dev
```

### It let's you:

#### Get statistics about your database

![Get statistics about your database](/stats.png)

#### Ask it to generate SQL

![Ask it to generate SQL](/sql.png)

#### Run SQL

![Run SQL](/run-sql.png)

### This project uses:
- [Supabase](https://supabase.com/) for the database and auth
- [Next.js](https://nextjs.org/) for the framework
- [Vercel](https://vercel.com/) for the deployment
- [OpenAI](https://openai.com/) for the AI
- [Geist](https://vercel.com/font) for the Font
- [Tailwind](https://tailwindcss.com/) for the CSS
- [Shadcn](https://ui.shadcn.com/) for the UI
- [Aceternity](https://aceternity.com/) for the UI

# ARK Analysis AI Schema Optimization

This document provides instructions for the optimized schema approach in the ARK Analysis AI application.

## Streamlined Architecture

The application has been optimized with a streamlined approach:

1. **Direct Table Access**: The application provides direct access to all 13 key tables via `getPublicTablesWithColumns`
2. **Vector-Based Documentation Retrieval**: The vector store contains ONLY documentation, not table/column information
3. **Comprehensive Documentation**: Includes table descriptions, query patterns, and schema guidance
4. **Balanced Similarity Threshold**: Uses a 0.29 threshold for better relevance without losing important context

## Target Tables

The application focuses exclusively on these key tables:

```
- subject_areas
- testing_centers
- dioceses
- domains
- testing_sections
- ark_admin_dashes
- school_classes
- testing_section_students
- testing_center_dashboards
- tc_grade_levels_snapshot_dcqs
- tc_grade_levels_snapshots
- diocese_student_snapshot_dcqs
- diocese_student_snapshot_grade_levels
```

## Documentation Content

The vector store includes rich documentation:

1. **Table Documentation**: Detailed descriptions of each table's purpose and columns
2. **Query Patterns**: Hierarchical relation patterns for common query types
3. **Schema Guidance**: Rules for filtering, score calculation, and table usage
4. **Domain Knowledge**: Information about academic years, roles, and domain-specific knowledge

## Architecture Benefits

This hybrid approach offers several advantages:

1. **Deterministic Table Access**: The LLM always has access to a complete, consistent list of tables
2. **Semantic Documentation Matching**: Vector search finds only the most relevant documentation for each query
3. **Structured Knowledge Base**: Documentation is categorized by type and topic
4. **Tool-Specific Roles**: Each tool has a clear, focused purpose

## Tool Consistency

All tools consistently filter to target tables only:

1. **getPublicTablesWithColumns**: Returns all 13 target tables and their columns
2. **getRelevantDocumentation**: Returns only documentation relevant to the query
3. **getForeignKeyConstraints**: Returns only constraints between target tables
4. **getTableStats**: Returns statistics for target tables only
5. **getIndexes**: Returns indexes for target tables only
6. **getIndexStatsUsage**: Returns index usage for target tables only
7. **getExplainForQuery**: Warns if non-target tables are referenced

## How to Rebuild the Vector Store

1. Start your application:
   ```
   npm run dev
   ```

2. Trigger the vector store rebuild by visiting:
   ```
   http://localhost:3000/api/chat?action=rebuild_vectors
   ```

3. Make a new query in the application to see the new architecture in action.

## Test Documentation Retrieval

To test how documentation is retrieved for specific queries:

```
http://localhost:3000/api/chat?action=test_retrieval&query=your query here
```

This endpoint shows:
- All documentation in the vector store
- Documentation retrieved for your specific query
- Similarity scores for each match

## Testing Your Queries

After rebuilding the vector store, try these example queries:

1. "What is the average knowledge score for students who attend mass?"
2. "Show me test performance by diocese"
3. "Which testing centers have the highest scores?"
4. "What is the hierarchy for queries about subject performance?"
5. "How do I get information for the 2023 academic year?"

These should now work effectively with the comprehensive documentation in the vector store.

## Structured Documentation Format

The application now uses a structured JSON format for documentation entries, which significantly improves retrieval relevance. This replaces the previous plaintext format with a more organized approach:

```json
{
  "id": "chunk_id",
  "title": "Concise title describing the content",
  "content": "The main content of the documentation entry",
  "metadata": {
    "category": "Category for grouping related items",
    "tables": ["table1", "table2"],
    "columns": ["column1", "column2"],
    "keywords": ["keyword1", "keyword2"],
    "question_template": "Optional template for common questions"
  }
}
```

### Benefits of Structured Documentation

1. **Better Semantic Search**: Keywords field helps bridge vocabulary gaps between user queries and documentation
2. **Improved Context**: Each chunk contains related information without overwhelming with irrelevant details
3. **Clear Categorization**: Filtering and grouping of related information by type and purpose
4. **Enhanced Specificity**: Explicit listing of tables and columns makes database relationships clearer

### Documentation Categories

Documentation is organized into these categories:
- **Table docs**: Database table descriptions and structure
- **Query‑writing rules**: Guidelines for writing effective SQL
- **Filtering rules**: Rules for properly filtering data
- **Hierarchy**: Joins and table relationships for common questions
- **Reference tables**: ID mappings and reference data
- **Score rules**: Formulas for calculating scores
- **Time windows**: Rules for handling time-based queries
- **Domain scores**: Information about domain-specific scoring
- **Naming rules**: Conventions for naming and terminology
- **Report templates**: Ready-to-use SQL queries for common reporting needs, including question and SQL implementation

To modify the structured documentation, edit the array in `app/api/chat/route.ts` or use the sample JSON in `tmp/structured_documentation.json`.

### Loading Structured Documentation

To load the structured documentation format into your vector store:

1. Make sure your structured documentation is saved in `tmp/structured_documentation.json`
2. Run the loader script:
   ```
   node scripts/load_structured_documentation.js
   ```
3. Visit the test endpoint to verify the documentation was loaded correctly:
   ```
   http://localhost:3000/api/chat?action=test_retrieval&query=your query
   ```

This script clears the existing vector store and loads the new structured documentation, along with your database schema information.

### Updating Database Schema

Before using the structured documentation format, you need to update your database schema to include the new `title` column:

1. Run the database schema update:
   ```
   http://localhost:3000/api/chat?action=update_schema
   ```

2. After updating the schema, rebuild the vector store with the structured documentation:
   ```
   http://localhost:3000/api/chat?action=rebuild_vectors
   ```

This update adds the `title` column to the `schema_vectors` table and updates the `match_schema_vectors` function to include this column in its results.
