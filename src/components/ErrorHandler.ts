import Logger from './Logger';

/**
 * エラーの種類を定義する列挙型
 */
export enum ErrorType {
  DISCORD_RATE_LIMIT = 'DISCORD_RATE_LIMIT',
  OPENAI_ERROR = 'OPENAI_ERROR',
  NOTION_MCP_ERROR = 'NOTION_MCP_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * アプリケーション固有のエラークラス
 */
export class AppError extends Error {
  constructor(
    public type: ErrorType,
    message: string,
    public originalError?: Error,
    public statusCode?: number,
    public retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * アプリケーション全体でのエラー処理を担当するクラス
 */
export class ErrorHandler {
  private logger: Logger;

  /**
   * ErrorHandlerインスタンスを初期化
   * @param component - エラーが発生したコンポーネント名
   * @param traceId - リクエストの追跡ID（オプション）
   */
  constructor(component: string, traceId?: string) {
    this.logger = new Logger(`ErrorHandler:${component}`, traceId);
  }

  /**
   * エラーを処理し、適切なAppErrorに変換する
   * @param error - 発生したエラー
   * @returns 処理されたAppError
   */
  handle(error: unknown): AppError {
    // すでにAppErrorの場合はそのまま返す
    if (error instanceof AppError) {
      this.logError(error);
      return error;
    }

    // エラーオブジェクトに変換
    const err = error instanceof Error ? error : new Error(String(error));
    
    // エラータイプを判定
    let appError: AppError;
    
    if (this.isDiscordRateLimitError(err)) {
      appError = new AppError(
        ErrorType.DISCORD_RATE_LIMIT,
        'Discordレート制限エラー',
        err,
        429,
        true
      );
    } else if (this.isOpenAIError(err)) {
      appError = new AppError(
        ErrorType.OPENAI_ERROR,
        'OpenAI APIエラー',
        err,
        500,
        true
      );
    } else if (this.isNotionMCPError(err)) {
      appError = new AppError(
        ErrorType.NOTION_MCP_ERROR,
        'Notion MCP APIエラー',
        err,
        500,
        true
      );
    } else if (this.isNetworkError(err)) {
      appError = new AppError(
        ErrorType.NETWORK_ERROR,
        'ネットワークエラー',
        err,
        503,
        true
      );
    } else if (this.isValidationError(err)) {
      appError = new AppError(
        ErrorType.VALIDATION_ERROR,
        'バリデーションエラー',
        err,
        400,
        false
      );
    } else {
      appError = new AppError(
        ErrorType.UNKNOWN_ERROR,
        '不明なエラー',
        err,
        500,
        false
      );
    }

    this.logError(appError);
    return appError;
  }

  /**
   * エラーをログに記録
   * @param error - 記録するエラー
   */
  private logError(error: AppError): void {
    this.logger.error(
      `[${error.type}] ${error.message}`,
      error.originalError,
      {
        statusCode: error.statusCode,
        retryable: error.retryable,
      }
    );
  }

  /**
   * Discordのレート制限エラーかどうかを判定
   */
  private isDiscordRateLimitError(error: Error): boolean {
    return error.message.includes('rate limit') || 
           error.message.includes('429') ||
           error.name === 'DiscordAPIError[RateLimited]';
  }

  /**
   * OpenAI APIのエラーかどうかを判定
   */
  private isOpenAIError(error: Error): boolean {
    return error.message.includes('openai') || 
           error.name.includes('OpenAI');
  }

  /**
   * Notion MCP APIのエラーかどうかを判定
   */
  private isNotionMCPError(error: Error): boolean {
    return error.message.includes('notion') || 
           error.message.includes('mcp');
  }

  /**
   * ネットワークエラーかどうかを判定
   */
  private isNetworkError(error: Error): boolean {
    return error.message.includes('network') || 
           error.message.includes('ECONNREFUSED') ||
           error.message.includes('ETIMEDOUT') ||
           error.message.includes('socket hang up');
  }

  /**
   * バリデーションエラーかどうかを判定
   */
  private isValidationError(error: Error): boolean {
    return error.message.includes('validation') || 
           error.message.includes('invalid') ||
           error.name.includes('ValidationError');
  }

  /**
   * ユーザーフレンドリーなエラーメッセージを生成
   * @param error - 発生したエラー
   * @returns ユーザー向けエラーメッセージ
   */
  getUserFriendlyMessage(error: AppError): string {
    switch (error.type) {
      case ErrorType.DISCORD_RATE_LIMIT:
        return '申し訳ありません、現在リクエストが多く処理できません。しばらく経ってからお試しください。';
      
      case ErrorType.OPENAI_ERROR:
        return 'AIサービスとの通信中にエラーが発生しました。しばらく経ってからお試しください。';
      
      case ErrorType.NOTION_MCP_ERROR:
        return 'データベース検索中にエラーが発生しました。管理者にお問い合わせください。';
      
      case ErrorType.NETWORK_ERROR:
        return 'ネットワークエラーが発生しました。インターネット接続を確認してください。';
      
      case ErrorType.VALIDATION_ERROR:
        return '入力内容に問題があります。質問内容を確認して再度お試しください。';
      
      default:
        return '予期せぬエラーが発生しました。管理者にお問い合わせください。';
    }
  }
}

export default ErrorHandler;
