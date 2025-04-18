-- Add title column to schema_vectors table
ALTER TABLE public.schema_vectors 
ADD COLUMN IF NOT EXISTS title TEXT;

-- Update the match_schema_vectors function to return the title column
CREATE OR REPLACE FUNCTION match_schema_vectors(
  query_embedding VECTOR(1536),
  match_threshold FLOAT,
  match_count INT
)
RETURNS TABLE (
  id TEXT,
  content TEXT,
  type TEXT,
  similarity FLOAT,
  table_name TEXT,
  column_name TEXT,
  metadata JSONB,
  title TEXT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sv.id,
    sv.content,
    sv.type,
    1 - (sv.embedding <=> query_embedding) as similarity,
    sv.table_name,
    sv.column_name,
    sv.metadata,
    sv.title
  FROM
    schema_vectors sv
  WHERE
    1 - (sv.embedding <=> query_embedding) > match_threshold
  ORDER BY
    sv.embedding <=> query_embedding
  LIMIT match_count;
END;
$$; 