# Database Schema Vector Store Implementation

This implementation replaces the large hardcoded system prompt with a vector store approach for more efficient context retrieval in the PostgreSQL Query Generator.

## Features

- **Reduced Token Usage**: Only retrieves relevant schema information as needed
- **Better Scaling**: Can easily handle growing schema without prompt size limits
- **Improved Relevance**: Returns only information pertinent to the current query
- **RAG Architecture**: Implements Retrieval-Augmented Generation for database schema

## Implementation Components

### 1. Vector Store (Supabase pgvector)

- Uses pgvector extension to store embeddings
- Stores schema information in `schema_vectors` table
- Creates embeddings for tables, columns, relationships, and rules
- Fast similarity search using vector indices

### 2. OpenAI Embeddings

- Uses `text-embedding-3-small` for generating embeddings
- Implements single and batch embedding methods
- Provides consistent vector representation of schema concepts

### 3. Schema Information Types

The system stores various types of information:
- **Table definitions**: Names, schemas, columns, and descriptions
- **Column details**: Types, nullability, and references
- **Foreign key relationships**: Join paths and constraints
- **Schema rules**: Best practices and requirements

### 4. Retrieval Process

When a user makes a query:
1. The system generates an embedding for the user's query
2. It searches the vector store for most similar schema information
3. Relevant context is injected into the prompt for SQL generation
4. The AI generates a SQL query with only necessary context
5. The query is evaluated with that same context

## Setup Requirements

1. Supabase project with pgvector extension enabled
2. Run the migration script in `supabase/migrations/20240915000000_schema_vectors.sql`
3. Environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`

## Usage

The system automatically:
1. Retrieves database schema information via `getPublicTablesWithColumns`
2. Stores it in the vector database
3. For each query, retrieves only relevant schema context

## Benefits Over Previous Approach

- **Reduced Costs**: Uses fewer tokens per query
- **More Accurate Responses**: Only includes relevant schema details
- **Better Performance**: Less token overhead means faster responses
- **Improved Scalability**: Can adapt to larger database schemas
- **Future-Proofing**: Easy to update with new tables/schema changes 