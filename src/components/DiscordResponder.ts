import { Message, MessageCreateOptions, REST, Routes } from 'discord.js';
import Logger from './Logger';
import ErrorHandler, { AppError, ErrorType } from './ErrorHandler';

/**
 * Discordへの応答を管理するクラス
 */
export class DiscordResponder {
  private logger: Logger;
  private errorHandler: ErrorHandler;
  private rest: REST;
  private applicationId: string;
  private maxRetries: number;
  private maxMessageLength: number;

  /**
   * DiscordResponderインスタンスを初期化
   * @param token - Discord Bot Token
   * @param applicationId - Discord Application ID
   * @param maxRetries - 最大リトライ回数（デフォルト: 3）
   * @param maxMessageLength - 最大メッセージ長（デフォルト: 2000）
   */
  constructor(
    token: string,
    applicationId: string,
    maxRetries = 3,
    maxMessageLength = 2000
  ) {
    this.logger = new Logger('DiscordResponder');
    this.errorHandler = new ErrorHandler('DiscordResponder');
    this.rest = new REST({ version: '10' }).setToken(token);
    this.applicationId = applicationId;
    this.maxRetries = maxRetries;
    this.maxMessageLength = maxMessageLength;
  }

  /**
   * Discordチャンネルにメッセージを送信
   * @param channelId - 送信先チャンネルID
   * @param content - 送信するメッセージ内容
   * @returns 送信成功時はtrue
   * @throws 送信に失敗した場合にエラー
   */
  async sendMessage(
    channelId: string,
    content: string
  ): Promise<boolean> {
    let retries = 0;
    let lastError: unknown;

    while (retries <= this.maxRetries) {
      try {
        this.logger.info(`Discordメッセージ送信開始 (試行: ${retries + 1}/${this.maxRetries + 1})`, {
          channelId,
          contentLength: content.length,
        });

        // メッセージが長すぎる場合は分割
        if (content.length > this.maxMessageLength) {
          return await this.sendLongMessage(channelId, content);
        }

        const startTime = Date.now();
        
        // Discord REST APIを使用してメッセージを送信
        await this.rest.post(
          Routes.channelMessages(channelId),
          { body: { content } }
        );
        
        const duration = Date.now() - startTime;
        
        this.logger.info(`Discordメッセージ送信完了`, { duration });
        return true;
      } catch (error) {
        lastError = error;
        
        // レート制限エラーの場合は待機してリトライ
        if (this.isRateLimitError(error)) {
          retries++;
          
          // 最大リトライ回数に達した場合はエラーをスロー
          if (retries > this.maxRetries) {
            const appError = this.errorHandler.handle(error);
            throw appError;
          }
          
          // Retry-Afterヘッダーに従って待機
          const retryAfter = this.getRetryAfterTime(error) || 5000; // デフォルト5秒
          this.logger.warn(`Discordレート制限、待機します`, {
            retryCount: retries,
            retryAfter,
          });
          
          await new Promise(resolve => setTimeout(resolve, retryAfter));
        } else {
          // その他のエラーの場合はすぐにエラーをスロー
          const appError = this.errorHandler.handle(error);
          throw appError;
        }
      }
    }

    // 予期せぬエラー（ここには到達しないはず）
    const appError = this.errorHandler.handle(lastError);
    throw appError;
  }

  /**
   * 元のメッセージに返信
   * @param message - 返信元のDiscordメッセージ
   * @param content - 返信内容
   * @returns 送信成功時はtrue
   */
  async reply(
    message: Message,
    content: string
  ): Promise<boolean> {
    try {
      this.logger.info('メッセージに返信します', {
        channelId: message.channelId,
        messageId: message.id,
        contentLength: content.length,
      });

      // メッセージが長すぎる場合は分割
      if (content.length > this.maxMessageLength) {
        return await this.sendLongReply(message, content);
      }

      // discord.jsのMessage.replyメソッドを使用
      await message.reply(content);
      
      return true;
    } catch (error) {
      // エラーをハンドリング
      const appError = this.errorHandler.handle(error);
      
      // レート制限エラーの場合は通常のメッセージとして送信を試みる
      if (appError.type === ErrorType.DISCORD_RATE_LIMIT) {
        this.logger.warn('返信でレート制限エラー、通常メッセージとして送信を試みます');
        return await this.sendMessage(message.channelId, content);
      }
      
      throw appError;
    }
  }

  /**
   * 長いメッセージを分割して送信
   * @param channelId - 送信先チャンネルID
   * @param content - 送信するメッセージ内容
   * @returns 送信成功時はtrue
   */
  private async sendLongMessage(
    channelId: string,
    content: string
  ): Promise<boolean> {
    try {
      // メッセージを分割
      const parts = this.splitMessage(content);
      
      this.logger.info(`長いメッセージを分割して送信します`, {
        channelId,
        partCount: parts.length,
      });

      // 各部分を順番に送信
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const prefix = parts.length > 1 ? `[${i + 1}/${parts.length}] ` : '';
        
        await this.rest.post(
          Routes.channelMessages(channelId),
          { body: { content: prefix + part } }
        );
        
        // 連続送信による429エラーを避けるために少し待機
        if (i < parts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      return true;
    } catch (error) {
      const appError = this.errorHandler.handle(error);
      throw appError;
    }
  }

  /**
   * 長い返信メッセージを分割して送信
   * @param message - 返信元のDiscordメッセージ
   * @param content - 返信内容
   * @returns 送信成功時はtrue
   */
  private async sendLongReply(
    message: Message,
    content: string
  ): Promise<boolean> {
    try {
      // メッセージを分割
      const parts = this.splitMessage(content);
      
      this.logger.info(`長い返信を分割して送信します`, {
        channelId: message.channelId,
        partCount: parts.length,
      });

      // 最初の部分は返信として送信
      const prefix = parts.length > 1 ? `[1/${parts.length}] ` : '';
      await message.reply(prefix + parts[0]);
      
      // 残りの部分は通常のメッセージとして送信
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        const partPrefix = `[${i + 1}/${parts.length}] `;
        
        await this.rest.post(
          Routes.channelMessages(message.channelId),
          { body: { content: partPrefix + part } }
        );
        
        // 連続送信による429エラーを避けるために少し待機
        if (i < parts.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      return true;
    } catch (error) {
      const appError = this.errorHandler.handle(error);
      throw appError;
    }
  }

  /**
   * メッセージを適切な長さに分割
   * @param content - 分割するメッセージ内容
   * @returns 分割されたメッセージの配列
   */
  private splitMessage(content: string): string[] {
    const parts: string[] = [];
    let remainingContent = content;
    
    // プレフィックス（[1/n] など）の最大長を考慮
    const effectiveMaxLength = this.maxMessageLength - 10;
    
    while (remainingContent.length > 0) {
      if (remainingContent.length <= effectiveMaxLength) {
        // 残りの内容がすべて収まる場合
        parts.push(remainingContent);
        break;
      }
      
      // 適切な分割位置を探す（段落や文の区切り）
      let splitIndex = this.findSplitIndex(remainingContent, effectiveMaxLength);
      
      // この部分を追加
      parts.push(remainingContent.substring(0, splitIndex));
      
      // 残りの内容を更新
      remainingContent = remainingContent.substring(splitIndex).trim();
    }
    
    return parts;
  }

  /**
   * 適切なメッセージ分割位置を探す
   * @param content - 分割するメッセージ内容
   * @param maxLength - 最大長
   * @returns 分割位置のインデックス
   */
  private findSplitIndex(content: string, maxLength: number): number {
    // 最大長以内で段落の区切りを探す
    const paragraphMatch = content.substring(0, maxLength).lastIndexOf('\n\n');
    if (paragraphMatch > maxLength * 0.5) {
      return paragraphMatch + 2;
    }
    
    // 段落の区切りがなければ、行の区切りを探す
    const lineMatch = content.substring(0, maxLength).lastIndexOf('\n');
    if (lineMatch > maxLength * 0.5) {
      return lineMatch + 1;
    }
    
    // 行の区切りもなければ、文の区切りを探す
    const sentenceMatch = content.substring(0, maxLength).lastIndexOf('. ');
    if (sentenceMatch > maxLength * 0.5) {
      return sentenceMatch + 2;
    }
    
    // 文の区切りもなければ、単語の区切りを探す
    const wordMatch = content.substring(0, maxLength).lastIndexOf(' ');
    if (wordMatch > 0) {
      return wordMatch + 1;
    }
    
    // どの区切りも見つからなければ、単純に最大長で分割
    return maxLength;
  }

  /**
   * レート制限エラーかどうかを判定
   * @param error - 判定するエラー
   * @returns レート制限エラーの場合はtrue
   */
  private isRateLimitError(error: unknown): boolean {
    if (typeof error === 'object' && error !== null) {
      // discord.jsのREST APIエラーの場合
      if ('status' in error && (error as any).status === 429) {
        return true;
      }
      
      // エラーメッセージにレート制限の文言が含まれる場合
      if ('message' in error && typeof (error as any).message === 'string') {
        return (error as any).message.includes('rate limit') || 
                (error as any).message.includes('429');
      }
    }
    
    return false;
  }

  /**
   * レート制限エラーからRetry-After時間を取得
   * @param error - レート制限エラー
   * @returns 待機すべき時間（ミリ秒）
   */
  private getRetryAfterTime(error: unknown): number | null {
    if (typeof error === 'object' && error !== null) {
      // discord.jsのREST APIエラーの場合
      if ('headers' in error && (error as any).headers) {
        const headers = (error as any).headers;
        
        // Retry-Afterヘッダーを探す
        if (headers['retry-after'] || headers['Retry-After']) {
          const retryAfter = headers['retry-after'] || headers['Retry-After'];
          return parseInt(retryAfter, 10) * 1000; // 秒からミリ秒に変換
        }
      }
      
      // エラーオブジェクトに直接retryAfterプロパティがある場合
      if ('retryAfter' in error && typeof (error as any).retryAfter === 'number') {
        return (error as any).retryAfter * 1000; // 秒からミリ秒に変換
      }
    }
    
    return null;
  }
}

export default DiscordResponder;
