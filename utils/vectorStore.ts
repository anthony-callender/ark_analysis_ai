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
  title?: string;
}

// For the structured documentation format
export interface StructuredDocumentation {
  id: string;
  title: string;
  content: string;
  metadata: {
    category: string;
    tables?: string[];
    columns?: string[];
    keywords?: string[];
    question_template?: string;
    question_variants?: string[];
    common_phrasings?: string[];
    context?: {
      report_type?: string;
      audience?: string;
      decision_support?: string;
      frequency?: string;
      theological_focus?: string;
    };
  };
}

// Vector Store class
export class SchemaVectorStore {
  private supabaseClient;
  private embeddings;
  private tableName = 'schema_vectors';
  private queryCache: Map<string, {timestamp: number, results: SchemaVectorEntry[]}> = new Map();
  private CACHE_TTL = 10 * 60 * 1000; // Further reduced from 15 to 10 minutes to free memory faster
  private MAX_CACHE_ENTRIES = 25; // Further reduced from 50 to 25 entries to minimize memory usage
  private lastCleanupTime = 0; // Track last cleanup time to avoid too frequent cleanups

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

  // Enhanced cleanup cache with time-based trigger control
  private cleanupCache() {
    const now = Date.now();
    
    // Only perform full cleanup if it's been at least 30 seconds since last cleanup
    // This prevents excessive CPU usage from too frequent cleanups
    if (now - this.lastCleanupTime < 30000 && this.queryCache.size < this.MAX_CACHE_ENTRIES) {
      return;
    }
    
    this.lastCleanupTime = now;
    let entriesToDelete: string[] = [];
    
    // Identify expired entries
    this.queryCache.forEach((value, key) => {
      if (now - value.timestamp > this.CACHE_TTL) {
        entriesToDelete.push(key);
      }
    });
    
    // Delete expired entries
    entriesToDelete.forEach(key => this.queryCache.delete(key));
    
    // If cache is still too large, remove oldest entries
    if (this.queryCache.size > this.MAX_CACHE_ENTRIES) {
      // Convert to array to sort by timestamp
      const entries = Array.from(this.queryCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      // Remove oldest entries to get back to max size
      const entriesToRemove = entries.slice(0, entries.length - this.MAX_CACHE_ENTRIES);
      entriesToRemove.forEach(entry => this.queryCache.delete(entry[0]));
      
      console.log(`Cleaned up cache: removed ${entriesToRemove.length} oldest entries`);
    }
    
    // Force garbage collection hint (doesn't actually force GC but helps suggest it)
    if (global.gc) {
      try {
        global.gc();
      } catch (e) {
        // Ignore if not available
      }
    }
  }

  // Store schema information in the vector store
  async storeSchemaInfo(
    tables: TableInfo[], 
    constraints: ForeignKeyConstraint[], 
    documentation: string[] | StructuredDocumentation[]
  ) {
    const storeTimerId = `storeSchemaInfo-${Date.now()}`;
    console.time(storeTimerId);
    
    // Prepare arrays to collect content and metadata
    const allContents: string[] = [];
    const contentMappings: {
      id: string; 
      type: 'documentation';
      content: string;
      metadata?: Record<string, any>;
      title?: string;
    }[] = [];
    
    // Check if documentation is in the new structured format or old string format
    const isStructuredFormat = documentation.length > 0 && 
      typeof documentation[0] !== 'string' && 
      'id' in documentation[0] && 
      'title' in documentation[0];
    
    console.log(`Processing ${documentation.length} documentation entries for vector storage`);
    console.log(`Documentation format: ${isStructuredFormat ? 'Structured JSON' : 'Simple string'}`);
    
    if (isStructuredFormat) {
      // Process structured documentation
      const structuredDocs = documentation as StructuredDocumentation[];
      
      for (const doc of structuredDocs) {
        // Create a searchable text that combines title, content and keywords
        const keywordsText = doc.metadata.keywords ? 
          `Keywords: ${doc.metadata.keywords.join(', ')}` : '';
        const tablesText = doc.metadata.tables ? 
          `Tables: ${doc.metadata.tables.join(', ')}` : '';
        const columnsText = doc.metadata.columns ? 
          `Columns: ${doc.metadata.columns.join(', ')}` : '';
        
        // Combine all text for embedding
        const docContent = [
          `Title: ${doc.title}`,
          `Category: ${doc.metadata.category}`,
          `Content: ${doc.content}`,
          keywordsText,
          tablesText,
          columnsText
        ].filter(Boolean).join('\n');
        
        allContents.push(docContent);
        contentMappings.push({
          id: doc.id,
          content: docContent,
          type: 'documentation',
          title: doc.title,
          metadata: {
            ...doc.metadata,
            raw_content: doc.content
          }
        });
      }
    } else {
      // Process legacy string documentation
      const stringDocs = documentation as string[];
      
      for (let i = 0; i < stringDocs.length; i++) {
        // Add context categorization to documentation
        const enhancedDocumentation = this.enhanceDocumentationWithContext(stringDocs[i], i);
        const docContent = `Documentation: ${enhancedDocumentation}`;
        
        allContents.push(docContent);
        contentMappings.push({
          id: `documentation_${i}`,
          content: docContent,
          type: 'documentation',
          metadata: { doc_index: i }
        });
      }
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
      metadata: mapping.metadata,
      title: mapping.title
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

  // Update the main search method to use our optimized search
  public async searchSchemaInfo(query: string, limit: number = 10): Promise<any[]> {
    // Use the optimized search method that applies weighted ranking
    return this.searchSchemaInfoWithOptimizedParams(query, limit);
  }

  // Add a method to tune retrieval settings based on query characteristics
  public async searchSchemaInfoWithOptimizedParams(query: string, limit: number = 10): Promise<any[]> {
    if (!this.supabaseClient) {
      throw new Error('Supabase client not initialized');
    }
    
    // Cleanup cache to prevent memory bloat
    this.cleanupCache();
    
    // Normalize the query to improve cache hits by trimming extra spaces
    const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLowerCase();
    
    // Create a more efficient cache key
    const cacheKey = `${normalizedQuery}:${limit}`;
    const cachedResult = this.queryCache.get(cacheKey);
    if (cachedResult && (Date.now() - cachedResult.timestamp < this.CACHE_TTL)) {
      console.log(`Cache hit for query: "${normalizedQuery.substring(0, 30)}..."`);
      return cachedResult.results;
    }
    
    console.log(`Cache miss for query: "${normalizedQuery.substring(0, 30)}..."`);
    
    // Analyze the query to determine if it's likely a template match
    const isLikelyTemplateQuery = this.isTemplateQuery(normalizedQuery);
    
    // Adjust threshold based on query characteristics
    const matchThreshold = isLikelyTemplateQuery ? 0.25 : 0.29;
    
    // Generate embedding for query
    const embedding = await this.embeddings.embedText(normalizedQuery);
    
    if (!embedding) {
      return [];
    }
    
    // Limit the number of results to avoid memory issues
    const effectiveLimit = Math.min(limit, 10); // Further reduced from 15 to 10 results
    
    // Run similarity search with adjusted parameters
    const { data: matches, error } = await this.supabaseClient.rpc(
      'match_schema_vectors',
      {
        query_embedding: embedding,
        match_threshold: matchThreshold,
        match_count: effectiveLimit
      }
    );
    
    if (error) {
      console.error('Error during vector similarity search:', error);
      return [];
    }
    
    let results = matches || [];
    
    // If it's a likely template query, prioritize template results
    if (isLikelyTemplateQuery && results.length > 0) {
      // Move template results to the top
      const templateResults = results.filter((m: any) => m.id.startsWith('tmpl_'));
      const otherResults = results.filter((m: any) => !m.id.startsWith('tmpl_'));
      
      results = [...templateResults, ...otherResults].slice(0, effectiveLimit);
    }
    
    // Further optimize memory by only keeping essential fields
    const optimizedResults = results.map((result: any) => {
      // Extract only the fields we need, dropping the embedding completely
      const { 
        id, 
        content, 
        type, 
        similarity, 
        table_name, 
        column_name, 
        title 
      } = result;
      
      // Only keep essential metadata fields if present
      const essentialMetadata = result.metadata ? {
        category: result.metadata.category,
        tables: result.metadata.tables,
        columns: result.metadata.columns,
        keywords: result.metadata.keywords,
      } : undefined;
      
      // Return a much smaller object
      return {
        id,
        content,
        type,
        similarity,
        table_name,
        column_name,
        title,
        metadata: essentialMetadata
      };
    });
    
    // Store in cache with current timestamp
    this.queryCache.set(cacheKey, {
      timestamp: Date.now(),
      results: optimizedResults
    });
    
    // Check if cache size exceeds limit after adding new entry
    if (this.queryCache.size > this.MAX_CACHE_ENTRIES) {
      this.cleanupCache();
    }
    
    return optimizedResults;
  }
  
  // Helper method to detect if a query is likely looking for a template
  private isTemplateQuery(query: string): boolean {
    const templateIndicators = [
      'how many', 'what is', 'what are', 'show me', 'tell me', 'calculate', 
      'percentage', 'average', 'correlation', 'compare', 'relationship',
      'trend', 'distribution', 'count', 'score', 'belief', 'report'
    ];
    
    const lowerQuery = query.toLowerCase();
    
    // Check for presence of template indicators
    return templateIndicators.some(indicator => lowerQuery.includes(indicator.toLowerCase()));
  }

  private async storeDocumentationAsVectors(documentation: StructuredDocumentation[]): Promise<number> {
    if (!this.supabaseClient) {
      throw new Error('Supabase client not initialized');
    }

    let totalStored = 0;

    for (const doc of documentation) {
      // Weight templates more heavily by constructing an enhanced text representation
      // that repeats important fields for increased relevance in vector similarity search
      let enhancedContent = doc.content;
      
      // Check if this is a template (question-SQL pair)
      const isTemplate = doc.id.startsWith('tmpl_');
      
      if (isTemplate && doc.metadata) {
        // For templates, create a text representation that emphasizes the question patterns
        // and repeats key metadata to increase its weight in vector search
        
        // Extract question from content (first line after "Question: ")
        const questionMatch = doc.content.match(/Question: (.*?)\n/);
        const questionText = questionMatch ? questionMatch[1] : '';
        
        // Build enhanced text for better semantic matching
        let enhancedText = '';
        
        // Repeat the title and question for higher weight
        enhancedText += `${doc.title}\n${questionText}\n${questionText}\n`;
        
        // Add question variants with high weight (repeat twice)
        if (doc.metadata.question_variants && doc.metadata.question_variants.length > 0) {
          enhancedText += 'Similar questions:\n';
          doc.metadata.question_variants.forEach(variant => {
            enhancedText += `${variant}\n${variant}\n`;
          });
        }
        
        // Add common phrasings
        if (doc.metadata.common_phrasings && doc.metadata.common_phrasings.length > 0) {
          enhancedText += 'Common phrasings:\n';
          doc.metadata.common_phrasings.forEach(phrasing => {
            enhancedText += `${phrasing}\n`;
          });
        }
        
        // Add keywords with high weight
        if (doc.metadata.keywords && doc.metadata.keywords.length > 0) {
          enhancedText += 'Key terms: ';
          enhancedText += doc.metadata.keywords.join(', ');
          enhancedText += '\n';
          // Repeat keywords for extra weight
          enhancedText += 'Key terms: ';
          enhancedText += doc.metadata.keywords.join(', ');
          enhancedText += '\n';
        }
        
        // Add context information if available
        if (doc.metadata.context) {
          const ctx = doc.metadata.context;
          enhancedText += `Context: ${ctx.report_type || ''} ${ctx.audience || ''} ${ctx.decision_support || ''} ${ctx.theological_focus || ''}\n`;
        }
        
        // Add category with high weight (repeat twice for emphasis)
        if (doc.metadata.category) {
          enhancedText += `Category: ${doc.metadata.category}\n`;
          enhancedText += `Category: ${doc.metadata.category}\n`;
        }
        
        // Add tables and columns
        if (doc.metadata.tables && doc.metadata.tables.length > 0) {
          enhancedText += `Tables: ${doc.metadata.tables.join(', ')}\n`;
        }
        
        if (doc.metadata.columns && doc.metadata.columns.length > 0) {
          enhancedText += `Columns: ${doc.metadata.columns.join(', ')}\n`;
        }
        
        // Combine the enhanced text with the original content
        // This preserves the SQL query information while emphasizing question patterns
        enhancedContent = enhancedText + '\n' + doc.content;
      }

      // Generate embedding for the enhanced content
      const embedding = await this.embeddings.embedText(enhancedContent);
      
      if (embedding) {
        // Store in schema_vectors table
        const { error } = await this.supabaseClient
          .from(this.tableName)
          .insert({
            id: doc.id,
            content: doc.content,
            embedding: embedding,
            type: 'documentation',
            title: doc.title,
            metadata: doc.metadata || {}
          });
        
        if (error) {
          console.error(`Error storing documentation vector: ${doc.id}`, error);
        } else {
          totalStored++;
        }
      }
    }
    
    return totalStored;
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