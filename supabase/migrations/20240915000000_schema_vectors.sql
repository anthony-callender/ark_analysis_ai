-- Enable the pgvector extension if it's not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Function to create the schema_vectors table if it doesn't exist
CREATE OR REPLACE FUNCTION create_schema_vectors_table_if_not_exists()
RETURNS void AS $$
BEGIN
  -- Check if the table exists
  IF NOT EXISTS (
    SELECT FROM pg_tables 
    WHERE schemaname = 'public' 
    AND tablename = 'schema_vectors'
  ) THEN
    -- Create the table for storing schema information vectors
    CREATE TABLE public.schema_vectors (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      embedding VECTOR(1536) NOT NULL,
      table_name TEXT,
      column_name TEXT,
      metadata JSONB
    );

    -- Create an index for fast vector similarity search
    CREATE INDEX schema_vectors_embedding_idx ON public.schema_vectors
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to match schema vectors by similarity
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
  metadata JSONB
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
    sv.metadata
  FROM
    schema_vectors sv
  WHERE
    1 - (sv.embedding <=> query_embedding) > match_threshold
  ORDER BY
    sv.embedding <=> query_embedding
  LIMIT match_count;
END;
$$; 