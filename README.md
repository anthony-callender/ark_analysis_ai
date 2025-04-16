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

# ARK Analysis AI Vector Store Optimization

This document provides instructions for rebuilding the vector store with a filtered set of target tables to improve retrieval performance.

## Filtered Target Tables

The application has been optimized to focus only on these key tables:

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

## Improvements Made

1. **Focused Table Selection**: Reduced the number of tables to only those most relevant to common queries.
2. **Enhanced Descriptions**: Added domain-specific terminology to table and column descriptions.
3. **Lower Similarity Threshold**: Reduced the match threshold from 0.7 to 0.5 to capture more potential matches.
4. **Improved Semantic Context**: Added alternative phrasings for columns like `knowledge_score` and `attend_mass`.
5. **Complete System Consistency**: All tools consistently filter to target tables only.

## Tool Consistency Updates

All tools have been updated to maintain consistency with the target tables approach:

1. **getPublicTablesWithColumns**: Only returns the target tables
2. **getForeignKeyConstraints**: Only returns constraints between target tables
3. **getTableStats**: Only returns statistics for target tables
4. **getIndexes**: Only returns indexes for target tables
5. **getIndexStatsUsage**: Only returns index usage for target tables
6. **getExplainForQuery**: Warns if non-target tables are referenced in queries

This ensures that the model only works with the tables that are available in the vector store, preventing confusion or inconsistent results.

## How to Rebuild the Vector Store

1. Start your application:
   ```
   npm run dev
   ```

2. Trigger the vector store rebuild by visiting:
   ```
   http://localhost:3000/api/chat?action=rebuild_vectors
   ```

3. Make a new query in the application. The vector store will be rebuilt with only the target tables when the first query is made after clearing.

## Troubleshooting

If you're still getting "0 relevant schema items" for certain queries:

1. Check if your query terminology aligns with the schema descriptions
2. Review the server logs to see the similarity scores
3. Consider adding more domain-specific terms to the table/column descriptions in `utils/vectorStore.ts`

## Testing Your Queries

After rebuilding the vector store, try these example queries:

1. "What is the average knowledge score for students who attend mass?"
2. "Show me test performance by diocese"
3. "Which testing centers have the highest scores?"

These should now return relevant schema information with the optimized vector store.
