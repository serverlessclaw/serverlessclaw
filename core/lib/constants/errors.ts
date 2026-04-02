/**
 * Common Error Messages.
 */
export const AGENT_ERRORS = {
  PROCESS_FAILURE:
    "I encountered an internal error during my cognitive processing cycle and was unable to fulfill your request. This has been logged as a strategic gap for my system's next evolution cycle, and my engineering team will review it. Please try again or rephrase your query.",
  CONNECTION_FAILURE:
    'SYSTEM_ERROR: Connection interrupted or internal failure. Technical details logged as strategic gap.',
} as const;

/**
 * Chinese translations for common error messages.
 */
export const AGENT_ERRORS_CN = {
  PROCESS_FAILURE:
    '在我的认知处理周期中遇到了内部错误，无法完成您的请求。这已作为我系统下一次进化周期的战略缺口记录，我的工程团队将进行审查。请重试或重新说明您的查询。',
  CONNECTION_FAILURE: '系统错误：连接中断或内部故障。技术细节已记录为战略缺口。',
} as const;

/**
 * Common error prefixes for failure detection across languages.
 */
export const AGENT_ERROR_PREFIXES = {
  EN: 'I encountered an internal error',
  CN: '在我的认知处理周期中遇到了内部错误',
} as const;
