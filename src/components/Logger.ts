import pino from 'pino';
import pinoNoir from 'pino-noir';

// 秘匿情報をマスクするための設定
const redactedKeys = ['DISCORD_TOKEN', 'OPENAI_API_KEY', 'MCP_API_KEY', 'token', 'api_key'];

// 環境変数からログレベルを取得、デフォルトはinfo
const logLevel = process.env.LOG_LEVEL || 'info';

// Loggerの設定
const logger = pino({
  level: logLevel,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  },
  serializers: {
    ...pino.stdSerializers,
    // 秘匿情報をマスクする
    ...pinoNoir(redactedKeys, { censor: '***REDACTED***' }),
  },
  base: {
    pid: process.pid,
    hostname: process.env.RENDER_SERVICE_NAME || 'notion-mcp-discord-bot',
  },
});

/**
 * アプリケーション全体で使用するロガークラス
 */
export class Logger {
  private traceId: string;
  
  /**
   * Loggerインスタンスを初期化
   * @param component - ログを出力するコンポーネント名
   * @param traceId - リクエストの追跡ID（オプション）
   */
  constructor(private component: string, traceId?: string) {
    this.traceId = traceId || this.generateTraceId();
  }

  /**
   * ランダムなトレースIDを生成
   */
  private generateTraceId(): string {
    return `trace-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * 情報レベルのログを出力
   * @param message - ログメッセージ
   * @param data - 追加データ（オプション）
   */
  info(message: string, data?: Record<string, unknown>): void {
    logger.info({
      component: this.component,
      traceId: this.traceId,
      ...data,
    }, message);
  }

  /**
   * 警告レベルのログを出力
   * @param message - ログメッセージ
   * @param data - 追加データ（オプション）
   */
  warn(message: string, data?: Record<string, unknown>): void {
    logger.warn({
      component: this.component,
      traceId: this.traceId,
      ...data,
    }, message);
  }

  /**
   * エラーレベルのログを出力
   * @param message - ログメッセージ
   * @param error - エラーオブジェクト（オプション）
   * @param data - 追加データ（オプション）
   */
  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    logger.error({
      component: this.component,
      traceId: this.traceId,
      error: error ? {
        message: error.message,
        stack: error.stack,
        name: error.name,
      } : undefined,
      ...data,
    }, message);
  }

  /**
   * デバッグレベルのログを出力
   * @param message - ログメッセージ
   * @param data - 追加データ（オプション）
   */
  debug(message: string, data?: Record<string, unknown>): void {
    logger.debug({
      component: this.component,
      traceId: this.traceId,
      ...data,
    }, message);
  }
}

export default Logger;
