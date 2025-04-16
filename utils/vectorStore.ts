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
  type: 'table' | 'column' | 'relation' | 'rule' | 'documentation' | 'query_example';
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

  // Clear the vector store - removes all existing schema vectors
  async clearVectorStore() {
    console.log('Clearing all schema vectors from the database...');
    const clearTimerId = `clearVectorStore-${Date.now()}`;
    console.time(clearTimerId);
    
    const { error } = await this.supabaseClient
      .from(this.tableName)
      .delete()
      .neq('id', 'dummy_placeholder'); // Delete all rows
    
    if (error) throw new Error(`Failed to clear vector store: ${error.message}`);
    
    // Clear the cache as well
    this.queryCache.clear();
    
    console.timeEnd(clearTimerId);
    console.log('Vector store cleared successfully');
  }

  // Store schema information in the vector store
  async storeSchemaInfo(tables: TableInfo[], constraints: ForeignKeyConstraint[], documentation: string[]) {
    const storeTimerId = `storeSchemaInfo-${Date.now()}`;
    console.time(storeTimerId);
    
    // Prepare arrays to collect content and metadata
    const allContents: string[] = [];
    const contentMappings: {
      id: string; 
      type: 'documentation';
      content: string;
      metadata?: Record<string, any>;
    }[] = [];
    
    console.log(`Processing ${documentation.length} documentation entries for vector storage`);
    
    // Process documentation entries - we don't store tables and columns in the vector store anymore
    for (let i = 0; i < documentation.length; i++) {
      // Add context categorization to documentation
      const enhancedDocumentation = this.enhanceDocumentationWithContext(documentation[i], i);
      const docContent = `Documentation: ${enhancedDocumentation}`;
      
      allContents.push(docContent);
      contentMappings.push({
        id: `documentation_${i}`,
        content: docContent,
        type: 'documentation',
        metadata: { doc_index: i }
      });
    }

    console.log(`Generating embeddings for ${allContents.length} documentation entries in a single batch call`);
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
      table_name: undefined,
      column_name: undefined,
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

  // Helper method to enhance documentation with context categorization
  private enhanceDocumentationWithContext(doc: string, index: number): string {
    // Categorize documentation based on content
    if (doc.includes('table') && doc.includes('attributes') && doc.includes('Key attributes include')) {
      // Table documentation with table name in single quotes
      const tableMatch = doc.match(/'([^']+)'/);
      const tableName = tableMatch ? tableMatch[1] : 'unknown table';
      return `[Table Documentation - ${tableName}] ${doc}`;
    } 
    else if (doc.includes('hierarchy') && doc.includes('->')) {
      return `[Query Pattern] ${doc}`;
    }
    else if (doc.includes('filtering')) {
      return `[Filtering Rule] ${doc}`;
    } 
    else if (doc.includes('score')) {
      return `[Score Calculation] ${doc}`;
    } 
    else if (doc.includes('diocese')) {
      return `[Diocese Information] ${doc}`;
    } 
    else if (doc.includes('user role') || doc.includes('role =') || doc.includes('role id')) {
      return `[User Roles] ${doc}`;
    } 
    else if (doc.includes('academic_year')) {
      return `[Academic Year] ${doc}`;
    }
    else {
      return `[General Documentation] ${doc}`;
    }
  }

  // Get the Supabase client (used for diagnostics)
  getSupabaseClient() {
    return this.supabaseClient;
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
      match_threshold: 0.29,
      match_count: limit
    });
    console.timeEnd(searchVecTimerId);
    
    if (error) {
      console.error('Vector search error:', error);
      throw new Error(`Failed to search vectors: ${error.message}`);
    }
    
    // Store in cache
    this.queryCache.set(cacheKey, { timestamp: now, results: data });
    
    console.log(`Found ${data.length} relevant documentation items with threshold 0.29`);
    // Add detailed logging to show similarity scores
    if (data && data.length > 0) {
      console.log('Similarity scores:');
      data.forEach((item: any, index: number) => {
        console.log(`  ${index + 1}. ${item.content.substring(0, 50)}... | Score: ${item.similarity.toFixed(4)}`);
      });
    }
    
    console.timeEnd(searchTimerId);
    
    return data;
  }
}

// Helper function to add domain-specific descriptions to tables
function getEnhancedTableDescription(table: any): string {
  // Add domain-specific terminology based on table name
  switch (table.tableName) {
    case 'subject_areas':
      return `Related terms: subjects, academic areas, disciplines, curriculum areas, course subjects.
This table contains information about different subject areas taught in Catholic education, such as Religion, Math, Science, etc.`;
      
    case 'testing_centers':
      return `Related terms: schools, assessment centers, test locations, evaluation centers.
This table contains information about schools/enters where educational assessments are administered.`;
      
    case 'dioceses':
      return `Related terms: Catholic dioceses, archdioceses, church districts, episcopal territories.
This table contains information about Catholic dioceses and archdioceses.`;
      
    case 'domains':
      return `Related terms: knowledge domains, subject domains, content areas, knowledge areas, assessment domains.
This table contains information about specific domains of knowledge being assessed.`;
      
    case 'testing_sections':
      return `Related terms: test sections, assessment parts, exam sections, test components.
This table contains information about different sections of assessments or tests.`;
      
    case 'ark_admin_dashes':
      return `Related terms: admin dashboards, administration panels, management interfaces.
This table contains information about administrative dashboards in the ARK system.`;
      
    case 'school_classes':
      return `Related terms: classes, student groups, course sections, grade groups.
This table contains information about school classes or student groups.`;
      
    case 'testing_section_students':
      return `Related terms: student test results, assessment scores, student performance, test outcomes, exam results.
This table contains information about student performance on test sections, including knowledge scores and totals.`;
      
    case 'testing_center_dashboards':
      return `Related terms: testing center analytics, assessment center reports, test center statistics.
This table contains dashboard information for testing centers.`;
      
    case 'tc_grade_levels_snapshot_dcqs':
      return `Related terms: grade level DCQ snapshots, diocesan assessment snapshots by grade, grade level catechetical assessment data.
This table contains diocesan catechetical questionnaire (DCQ) data aggregated by grade levels.`;
      
    case 'tc_grade_levels_snapshots':
      return `Related terms: grade level snapshots, grade assessment summaries, class level performance data.
This table contains assessment performance snapshots aggregated by grade levels.`;
      
    case 'diocese_student_snapshot_dcqs':
      return `Related terms: diocesan student DCQ data, student catechetical questionnaire results, religious assessment data.
This table contains diocesan catechetical questionnaire data for students, including information about mass attendance.`;
      
    case 'diocese_student_snapshot_grade_levels':
      return `Related terms: diocesan grade level snapshots, diocese assessment data by grade, grade level performance in dioceses.
This table contains assessment data for students grouped by grade levels within dioceses.`;
      
    default:
      return '';
  }
} 