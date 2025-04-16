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
