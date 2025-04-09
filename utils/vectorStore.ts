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
    const vectorEntries: SchemaVectorEntry[] = [];
    
    // Process tables and columns
    for (const table of tables) {
      // Create a vector for the table
      const tableContent = `Table: ${table.tableName}
Schema: ${table.schemaName}
Description: ${table.description ? 
  `This table ${table.description.requiresDioceseFilter ? 'requires diocese filtering' : 'does not require diocese filtering'}.
Join path: ${table.description.joinPath}
Has direct diocese column: ${table.description.hasDirectDioceseColumn}
Example: ${table.description.example}` : 'No description available'
}
Columns: ${table.columns.map(col => col.name).join(', ')}`;

      const tableEmbedding = await this.embeddings.embedText(tableContent);
      
      vectorEntries.push({
        id: `table_${table.tableName}`,
        content: tableContent,
        type: 'table',
        embedding: tableEmbedding,
        table_name: table.tableName,
        metadata: {
          schema: table.schemaName,
          description: table.description
        }
      });

      // Create vectors for each column
      for (const column of table.columns) {
        const columnContent = `Column: ${column.name}
Table: ${table.tableName}
Type: ${column.type}
Nullable: ${column.isNullable}
Description: ${column.description || 'No description available'}`;

        const columnEmbedding = await this.embeddings.embedText(columnContent);
        
        vectorEntries.push({
          id: `column_${table.tableName}_${column.name}`,
          content: columnContent,
          type: 'column',
          embedding: columnEmbedding,
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

      const relationEmbedding = await this.embeddings.embedText(relationContent);
      
      vectorEntries.push({
        id: `relation_${constraint.constraintName}`,
        content: relationContent,
        type: 'relation',
        embedding: relationEmbedding,
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
      const ruleEmbedding = await this.embeddings.embedText(ruleContent);
      
      vectorEntries.push({
        id: `rule_${i}`,
        content: ruleContent,
        type: 'rule',
        embedding: ruleEmbedding,
        metadata: { rule_index: i }
      });
    }

    // Insert all vector entries in batches
    const batchSize = 100;
    for (let i = 0; i < vectorEntries.length; i += batchSize) {
      const batch = vectorEntries.slice(i, i + batchSize);
      const { error } = await this.supabaseClient
        .from(this.tableName)
        .upsert(batch, { onConflict: 'id' });
      
      if (error) throw new Error(`Failed to store vectors: ${error.message}`);
    }

    return vectorEntries.length;
  }

  // Search the vector store for relevant schema information
  async searchSchemaInfo(query: string, limit: number = 10): Promise<SchemaVectorEntry[]> {
    const queryEmbedding = await this.embeddings.embedText(query);
    
    const { data, error } = await this.supabaseClient.rpc('match_schema_vectors', {
      query_embedding: queryEmbedding,
      match_threshold: 0.7,
      match_count: limit
    });
    
    if (error) throw new Error(`Failed to search vectors: ${error.message}`);
    
    return data;
  }
} 