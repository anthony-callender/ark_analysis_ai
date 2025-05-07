'use client'

import { Check, Copy, BarChart3 } from 'lucide-react'
import { useState, useEffect, useCallback, useRef, memo } from 'react'

import { Button } from '@/components/ui/button'
import { runSql } from '@/actions/run-sql'
import { toast } from '@/hooks/use-toast'
import { DynamicChart } from '@/components/dynamic-chart'
import { generateChartConfig } from '@/actions/chart'
import type { Config, Result } from '@/lib/chart'

import type { QueryResult } from 'pg'
import SqlResult from './sql-result'
import Prism from 'prismjs'
import 'prismjs/components/prism-sql'
import 'prismjs/themes/prism-okaidia.css'

const convertToResult = (rows: unknown[]): Result[] => {
  return rows.map((row) => {
    if (typeof row === 'object' && row !== null) {
      return Object.entries(row).reduce((acc, [key, value]) => {
        acc[key] = value as string | number
        return acc
      }, {} as Result)
    }
    throw new Error('Invalid row data')
  })
}

// Memoized result component to prevent re-renders
const MemoizedSqlResult = memo(({ result }: { result: QueryResult<unknown[]> | string }) => {
  return <SqlResult result={result} />;
});

// Memoized chart button
const ChartButton = memo(({ onClick, disabled }: { onClick: () => void, disabled: boolean }) => {
  return (
    <Button
      size={'sm'}
      variant={'outline'}
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2"
    >
      <BarChart3 className="w-4 h-4" />
      Show Chart
    </Button>
  );
});

// Maintain a global map of in-flight SQL requests to avoid duplicates
// This exists outside component state to persist across renders
const pendingRequests = new Map<string, Promise<any>>();

// Main component with memoization to prevent unnecessary re-renders
const CodeBlock = memo(function CodeBlock({
  children,
  language,
  sqlResult,
  setSqlResult,
  isDisabled,
  connectionString,
  autoRun = true,
  showSqlCode = true,
}: {
  children: React.ReactNode
  language?: string
  sqlResult?: QueryResult<unknown[]> | string
  setSqlResult: (result: QueryResult<unknown[]> | string) => void
  isDisabled?: boolean
  connectionString: string
  autoRun?: boolean
  showSqlCode?: boolean
}) {
  // Use refs to track the mounted state and prevent memory leaks
  const isMountedRef = useRef(true);
  const animationFrameRef = useRef<number | null>(null);
  
  // Store whether we've already executed this SQL
  const executedRef = useRef(false);
  
  useEffect(() => {
    // Set mounted flag
    isMountedRef.current = true;
    
    // Clear any pending animation frames
    return () => {
      isMountedRef.current = false;
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Reset execution state when SQL content changes
  useEffect(() => {
    if (children?.toString() !== queryRef.current) {
      executedRef.current = false;
    }
  }, [children]);

  useEffect(() => {
    // Use a stable timer to highlight code only once per render cycle
    const timer = setTimeout(() => {
      if (isMountedRef.current) {
        Prism.highlightAll();
      }
    }, 0);
    
    return () => clearTimeout(timer);
  }, [children]);

  const [copied, setCopied] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const [chartConfig, setChartConfig] = useState<Config | null>(null)
  const [isChartLoading, setIsChartLoading] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [hasRun, setHasRun] = useState(false)
  // Create stable run ID that doesn't change on re-renders
  const runIdRef = useRef<string>(`${Date.now()}_${Math.random().toString(36).substring(2, 11)}`)
  const queryRef = useRef<string | null>(null)
  // Track visible loading state separately to avoid flashing
  const [visibleLoading, setVisibleLoading] = useState(false);
  
  // If this specific query already has a result, don't re-run it
  useEffect(() => {
    if (sqlResult && children) {
      const query = children.toString();
      queryRef.current = query;
      executedRef.current = true;
      setHasRun(true);
    }
  }, [sqlResult, children]);
  
  // Delayed loading indicator to prevent flashing on quick responses
  useEffect(() => {
    let loadingTimer: NodeJS.Timeout | null = null;
    
    if (isLoading) {
      loadingTimer = setTimeout(() => {
        if (isMountedRef.current && isLoading) {
          setVisibleLoading(true);
        }
      }, 300); // Only show loading state after 300ms
    } else {
      setVisibleLoading(false);
    }
    
    return () => {
      if (loadingTimer) clearTimeout(loadingTimer);
    };
  }, [isLoading]);

  // Generate a stable request ID for deduplication
  const getRequestId = useCallback((query: string) => {
    return `${query.trim()}_${connectionString.substring(0, 50)}`;
  }, [connectionString]);

  const run = useCallback(async () => {
    if (!children?.toString()) {
      toast({
        title: 'No SQL query provided',
        description: 'Please provide a valid SQL query',
      })
      return
    }
    
    const query = children?.toString();
    
    // Skip if we've already run this exact query or if it's already been executed
    if ((queryRef.current === query && hasRun) || executedRef.current) {
      return;
    }
    
    // Generate request ID for deduplication
    const requestId = getRequestId(query);
    
    // If this exact request is already in flight, wait for it instead of creating a new one
    if (pendingRequests.has(requestId)) {
      console.log('Reusing in-flight SQL request');
      try {
        // Wait for the existing request
        const result = await pendingRequests.get(requestId);
        if (isMountedRef.current) {
          queryRef.current = query;
          setHasRun(true);
          executedRef.current = true;
          setSqlResult?.(result);
        }
      } catch (error) {
        console.error('Error from shared request:', error);
      }
      return;
    }
    
    queryRef.current = query;
    setIsLoading(true);
    setHasRun(true);
    executedRef.current = true;

    // Store current runId to check if this run is still relevant when it completes
    const currentRunId = runIdRef.current;
    
    // Create the request promise
    const requestPromise = (async () => {
      try {
        const sqlFunctionBinded = runSql.bind(
          null,
          query,
          connectionString
        );
        const result = await sqlFunctionBinded();
        
        try {
          return JSON.parse(result);
        } catch {
          return result;
        }
      } catch (error) {
        console.error('SQL execution error:', error);
        throw error;
      } finally {
        // Remove from pending requests when done
        setTimeout(() => {
          pendingRequests.delete(requestId);
        }, 50);
      }
    })();
    
    // Store the request
    pendingRequests.set(requestId, requestPromise);

    try {
      // Check if component still mounted and wants this result
      if (!isMountedRef.current || currentRunId !== runIdRef.current) {
        return;
      }
      
      const result = await requestPromise;
      
      // Use requestAnimationFrame to batch updates and prevent flashing
      animationFrameRef.current = requestAnimationFrame(() => {
        if (!isMountedRef.current) return;
        
        setSqlResult?.(result);
        
        // Delay loading state removal slightly to avoid flashing
        setTimeout(() => {
          if (isMountedRef.current) {
            setIsLoading(false);
          }
        }, 50);
      });
    } catch (error) {
      console.error('SQL execution error:', error);
      
      // Show toast only if this is the current run and component is mounted
      if (isMountedRef.current && currentRunId === runIdRef.current) {
        toast({
          title: 'SQL Execution Error',
          description: error instanceof Error ? error.message : 'Failed to execute SQL query',
          variant: 'destructive',
        });
        
        // Set loading to false with slight delay
        setTimeout(() => {
          if (isMountedRef.current) {
            setIsLoading(false);
          }
        }, 50);
      }
    }
  }, [children, connectionString, setSqlResult, hasRun, getRequestId]);

  // Effect to handle auto-running SQL queries - with proper clean up
  useEffect(() => {
    // Reset run status when query changes
    if (children?.toString() !== queryRef.current) {
      setHasRun(false);
      runIdRef.current = `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }
    
    let runTimer: NodeJS.Timeout | null = null;
    
    // Only auto-run when needed and not already processed
    if (language === 'sql' && autoRun && !hasRun && !isDisabled && children?.toString() && !executedRef.current) {
      // Small delay to batch UI updates and prevent flashing
      runTimer = setTimeout(() => {
        if (isMountedRef.current) {
          run();
        }
      }, 100);
    }
    
    return () => {
      if (runTimer) clearTimeout(runTimer);
    };
  }, [language, children, isDisabled, autoRun, run, hasRun]);

  const copyToClipboard = async () => {
    try {
      navigator.clipboard.writeText(children as string)
      setCopied(true)
      setTimeout(() => {
        setCopied(false)
      }, 1000)
    } catch (error) {
      console.error('Failed to copy to clipboard', error)
    }
  }

  const handleShowChart = async () => {
    if (!sqlResult || typeof sqlResult === 'string') return

    setIsChartLoading(true)
    try {
      const rows = convertToResult(sqlResult.rows)
      const { config } = await generateChartConfig(
        rows,
        children?.toString() || ''
      )
      setChartConfig(config)
      setShowChart(true)
    } catch (error) {
      toast({
        title: 'Error generating chart',
        description: 'Could not generate a chart for this data',
        variant: 'destructive',
      })
    }
    setIsChartLoading(false)
  }

  // For inline code blocks - return fast
  if (
    language !== 'sql' &&
    typeof children === 'string' &&
    children.length < 40
  ) {
    return (
      <span className="bg-[#121211] text-[#f8f8f2] inline-block p-1 rounded-sm font-mono">
        {children}
      </span>
    )
  }

  return (
    <div className="flex flex-col my-3 gap-2">
      {showSqlCode && (
        <div className="relative">
          <div className="absolute right-2 top-4">
            <div className="w-4 h-4">
              {copied ? (
                <Check size={15} className="text-green-500" />
              ) : (
                <Copy
                  size={15}
                  onClick={copyToClipboard}
                  className="cursor-pointer text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                />
              )}
            </div>
          </div>
          <pre className="!bg-prima !text-[#f8f8f2] w-full !p-5 !pt-8 text-sm rounded-md overflow-auto">
            <code className={`language-${language ?? 'markup'}`}>{children}</code>
          </pre>
        </div>
      )}
      
      {visibleLoading ? (
        <div className="w-full h-32 bg-primary opacity-20 rounded-md animate-pulse" />
      ) : sqlResult ? (
        <>
          <MemoizedSqlResult result={sqlResult} />
          {typeof sqlResult !== 'string' && sqlResult.rows?.length > 0 && (
            <>
              {!showChart && (
                <ChartButton 
                  onClick={handleShowChart} 
                  disabled={isChartLoading} 
                />
              )}
              {showChart && chartConfig && (
                <div className="mt-4">
                  <DynamicChart
                    chartData={convertToResult(sqlResult.rows)}
                    chartConfig={chartConfig}
                  />
                </div>
              )}
            </>
          )}
        </>
      ) : null}

      {language === 'sql' && !autoRun && showSqlCode && (
        <Button
          disabled={isDisabled || isLoading}
          aria-disabled={isDisabled || isLoading}
          size={'sm'}
          variant={'outline'}
          onClick={run}
        >
          {isLoading ? 'Running...' : 'Run SQL'}
        </Button>
      )}
    </div>
  )
});

export default CodeBlock;