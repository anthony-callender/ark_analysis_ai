import { createClient } from '@supabase/supabase-js'
import { OpenAIEmbeddings } from './openaiEmbeddings'

// Define schema information types
interface ColumnInfo {
  name: string;
  type: string;
  isNullable: boolean;
  description?: string;
}

export interface TableInfo {
  tableName: string;
  schemaName: string;
  columns: ColumnInfo[];
  description?: {
    requiresDioceseFilter: boolean;
    joinPath: string;
    hasDirectDioceseColumn: boolean;
    example: string;
  };
}

export interface ForeignKeyConstraint {
  constraintName: string;
  tableName: string;
  columnName: string;
  foreignTableName: string;
  foreignColumnName: string;
}

export interface SchemaVectorEntry {
  id: string;
  content: string;
  type: 'table' | 'column' | 'relation' | 'rule' | 'query_example';
  embedding: number[];
  table_name?: string;
  column_name?: string;
  metadata?: Record<string, any>;
}

// Vector Store class
export class SchemaVectorStore {
  private supabaseClient;
  private embeddings;
  private tableName = 'schema_vectors';
  private queryCache: Map<string, {timestamp: number, results: SchemaVectorEntry[]}> = new Map();
  private CACHE_TTL = 30 * 60 * 1000; // 30 minutes in milliseconds

  constructor(supabaseUrl: string, supabaseKey: string, openaiApiKey: string) {
    this.supabaseClient = createClient(supabaseUrl, supabaseKey);
    this.embeddings = new OpenAIEmbeddings(openaiApiKey);
  }

  // Initialize the vector store - creates the table if it doesn't exist
  async initialize() {
    const { error } = await this.supabaseClient.rpc('create_schema_vectors_table_if_not_exists');
    if (error) throw new Error(`Failed to initialize vector store: ${error.message}`);
  }

  // Store schema information in the vector store
  async storeSchemaInfo(tables: TableInfo[], constraints: ForeignKeyConstraint[], rules: string[]) {
    const storeTimerId = `storeSchemaInfo-${Date.now()}`;
    console.time(storeTimerId);
    // Prepare arrays to collect content and metadata
    const allContents: string[] = [];
    const contentMappings: {
      id: string; 
      type: 'table' | 'column' | 'relation' | 'rule';
      content: string;
      table_name?: string;
      column_name?: string;
      metadata?: Record<string, any>;
    }[] = [];
    
    console.log(`Processing ${tables.length} tables, ${constraints.length} constraints, and ${rules.length} rules`);
    
    // Process tables and columns
    for (const table of tables) {
      // Create content for the table
      const tableContent = `Table: ${table.tableName}
Schema: ${table.schemaName}
Description: ${table.description ? 
  `This table ${table.description.requiresDioceseFilter ? 'requires diocese filtering' : 'does not require diocese filtering'}.
Join path: ${table.description.joinPath}
Has direct diocese column: ${table.description.hasDirectDioceseColumn}
Example: ${table.description.example}` : 'No description available'
}
Columns: ${table.columns.map(col => col.name).join(', ')}`;

      // Add to arrays
      allContents.push(tableContent);
      contentMappings.push({
        id: `table_${table.tableName}`,
        content: tableContent,
        type: 'table',
        table_name: table.tableName,
        metadata: {
          schema: table.schemaName,
          description: table.description
        }
      });

      // Process columns
      for (const column of table.columns) {
        const columnContent = `Column: ${column.name}
Table: ${table.tableName}
Type: ${column.type}
Nullable: ${column.isNullable}
Description: ${column.description || 'No description available'}`;

        allContents.push(columnContent);
        contentMappings.push({
          id: `column_${table.tableName}_${column.name}`,
          content: columnContent,
          type: 'column',
          table_name: table.tableName,
          column_name: column.name,
          metadata: {
            data_type: column.type,
            is_nullable: column.isNullable
          }
        });
      }
    }

    // Process foreign key constraints
    for (const constraint of constraints) {
      const relationContent = `Relation:
Table: ${constraint.tableName} 
Column: ${constraint.columnName}
References: ${constraint.foreignTableName}.${constraint.foreignColumnName}
Constraint Name: ${constraint.constraintName}`;

      allContents.push(relationContent);
      contentMappings.push({
        id: `relation_${constraint.constraintName}`,
        content: relationContent,
        type: 'relation',
        metadata: {
          table_name: constraint.tableName,
          column_name: constraint.columnName,
          foreign_table: constraint.foreignTableName,
          foreign_column: constraint.foreignColumnName
        }
      });
    }

    // Process rules
    for (let i = 0; i < rules.length; i++) {
      const ruleContent = `Rule: ${rules[i]}`;
      
      allContents.push(ruleContent);
      contentMappings.push({
        id: `rule_${i}`,
        content: ruleContent,
        type: 'rule',
        metadata: { rule_index: i }
      });
    }

    console.log(`Generating embeddings for ${allContents.length} items in a single batch call`);
    const batchTimerId = `batchEmbedding-${Date.now()}`;
    console.time(batchTimerId);
    
    // Generate all embeddings in a single API call
    const allEmbeddings = await this.embeddings.embedBatch(allContents);
    
    console.timeEnd(batchTimerId);
    
    // Create vector entries by combining content mappings with embeddings
    const vectorEntries: SchemaVectorEntry[] = contentMappings.map((mapping, index) => ({
      id: mapping.id,
      content: mapping.content,
      type: mapping.type,
      embedding: allEmbeddings[index],
      table_name: mapping.table_name,
      column_name: mapping.column_name,
      metadata: mapping.metadata
    }));

    // Insert all vector entries in batches
    console.log(`Storing ${vectorEntries.length} vector entries in batches`);
    const batchesTimerId = `storeBatches-${Date.now()}`;
    console.time(batchesTimerId);
    
    // Deduplicate entries by ID before insertion
    const idMap = new Map<string, SchemaVectorEntry>();
    for (const entry of vectorEntries) {
      idMap.set(entry.id, entry);
    }
    const uniqueEntries = Array.from(idMap.values());
    console.log(`Removed ${vectorEntries.length - uniqueEntries.length} duplicate entries`);

    const batchSize = 100;
    for (let i = 0; i < uniqueEntries.length; i += batchSize) {
      const batch = uniqueEntries.slice(i, i + batchSize);
      const { error } = await this.supabaseClient
        .from(this.tableName)
        .upsert(batch, { onConflict: 'id' });
      
      if (error) throw new Error(`Failed to store vectors: ${error.message}`);
    }
    
    console.timeEnd(batchesTimerId);
    console.timeEnd(storeTimerId);
    
    return uniqueEntries.length;
  }

  // Search the vector store for relevant schema information
  async searchSchemaInfo(query: string, limit: number = 10): Promise<SchemaVectorEntry[]> {
    const searchTimerId = `searchSchemaInfo-${Date.now()}`;
    console.time(searchTimerId);
    
    // Check if we have this query in cache
    const cacheKey = `${query}-${limit}`;
    const cached = this.queryCache.get(cacheKey);
    const now = Date.now();
    
    // If cache exists and is still valid
    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      console.log('Using cached results for query:', query);
      console.timeEnd(searchTimerId);
      return cached.results;
    }
    
    console.log('Generating embedding for query:', query);
    const queryTimerId = `queryEmbedding-${Date.now()}`;
    console.time(queryTimerId);
    const queryEmbedding = await this.embeddings.embedText(query);
    console.timeEnd(queryTimerId);
    
    console.log('Performing vector search');
    const searchVecTimerId = `vectorSearch-${Date.now()}`;
    console.time(searchVecTimerId);
    const { data, error } = await this.supabaseClient.rpc('match_schema_vectors', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: limit
    });
    console.timeEnd(searchVecTimerId);
    
    if (error) {
      console.error('Vector search error:', error);
      throw new Error(`Failed to search vectors: ${error.message}`);
    }
    
    // Store in cache
    this.queryCache.set(cacheKey, { timestamp: now, results: data });
    
    console.log(`Found ${data.length} relevant schema items`);
    console.timeEnd(searchTimerId);
    
    return data;
  }
} 