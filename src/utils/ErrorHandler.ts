import Logger from './Logger';

/**
 * エラータイプの列挙型
 */
export enum ErrorType {
  DISCORD_ERROR = 'DISCORD_ERROR',
  DISCORD_RATE_LIMIT = 'DISCORD_RATE_LIMIT',
  NOTION_ERROR = 'NOTION_ERROR',
  OPENAI_ERROR = 'OPENAI_ERROR',
  OPENAI_RATE_LIMIT = 'OPENAI_RATE_LIMIT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * アプリケーション固有のエラークラス
 */
export class AppError extends Error {
  /**
   * AppErrorのコンストラクタ
   * @param type エラータイプ
   * @param message エラーメッセージ
   * @param originalError 元のエラー（オプション）
   * @param statusCode HTTPステータスコード（オプション）
   * @param retryable 再試行可能かどうか
   */
  constructor(
    public type: ErrorType,
    message: string,
    public originalError?: Error,
    public statusCode: number = 500,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * エラー処理を行うユーティリティクラス
 */
export default class ErrorHandler {
  private logger: Logger;

  /**
   * ErrorHandlerのコンストラクタ
   * @param component エラーが発生したコンポーネント名
   */
  constructor(component: string) {
    this.logger = new Logger(component);
  }

  /**
   * エラーを処理し、適切なAppErrorに変換する
   * @param error 発生したエラー
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
    } else if (this.isDiscordError(err)) {
      appError = new AppError(
        ErrorType.DISCORD_ERROR,
        'Discordエラー',
        err,
        500,
        false
      );
    } else if (this.isOpenAIRateLimitError(err)) {
      appError = new AppError(
        ErrorType.OPENAI_RATE_LIMIT,
        'OpenAI APIレート制限エラー',
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
    } else if (this.isNotionError(err)) {
      appError = new AppError(
        ErrorType.NOTION_ERROR,
        'Notion APIエラー',
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
   * エラーをログに出力
   * @param error 出力するエラー
   */
  private logError(error: AppError): void {
    this.logger.error(`${error.type}: ${error.message}`, {
      statusCode: error.statusCode,
      retryable: error.retryable,
      originalError: error.originalError ? {
        name: error.originalError.name,
        message: error.originalError.message,
        stack: error.originalError.stack
      } : undefined
    });
  }

  /**
   * Discordのレート制限エラーかどうかを判定
   * @param error エラーオブジェクト
   * @returns レート制限エラーかどうか
   */
  private isDiscordRateLimitError(error: Error): boolean {
    return error.message?.includes('rate limit') === true &&
           error.message?.includes('discord') === true;
  }

  /**
   * Discord関連のエラーかどうかを判定
   * @param error エラーオブジェクト
   * @returns Discord関連のエラーかどうか
   */
  private isDiscordError(error: Error): boolean {
    return error.message?.includes('discord') === true ||
           error.stack?.includes('discord') === true;
  }

  /**
   * OpenAIのレート制限エラーかどうかを判定
   * @param error エラーオブジェクト
   * @returns レート制限エラーかどうか
   */
  private isOpenAIRateLimitError(error: Error): boolean {
    const messageIncludes = (str: string) => error.message?.includes(str) === true;
    const stackIncludes = (str: string) => error.stack?.includes(str) === true;
    
    return (messageIncludes('rate limit') ||
            messageIncludes('rate_limit') ||
            messageIncludes('rate_limited') ||
            messageIncludes('too many requests')) &&
           (messageIncludes('openai') ||
            stackIncludes('openai'));
  }

  /**
   * OpenAI関連のエラーかどうかを判定
   * @param error エラーオブジェクト
   * @returns OpenAI関連のエラーかどうか
   */
  private isOpenAIError(error: Error): boolean {
    return error.message?.includes('openai') === true ||
           error.stack?.includes('openai') === true;
  }

  /**
   * Notion関連のエラーかどうかを判定
   * @param error エラーオブジェクト
   * @returns Notion関連のエラーかどうか
   */
  private isNotionError(error: Error): boolean {
    return error.message?.includes('notion') === true ||
           error.stack?.includes('notion') === true ||
           error.message?.includes('database') === true;
  }

  /**
   * ネットワークエラーかどうかを判定
   */
  private isNetworkError(error: Error): boolean {
    return error.message.includes('network') || 
           error.message.includes('ECONNREFUSED') || 
           error.message.includes('ETIMEDOUT') ||
           error.message.includes('fetch failed');
  }

  /**
   * バリデーションエラーかどうかを判定
   */
  private isValidationError(error: Error): boolean {
    return error.message.includes('validation') || 
           error.message.includes('invalid') ||
           error.message.includes('required');
  }

  /**
   * ユーザーフレンドリーなエラーメッセージを生成
   * @param error 発生したエラー
   * @returns ユーザー向けエラーメッセージ
   */
  getUserFriendlyMessage(error: AppError): string {
    switch (error.type) {
      case ErrorType.DISCORD_RATE_LIMIT:
        return '申し訳ありません、現在リクエストが多く処理できません。しばらく経ってからお試しください。';
      
      case ErrorType.DISCORD_ERROR:
        return 'Discordとの通信中にエラーが発生しました。しばらく経ってからお試しください。';
      
      case ErrorType.OPENAI_RATE_LIMIT:
      case ErrorType.OPENAI_ERROR:
        return 'AIサービスとの通信中にエラーが発生しました。しばらく経ってからお試しください。';
      
      case ErrorType.NOTION_ERROR:
        return 'データベース検索中にエラーが発生しました。管理者にお問い合わせください。';
      
      case ErrorType.NETWORK_ERROR:
        return 'ネットワークエラーが発生しました。インターネット接続を確認してください。';
      
      case ErrorType.VALIDATION_ERROR:
        return '入力内容に問題があります。入力内容を確認して再度お試しください。';
      
      default:
        return '予期せぬエラーが発生しました。管理者にお問い合わせください。';
    }
  }
}
